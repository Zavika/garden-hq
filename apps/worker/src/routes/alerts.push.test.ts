import { defaultAlertRules } from "@garden-hq/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_ALERTING_ACCOUNTS, MAX_PUSH_DEVICES } from "../limits";
import { generateVapidKeys, toBase64Url } from "../notify/webpush";
import { createAccount } from "../sync/db";
import { happyRoutes, makeHarness, type FakeHandler } from "../../test/helpers";

const LINK = {
  name: "TestFarmer",
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  profileId: "123e4567-e89b-12d3-a456-426614174001",
  profiles: [],
};
const ok = { limit: async () => ({ success: true }) };

let vapid: { publicKey: string; privateKey: string };
beforeAll(async () => {
  vapid = await generateVapidKeys();
});

interface Sub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** A fresh, valid browser-shaped subscription; the route key is `host+path`. */
async function makeSub(id: string): Promise<{ sub: Sub; route: string }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
      keys: { p256dh: toBase64Url(raw), auth: toBase64Url(auth) },
    },
    route: `fcm.googleapis.com/fcm/send/${id}`,
  };
}

function harness(routes: Record<string, FakeHandler> = {}, withKeys = true) {
  return makeHarness(
    happyRoutes(routes),
    withKeys
      ? {
          CODE_LIMITER: ok,
          RATE_LIMITER: ok,
          VAPID_PUBLIC_KEY: vapid.publicKey,
          VAPID_PRIVATE_KEY: vapid.privateKey,
        }
      : { CODE_LIMITER: ok, RATE_LIMITER: ok },
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

const send = (
  h: ReturnType<typeof harness>,
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) =>
  h.request(path, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const putSub = (
  h: ReturnType<typeof harness>,
  auth: Record<string, string>,
  subscription: unknown,
) => send(h, auth, "PUT", "/api/alerts/push", { subscription });

const testPush = (
  h: ReturnType<typeof harness>,
  auth: Record<string, string>,
) => send(h, auth, "POST", "/api/alerts/push/test");

async function state(
  h: ReturnType<typeof harness>,
  auth: Record<string, string>,
) {
  return (await (await h.request("/api/alerts", { headers: auth })).json()) as {
    push: {
      available: boolean;
      publicKey: string | null;
      devices: number;
      pushOk: boolean | null;
    };
    rules: unknown;
  };
}

describe("auth", () => {
  it.each([
    ["PUT", "/api/alerts/push"],
    ["DELETE", "/api/alerts/push"],
    ["POST", "/api/alerts/push/test"],
  ])("%s %s needs a sync code", async (method, path) => {
    const res = await harness().request(path, { method });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/alerts push state", () => {
  it("is unavailable without VAPID keys", async () => {
    const h = harness({}, false);
    const auth = await signUp(h);
    expect((await state(h, auth)).push).toEqual({
      available: false,
      publicKey: null,
      devices: 0,
      pushOk: null,
    });
  });
  it("reports the public key only (never the private one) with keys", async () => {
    const h = harness();
    const auth = await signUp(h);
    const res = await h.request("/api/alerts", { headers: auth });
    const text = await res.text();
    expect(JSON.parse(text).push).toEqual({
      available: true,
      publicKey: vapid.publicKey,
      devices: 0,
      pushOk: null,
    });
    expect(text).not.toContain(vapid.privateKey);
  });
});

describe("PUT /api/alerts/push", () => {
  it("answers a clear error when push is not configured", async () => {
    const h = harness({}, false);
    const auth = await signUp(h);
    const { sub } = await makeSub("a");
    const res = await putSub(h, auth, sub);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("aren't set up");
  });
  it("stores a valid subscription idempotently and never echoes it", async () => {
    const h = harness();
    const auth = await signUp(h);
    const { sub } = await makeSub("a");
    const res = await putSub(h, auth, sub);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text).push.devices).toBe(1);
    expect(text).not.toContain(sub.endpoint);
    expect(text).not.toContain(sub.keys.p256dh);
    expect(text).not.toContain(sub.keys.auth);
    expect((await putSub(h, auth, sub)).status).toBe(200);
    expect((await state(h, auth)).push.devices).toBe(1);
  });
  it("rejects bad subscriptions and stores nothing", async () => {
    const h = harness();
    const auth = await signUp(h);
    const { sub } = await makeSub("a");
    const bad: unknown[] = [
      { ...sub, endpoint: "https://evil.example/fcm.googleapis.com" },
      { ...sub, endpoint: "http://fcm.googleapis.com/x" },
      { ...sub, keys: { ...sub.keys, p256dh: "AAAA" } },
      { ...sub, keys: { ...sub.keys, auth: "AAAA" } },
      { endpoint: sub.endpoint },
      { keys: sub.keys },
      null,
      "nope",
    ];
    for (const b of bad) expect((await putSub(h, auth, b)).status).toBe(400);
    expect((await state(h, auth)).push.devices).toBe(0);
  });
  it("evicts the oldest device when a 4th is added", async () => {
    const h = harness();
    const auth = await signUp(h);
    const subs = [];
    for (let i = 0; i <= MAX_PUSH_DEVICES; i++) {
      const { sub } = await makeSub(`d${i}`);
      subs.push(sub);
      h.clock.advance(1000);
      expect((await putSub(h, auth, sub)).status).toBe(200);
    }
    expect((await state(h, auth)).push.devices).toBe(MAX_PUSH_DEVICES);
    const rows = await h.env.DB.prepare(
      "SELECT endpoint FROM push_subscriptions",
    ).all<{ endpoint: string }>();
    const endpoints = (rows.results ?? []).map((r) => r.endpoint);
    expect(endpoints).not.toContain(subs[0]?.endpoint);
    expect(endpoints).toContain(subs[MAX_PUSH_DEVICES]?.endpoint);
  });
  it("refuses a first channel when slots are full, but not for an account with a webhook", async () => {
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
        "INSERT INTO alert_settings (account_id, discord_webhook, updated_at) VALUES (?1, 'https://discord.com/api/webhooks/1/a', 0)",
      )
        .bind(`fill${i}`)
        .run();
    }
    const { sub } = await makeSub("a");
    expect((await putSub(h, auth, sub)).status).toBe(429);
    expect((await state(h, auth)).push.devices).toBe(0);
    // An account that already has a webhook still may add a device.
    const row = await h.env.DB.prepare(
      "SELECT id FROM accounts WHERE id NOT LIKE 'fill%'",
    ).first<{ id: string }>();
    await h.env.DB.prepare(
      "INSERT INTO alert_settings (account_id, discord_webhook, updated_at) VALUES (?1, 'https://discord.com/api/webhooks/1/a', 0)",
    )
      .bind(row?.id ?? "")
      .run();
    expect((await putSub(h, auth, sub)).status).toBe(200);
  });
});

describe("DELETE /api/alerts/push", () => {
  it("removes only the named device and is idempotent", async () => {
    const h = harness();
    const auth = await signUp(h);
    const a = await makeSub("a");
    const b = await makeSub("b");
    await putSub(h, auth, a.sub);
    await putSub(h, auth, b.sub);
    const del = () =>
      send(h, auth, "DELETE", "/api/alerts/push", { endpoint: a.sub.endpoint });
    expect((await del()).status).toBe(204);
    expect((await state(h, auth)).push.devices).toBe(1);
    expect((await del()).status).toBe(204);
    expect((await state(h, auth)).push.devices).toBe(1);
  });
  it("cannot delete another account's device", async () => {
    const h = harness();
    const authA = await signUp(h);
    const authB = await signUp(h);
    const a = await makeSub("a");
    await putSub(h, authA, a.sub);
    const res = await send(h, authB, "DELETE", "/api/alerts/push", {
      endpoint: a.sub.endpoint,
    });
    expect(res.status).toBe(204);
    expect((await state(h, authA)).push.devices).toBe(1);
  });
  it("rejects a missing endpoint", async () => {
    const h = harness();
    const auth = await signUp(h);
    expect((await send(h, auth, "DELETE", "/api/alerts/push", {})).status).toBe(
      400,
    );
  });
});

describe("POST /api/alerts/push/test", () => {
  it("needs push configured and a device", async () => {
    const off = harness({}, false);
    expect((await testPush(off, await signUp(off))).status).toBe(400);
    const h = harness();
    expect((await testPush(h, await signUp(h))).status).toBe(400);
  });
  it("sent: marks push ok and seeds default rules", async () => {
    const a = await makeSub("a");
    const h = harness({ [a.route]: () => new Response(null, { status: 201 }) });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    const body = (await (await testPush(h, auth)).json()) as {
      test: string;
      push: { pushOk: boolean | null };
      rules: unknown;
    };
    expect(body.test).toBe("sent");
    expect(body.push.pushOk).toBe(true);
    expect(body.rules).toEqual(defaultAlertRules(true));
  });
  it("410 removes the subscription and reports dead", async () => {
    const a = await makeSub("a");
    const h = harness({ [a.route]: () => new Response(null, { status: 410 }) });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    const body = (await (await testPush(h, auth)).json()) as {
      test: string;
      push: { devices: number; pushOk: boolean | null };
    };
    expect(body.test).toBe("dead");
    expect(body.push).toMatchObject({ devices: 0, pushOk: null });
  });
  it("mixed outcomes: sent wins and the dead device is removed", async () => {
    const a = await makeSub("a");
    const b = await makeSub("b");
    const h = harness({
      [a.route]: () => new Response(null, { status: 201 }),
      [b.route]: () => new Response(null, { status: 404 }),
    });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    await putSub(h, auth, b.sub);
    const body = (await (await testPush(h, auth)).json()) as {
      test: string;
      push: { devices: number; pushOk: boolean | null };
    };
    expect(body.test).toBe("sent");
    expect(body.push).toMatchObject({ devices: 1, pushOk: true });
  });
  it("a rejected (400) push is failed and keeps the subscription", async () => {
    const a = await makeSub("a");
    const h = harness({ [a.route]: () => new Response(null, { status: 400 }) });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    const body = (await (await testPush(h, auth)).json()) as {
      test: string;
      push: { devices: number; pushOk: boolean | null };
    };
    expect(body.test).toBe("failed");
    expect(body.push).toMatchObject({ devices: 1, pushOk: null });
  });
  it("a successful test keeps rules the user already customised", async () => {
    const a = await makeSub("a");
    const h = harness({ [a.route]: () => new Response(null, { status: 201 }) });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    await testPush(h, auth);
    await send(h, auth, "PUT", "/api/alerts/rules", {
      rules: { contest_soon: { leadMinutes: 10 } },
    });
    const body = (await (await testPush(h, auth)).json()) as {
      test: string;
      rules: { contest_soon: { leadMinutes: number } };
    };
    expect(body.test).toBe("sent");
    expect(body.rules.contest_soon.leadMinutes).toBe(10);
  });
  it("a network error is failed and keeps the subscription", async () => {
    const a = await makeSub("a");
    const h = harness({
      [a.route]: () => {
        throw new Error("boom");
      },
    });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    const body = (await (await testPush(h, auth)).json()) as {
      test: string;
      push: { devices: number; pushOk: boolean | null };
    };
    expect(body.test).toBe("failed");
    expect(body.push).toMatchObject({ devices: 1, pushOk: null });
  });
});

describe("PUT /api/alerts/rules with push", () => {
  const patch = { rules: { contest_soon: { leadMinutes: 10 } } };
  it("is refused before any channel is verified and allowed after a test push", async () => {
    const a = await makeSub("a");
    const h = harness({ [a.route]: () => new Response(null, { status: 201 }) });
    const auth = await signUp(h);
    await putSub(h, auth, a.sub);
    expect(
      (await send(h, auth, "PUT", "/api/alerts/rules", patch)).status,
    ).toBe(400);
    await testPush(h, auth);
    expect(
      (await send(h, auth, "PUT", "/api/alerts/rules", patch)).status,
    ).toBe(200);
  });
});

describe("secrecy", () => {
  it("no response or console output contains endpoints or keys", async () => {
    const a = await makeSub("secret-endpoint-id");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const h = harness({ [a.route]: () => new Response(null, { status: 410 }) });
    const auth = await signUp(h);
    const texts = [
      await (await putSub(h, auth, a.sub)).text(),
      await (await h.request("/api/alerts", { headers: auth })).text(),
      await (await testPush(h, auth)).text(),
      await (
        await putSub(h, auth, { ...a.sub, endpoint: "https://x.test/" })
      ).text(),
    ];
    const logged = spies.flatMap((s) =>
      s.mock.calls.map((c) => JSON.stringify(c)),
    );
    spies.forEach((s) => s.mockRestore());
    for (const t of [...texts, ...logged]) {
      expect(t).not.toContain("secret-endpoint-id");
      expect(t).not.toContain(a.sub.keys.p256dh);
      expect(t).not.toContain(a.sub.keys.auth);
    }
  });
});
