import { defaultAlertRules } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { createAccount } from "../sync/db";
import { MAX_ALERTING_ACCOUNTS } from "../limits";
import { happyRoutes, makeHarness } from "../../test/helpers";

const HOOK_PATH = "/api/webhooks/123456789012345678/abcDEF_ghi-123";
const HOOK = `https://discord.com${HOOK_PATH}`;
const HOOK_ROUTE = `discord.com${HOOK_PATH}`;
const LINK = {
  name: "TestFarmer",
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  profileId: "123e4567-e89b-12d3-a456-426614174001",
  profiles: [],
};

const ok = { limit: async () => ({ success: true }) };

function harness(discordStatus = 204) {
  return makeHarness(
    happyRoutes({
      [HOOK_ROUTE]: () => new Response(null, { status: discordStatus }),
    }),
    { CODE_LIMITER: ok, RATE_LIMITER: ok },
  );
}

async function signUp(
  h: ReturnType<typeof harness>,
): Promise<Record<string, string>> {
  const res = await h.request("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ link: LINK }),
  });
  const { syncCode } = (await res.json()) as { syncCode: string };
  return {
    Authorization: `Bearer ${syncCode}`,
    "Content-Type": "application/json",
  };
}

const put = (
  h: ReturnType<typeof harness>,
  auth: Record<string, string>,
  path: string,
  body: unknown,
) =>
  h.request(path, { method: "PUT", headers: auth, body: JSON.stringify(body) });

describe("auth", () => {
  it.each([
    ["GET", "/api/alerts"],
    ["PUT", "/api/alerts/webhook"],
    ["DELETE", "/api/alerts/webhook"],
    ["POST", "/api/alerts/test"],
    ["PUT", "/api/alerts/rules"],
  ])("%s %s needs a sync code", async (method, path) => {
    const h = harness();
    const res = await h.request(path, { method });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/alerts", () => {
  it("starts empty", async () => {
    const h = harness();
    const auth = await signUp(h);
    const res = await h.request("/api/alerts", { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      hasWebhook: false,
      webhookLast4: null,
      webhookOk: null,
      rules: null,
    });
  });
});

describe("PUT /api/alerts/webhook", () => {
  it("stores a valid webhook untested and never returns the URL", async () => {
    const h = harness();
    const auth = await signUp(h);
    const res = await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      hasWebhook: true,
      webhookLast4: "-123",
      webhookOk: null,
      rules: null,
    });
    expect(text).not.toContain("abcDEF");
    expect(
      await (await h.request("/api/alerts", { headers: auth })).text(),
    ).not.toContain("abcDEF");
  });
  it.each(["https://evil.com/api/webhooks/1/a", "nope", 5, null])(
    "rejects %s",
    async (url) => {
      const h = harness();
      const auth = await signUp(h);
      expect((await put(h, auth, "/api/alerts/webhook", { url })).status).toBe(
        400,
      );
    },
  );
  it("refuses a new webhook once the free plan's alerting slots are full", async () => {
    const h = harness();
    const auth = await signUp(h);
    for (let i = 0; i < MAX_ALERTING_ACCOUNTS; i++) {
      await createAccount(h.env.DB, {
        id: `fill${i}`,
        codeHash: `fill-hash-${i}`,
        link: LINK,
        now: h.clock.now(),
      });
      await h.env.DB.prepare(
        "INSERT INTO alert_settings (account_id, discord_webhook, updated_at) VALUES (?1, ?2, 0)",
      )
        .bind(`fill${i}`, HOOK)
        .run();
    }
    const res = await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect(res.status).toBe(429);
    // An account that already has a webhook may still replace it.
    await h.env.DB.prepare(
      "DELETE FROM alert_settings WHERE account_id = 'fill0'",
    ).run();
    expect(
      (await put(h, auth, "/api/alerts/webhook", { url: HOOK })).status,
    ).toBe(200);
    expect(
      (await put(h, auth, "/api/alerts/webhook", { url: `${HOOK}x` })).status,
    ).toBe(200);
  });
});

describe("POST /api/alerts/test", () => {
  it("needs a webhook first", async () => {
    const h = harness();
    const auth = await signUp(h);
    expect(
      (await h.request("/api/alerts/test", { method: "POST", headers: auth }))
        .status,
    ).toBe(400);
  });
  it("on success marks the webhook ok and seeds the default rules", async () => {
    const h = harness(204);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    const res = await h.request("/api/alerts/test", {
      method: "POST",
      headers: auth,
    });
    const body = (await res.json()) as {
      test: string;
      webhookOk: boolean;
      rules: ReturnType<typeof defaultAlertRules>;
    };
    expect(body.test).toBe("sent");
    expect(body.webhookOk).toBe(true);
    expect(body.rules).toEqual(defaultAlertRules(true));
    expect(body.rules.composter_fuel_low.enabled).toBe(false);
  });
  it("404 from Discord marks the webhook dead", async () => {
    const h = harness(404);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    const body = (await (
      await h.request("/api/alerts/test", { method: "POST", headers: auth })
    ).json()) as { test: string; webhookOk: boolean | null };
    expect(body.test).toBe("dead");
    expect(body.webhookOk).toBe(false);
  });
  it("a 5xx leaves the status untouched and says to try again", async () => {
    const h = harness(503);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    const body = (await (
      await h.request("/api/alerts/test", { method: "POST", headers: auth })
    ).json()) as { test: string; webhookOk: boolean | null; rules: unknown };
    expect(body).toMatchObject({
      test: "failed",
      webhookOk: null,
      rules: null,
    });
  });
});

describe("PUT /api/alerts/rules", () => {
  async function verified() {
    const h = harness(204);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    await h.request("/api/alerts/test", { method: "POST", headers: auth });
    return { h, auth };
  }
  it("is refused until a test message has succeeded", async () => {
    const h = harness();
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect(
      (
        await put(h, auth, "/api/alerts/rules", {
          rules: { contest_soon: { enabled: false } },
        })
      ).status,
    ).toBe(400);
  });
  it("merges a partial patch and persists it", async () => {
    const { h, auth } = await verified();
    const res = await put(h, auth, "/api/alerts/rules", {
      rules: {
        contest_soon: { leadMinutes: 10 },
        composter_fuel_low: { enabled: true },
      },
    });
    expect(res.status).toBe(200);
    const state = (await (
      await h.request("/api/alerts", { headers: auth })
    ).json()) as { rules: ReturnType<typeof defaultAlertRules> };
    expect(state.rules.contest_soon).toEqual({
      enabled: true,
      leadMinutes: 10,
    });
    expect(state.rules.composter_fuel_low).toEqual({
      enabled: true,
      leadMinutes: 30,
    });
  });
  it.each([
    { nope: { enabled: true } },
    { contest_soon: { leadMinutes: 0 } },
    { visitors_waiting: { threshold: 6 } },
    { contest_soon: { enabled: "yes" } },
  ])("rejects invalid rules %j", async (rules) => {
    const { h, auth } = await verified();
    expect((await put(h, auth, "/api/alerts/rules", { rules })).status).toBe(
      400,
    );
  });
});

describe("DELETE /api/alerts/webhook", () => {
  it("removes the webhook and rules", async () => {
    const h = harness();
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect(
      (
        await h.request("/api/alerts/webhook", {
          method: "DELETE",
          headers: auth,
        })
      ).status,
    ).toBe(204);
    expect(
      await (await h.request("/api/alerts", { headers: auth })).json(),
    ).toEqual({
      hasWebhook: false,
      webhookLast4: null,
      webhookOk: null,
      rules: null,
    });
  });
});

describe("CORS", () => {
  it("allows PUT from the web origin", async () => {
    const h = harness();
    const res = await h.request("/api/alerts/webhook", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });
});
