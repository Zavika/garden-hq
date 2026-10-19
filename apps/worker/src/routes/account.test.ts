import { isSyncCode } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { MAX_ACCOUNTS_CREATED_PER_DAY } from "../limits";
import { makeHarness } from "../../test/helpers";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const LINK = {
  name: "Steve_1",
  uuid: UUID,
  profileId: UUID2,
  profiles: [{ profileId: UUID2, name: "Apple", selected: true }],
};
const ok = { limit: async () => ({ success: true }) };
const no = { limit: async () => ({ success: false }) };

function harness(rate = ok) {
  return makeHarness(undefined, { CODE_LIMITER: ok, RATE_LIMITER: rate });
}
const post = (body: string) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
const bearer = (code: string) => ({
  headers: { Authorization: `Bearer ${code}` },
});

describe("account routes", () => {
  it("creates an account, storing only a hash", async () => {
    const h = harness();
    const res = await h.request(
      "/api/account",
      post(JSON.stringify({ link: LINK })),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { syncCode } = (await res.json()) as { syncCode: string };
    expect(isSyncCode(syncCode)).toBe(true);
    const row = await h.env.DB.prepare("SELECT code_hash FROM accounts").first<{
      code_hash: string;
    }>();
    expect(row?.code_hash).not.toBe(syncCode);
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const get = await h.request("/api/sync", bearer(syncCode));
    expect(get.status).toBe(200);
  });

  it.each([
    ["bad uuid", { ...LINK, uuid: "nope" }],
    ["bad name", { ...LINK, name: "bad name!" }],
    ["bad profileId", { ...LINK, profileId: "x" }],
  ])("rejects an invalid link (%s)", async (_n, link) => {
    const h = harness();
    const res = await h.request("/api/account", post(JSON.stringify({ link })));
    expect(res.status).toBe(400);
  });

  it("rejects missing, malformed and oversized bodies", async () => {
    const h = harness();
    expect((await h.request("/api/account", { method: "POST" })).status).toBe(
      400,
    );
    expect((await h.request("/api/account", post("{nope"))).status).toBe(400);
    const big = JSON.stringify({ link: LINK, pad: "x".repeat(70_000) });
    expect((await h.request("/api/account", post(big))).status).toBe(400);
  });

  it("caps a chunked body that has no Content-Length", async () => {
    const h = harness();
    const chunk = new TextEncoder().encode("x".repeat(16_384));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Endless unless the server stops reading.
        sent++;
        if (sent > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await h.request("/api/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(400);
    expect(sent).toBeLessThan(20);
  });

  async function seedCreations(
    h: ReturnType<typeof harness>,
    n: number,
    at: number,
  ) {
    for (let i = 0; i < n; i++) {
      await h.env.DB.prepare(
        "INSERT INTO account_creations (created_at) VALUES (?1)",
      )
        .bind(at)
        .run();
    }
  }
  const createReq = () => post(JSON.stringify({ link: LINK }));

  it("refuses new accounts once the daily global cap is reached", async () => {
    const h = harness();
    await seedCreations(h, MAX_ACCOUNTS_CREATED_PER_DAY, h.clock.now() - 1000);
    const res = await h.request("/api/account", createReq());
    expect(res.status).toBe(429);
    const err = (await res.json()) as {
      error: { code: string; message: string; retryAfter: number };
    };
    expect(err.error.code).toBe("rate_limited");
    expect(err.error.retryAfter).toBe(3600);
    expect(err.error.message).toContain("temporarily full");
    // Creations older than 24 h stop counting.
    h.clock.advance(25 * 3600_000);
    const later = await h.request("/api/account", createReq());
    expect(later.status).toBe(201);
  });

  it("counts a creation toward the cap even after the account is deleted", async () => {
    const h = harness();
    await seedCreations(h, MAX_ACCOUNTS_CREATED_PER_DAY - 1, h.clock.now());
    const res = await h.request("/api/account", createReq());
    expect(res.status).toBe(201);
    const { syncCode } = (await res.json()) as { syncCode: string };
    const del = await h.request("/api/account", {
      method: "DELETE",
      ...bearer(syncCode),
    });
    expect(del.status).toBe(204);
    const accounts = await h.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM accounts",
    ).first<{ n: number }>();
    expect(accounts?.n).toBe(0);
    const again = await h.request("/api/account", createReq());
    expect(again.status).toBe(429);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "rate_limited",
    );
  });

  it("writes exactly one creation row per account", async () => {
    const h = harness();
    expect((await h.request("/api/account", createReq())).status).toBe(201);
    const rows = await h.env.DB.prepare(
      "SELECT created_at FROM account_creations",
    ).all<{ created_at: number }>();
    expect(rows.results).toEqual([{ created_at: h.clock.now() }]);
  });

  it("is rate limited", async () => {
    const h = harness(no);
    const res = await h.request(
      "/api/account",
      post(JSON.stringify({ link: LINK })),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("deletes with a valid code and rejects a wrong one", async () => {
    const h = harness();
    const res = await h.request(
      "/api/account",
      post(JSON.stringify({ link: LINK })),
    );
    const { syncCode } = (await res.json()) as { syncCode: string };

    const wrong = await h.request("/api/account", {
      method: "DELETE",
      ...bearer("A".repeat(32)),
    });
    expect(wrong.status).toBe(401);
    expect((await h.request("/api/sync", bearer(syncCode))).status).toBe(200);

    const del = await h.request("/api/account", {
      method: "DELETE",
      ...bearer(syncCode),
    });
    expect(del.status).toBe(204);
    expect((await h.request("/api/sync", bearer(syncCode))).status).toBe(401);
  });
});
