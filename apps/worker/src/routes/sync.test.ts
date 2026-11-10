import { EMPTY_PROGRESS } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_OPS_PER_ACCOUNT_PER_DAY } from "../limits";
import { FakeKV, makeHarness } from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const LINK = {
  name: "Steve_1",
  uuid: UUID,
  profileId: UUID2,
  profiles: [{ profileId: UUID2, name: "Apple", selected: true }],
};
const ok = { limit: async () => ({ success: true }) };

function harness() {
  return makeHarness(undefined, { CODE_LIMITER: ok, RATE_LIMITER: ok });
}
type H = ReturnType<typeof harness>;

async function newAccount(h: H): Promise<string> {
  const res = await h.request("/api/account", {
    method: "POST",
    body: JSON.stringify({ link: LINK }),
  });
  return ((await res.json()) as { syncCode: string }).syncCode;
}
const auth = (code: string, extra: Record<string, string> = {}) => ({
  headers: { Authorization: `Bearer ${code}`, ...extra },
});
const postOps = (code: string, ops: unknown[]) => ({
  method: "POST",
  headers: { Authorization: `Bearer ${code}` },
  body: JSON.stringify({ ops }),
});
const set = (plotId: string, cropId: string | null) => ({
  t: "setAssignment",
  plotId,
  cropId,
});
const kvSize = (h: H) => (h.env.CACHE as unknown as FakeKV).store.size;
interface State {
  assignments: unknown;
  revision: number;
}

describe("sync routes", () => {
  it("rejects missing and wrong codes", async () => {
    const h = harness();
    await newAccount(h);
    expect((await h.request("/api/sync")).status).toBe(401);
    expect((await h.request("/api/sync", auth("A".repeat(32)))).status).toBe(
      401,
    );
  });

  it("returns state with an ETag and 304 on a match", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request("/api/sync", auth(code));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const etag = res.headers.get("ETag");
    expect(etag).toBe('"0"');
    expect(await res.json()).toEqual({
      link: LINK,
      assignments: {},
      greenhouses: {},
      timeZone: "Europe/Warsaw",
      progress: EMPTY_PROGRESS,
      revision: 0,
    });
    const again = await h.request(
      "/api/sync",
      auth(code, { "If-None-Match": etag ?? "" }),
    );
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  it("applies ops, changes the ETag and invalidates the old one", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request(
      "/api/sync",
      postOps(code, [set("beginner_1", "wheat")]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"1"');
    const body = (await res.json()) as State;
    expect(body.assignments).toEqual({ beginner_1: "wheat" });
    expect(body.revision).toBe(1);
    const old = await h.request(
      "/api/sync",
      auth(code, { "If-None-Match": '"0"' }),
    );
    expect(old.status).toBe(200);
  });

  it("skips an invalid op, applies the valid ones and reports the count", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request(
      "/api/sync",
      postOps(code, [
        set("beginner_1", "wheat"),
        set("nope_99", "wheat"),
        set("beginner_2", "carrot"),
      ]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as State & { rejected?: number };
    expect(body.assignments).toEqual({
      beginner_1: "wheat",
      beginner_2: "carrot",
    });
    expect(body.rejected).toBe(1);
    expect(body.revision).toBe(1);
  });

  it("omits rejected when every op is valid", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request(
      "/api/sync",
      postOps(code, [set("beginner_1", "wheat")]),
    );
    expect(await res.json()).not.toHaveProperty("rejected");
  });

  it("treats a request of only invalid ops as a no-op that reports them", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request(
      "/api/sync",
      postOps(code, [set("nope_99", "wheat")]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as State & { rejected?: number };
    expect(body.rejected).toBe(1);
    expect(body.revision).toBe(0);
  });

  it("matches If-None-Match through a weak validator or a list", async () => {
    const h = harness();
    const code = await newAccount(h);
    for (const header of ['W/"0"', '"9", W/"0"', '"0"']) {
      const res = await h.request(
        "/api/sync",
        auth(code, { "If-None-Match": header }),
      );
      expect(res.status).toBe(304);
    }
    const miss = await h.request(
      "/api/sync",
      auth(code, { "If-None-Match": 'W/"9"' }),
    );
    expect(miss.status).toBe(200);
  });

  describe("per-account write budget", () => {
    const tz = (): unknown => ({ t: "setTimeZone", timeZone: "UTC" });
    const opsCount = async (h: H) =>
      (
        await h.env.DB.prepare(
          "SELECT ops_count, ops_day FROM accounts",
        ).first<{
          ops_count: number;
          ops_day: number;
        }>()
      )?.ops_count;

    it("bumps the counter once per batch by the number of valid ops", async () => {
      const h = harness();
      const code = await newAccount(h);
      await h.request(
        "/api/sync",
        postOps(code, [tz(), tz(), set("nope_99", "wheat")]),
      );
      expect(await opsCount(h)).toBe(2);
      await h.request("/api/sync", postOps(code, [tz()]));
      expect(await opsCount(h)).toBe(3);
      await h.request("/api/sync", postOps(code, []));
      expect(await opsCount(h)).toBe(3);
    });

    it("rejects with rate_limited and applies nothing once the budget is spent", async () => {
      const h = harness();
      const code = await newAccount(h);
      const full = Array.from({ length: 40 }, tz);
      for (let i = 0; i < MAX_OPS_PER_ACCOUNT_PER_DAY / 40; i++) {
        expect((await h.request("/api/sync", postOps(code, full))).status).toBe(
          200,
        );
      }
      const res = await h.request(
        "/api/sync",
        postOps(code, [set("beginner_1", "wheat")]),
      );
      expect(res.status).toBe(429);
      const err = (await res.json()) as {
        error: { code: string; retryAfter: number };
      };
      expect(err.error.code).toBe("rate_limited");
      expect(err.error.retryAfter).toBe(12 * 3600);
      const s = (await (
        await h.request("/api/sync", auth(code))
      ).json()) as State;
      expect(s.assignments).toEqual({});
      expect(await opsCount(h)).toBe(MAX_OPS_PER_ACCOUNT_PER_DAY);
    }, 20_000);

    it("refuses a request that would cross the budget, accepts one that fits", async () => {
      const h = harness();
      const code = await newAccount(h);
      const full = Array.from({ length: 40 }, tz);
      for (let i = 0; i < MAX_OPS_PER_ACCOUNT_PER_DAY / 40 - 1; i++) {
        await h.request("/api/sync", postOps(code, full));
      }
      const left = MAX_OPS_PER_ACCOUNT_PER_DAY - 960;
      const almost = await h.request(
        "/api/sync",
        postOps(code, Array.from({ length: left - 1 }, tz)),
      );
      expect(almost.status).toBe(200);
      expect(
        (await h.request("/api/sync", postOps(code, [tz(), tz()]))).status,
      ).toBe(429);
      expect((await h.request("/api/sync", postOps(code, [tz()]))).status).toBe(
        200,
      );
    }, 20_000);

    it("resets on a new UTC day", async () => {
      const h = harness();
      const code = await newAccount(h);
      const full = Array.from({ length: 40 }, tz);
      for (let i = 0; i < MAX_OPS_PER_ACCOUNT_PER_DAY / 40; i++) {
        await h.request("/api/sync", postOps(code, full));
      }
      expect((await h.request("/api/sync", postOps(code, [tz()]))).status).toBe(
        429,
      );
      h.clock.advance(12 * 3600_000); // exactly next UTC midnight
      const res = await h.request("/api/sync", postOps(code, [tz(), tz()]));
      expect(res.status).toBe(200);
      expect(await opsCount(h)).toBe(2);
    }, 20_000);
  });

  it("rejects more than the op limit, bad JSON and big bodies", async () => {
    const h = harness();
    const code = await newAccount(h);
    const many = Array.from({ length: 41 }, () => ({
      t: "setTimeZone",
      timeZone: "UTC",
    }));
    expect((await h.request("/api/sync", postOps(code, many))).status).toBe(
      400,
    );
    const bad = await h.request("/api/sync", {
      ...postOps(code, []),
      body: "{x",
    });
    expect(bad.status).toBe(400);
    const big = await h.request("/api/sync", {
      ...postOps(code, []),
      body: JSON.stringify({ ops: [], pad: "x".repeat(70_000) }),
    });
    expect(big.status).toBe(400);
  });

  it("last write wins; different plots both survive; replay is a no-op", async () => {
    const h = harness();
    const code = await newAccount(h);
    await h.request("/api/sync", postOps(code, [set("beginner_1", "wheat")]));
    await h.request("/api/sync", postOps(code, [set("beginner_1", "carrot")]));
    await h.request("/api/sync", postOps(code, [set("beginner_2", "potato")]));
    await h.request("/api/sync", postOps(code, [set("beginner_2", "potato")]));
    const s = (await (
      await h.request("/api/sync", auth(code))
    ).json()) as State;
    expect(s.assignments).toEqual({
      beginner_1: "carrot",
      beginner_2: "potato",
    });
    expect(s.revision).toBe(4);
  });

  it("returns current state without a revision bump for empty ops", async () => {
    const h = harness();
    const code = await newAccount(h);
    await h.request("/api/sync", postOps(code, [set("beginner_1", "wheat")]));
    const res = await h.request("/api/sync", postOps(code, []));
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"1"');
    const s = (await res.json()) as State;
    expect(s.assignments).toEqual({ beginner_1: "wheat" });
    expect(s.revision).toBe(1);
  });

  it("measures the body limit in bytes", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request("/api/sync", {
      ...postOps(code, []),
      body: JSON.stringify({ ops: [], pad: "é".repeat(40_000) }),
    });
    expect(res.status).toBe(400);
  });

  it("keeps accounts isolated", async () => {
    const h = harness();
    const a = await newAccount(h);
    const b = await newAccount(h);
    await h.request("/api/sync", postOps(a, [set("beginner_1", "wheat")]));
    const s = (await (await h.request("/api/sync", auth(b))).json()) as State;
    expect(s.assignments).toEqual({});
  });

  it("never echoes or logs the code or its hash, and never writes KV", async () => {
    const h = harness();
    const logs: string[] = [];
    for (const m of ["log", "error", "warn"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    }
    const before = kvSize(h);
    const code = await newAccount(h);
    const hash =
      (
        await h.env.DB.prepare("SELECT code_hash FROM accounts").first<{
          code_hash: string;
        }>()
      )?.code_hash ?? "?";
    const res = await h.request(
      "/api/sync",
      postOps(code, [set("beginner_1", "wheat")]),
    );
    const text = await res.text();
    await h.request("/api/sync", auth("B".repeat(32)));
    expect(text).not.toContain(code);
    expect(text).not.toContain(hash);
    expect(logs.join("\n")).not.toContain(code);
    expect(logs.join("\n")).not.toContain(hash);
    expect(kvSize(h)).toBe(before);
  });

  it("stores progress ops, bumps the ETag and rejects bad xp", async () => {
    const h = harness();
    const code = await newAccount(h);
    const etag0 = (await h.request("/api/sync", auth(code))).headers.get(
      "ETag",
    );
    const day = "2026-10-01";
    const now = h.clock.now();
    const rec = {
      day,
      slot: 0,
      kind: "unlock_plot",
      params: {},
      baseline: null,
      createdAt: now,
      expiresAt: now + 1000,
      doneAt: null,
      xp: 40,
    };
    const res = await h.request(
      "/api/sync",
      postOps(code, [
        { t: "setQuests", day, quests: [rec] },
        { t: "completeQuest", day, slot: 0, kind: "unlock_plot", at: now },
        { t: "unlockAchievement", id: "first_greenhouse", at: 5, xp: 50 },
        { t: "unlockAchievement", id: "plots_6", at: 5, xp: 1 },
      ]),
    );
    expect(((await res.json()) as { rejected?: number }).rejected).toBe(1);
    const got = await h.request("/api/sync", auth(code));
    expect(got.headers.get("ETag")).not.toBe(etag0);
    const body = (await got.json()) as {
      progress: {
        quests: { doneAt: number | null }[];
        achievements: Record<string, unknown>;
      };
    };
    expect(body.progress.quests).toHaveLength(1);
    expect(body.progress.quests[0]?.doneAt).toBe(now);
    expect(Object.keys(body.progress.achievements)).toEqual([
      "first_greenhouse",
    ]);
    const again = await h.request(
      "/api/sync",
      auth(code, { "If-None-Match": got.headers.get("ETag") ?? "" }),
    );
    expect(again.status).toBe(304);
  });

  it("drops progress ops outside the day window", async () => {
    const h = harness();
    const code = await newAccount(h);
    const res = await h.request(
      "/api/sync",
      postOps(code, [
        {
          t: "completeQuest",
          day: "2030-01-01",
          slot: 0,
          kind: "unlock_plot",
          at: h.clock.now(),
        },
      ]),
    );
    expect(((await res.json()) as { rejected?: number }).rejected).toBe(1);
  });
});
