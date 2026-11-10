import { defaultAlertRules, type GardenState } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveSnapshotStmt, saveWebhook, verifyWebhookStmt } from "./alerts/db";
import { upsertSubscription, verifyPushStmt } from "./alerts/push";
import { runSync } from "./cron";
import { createRateLimitState } from "./hypixel";
import { MAX_PUSH_SENDS_PER_RUN } from "./limits";
import { generateVapidKeys, toBase64Url } from "./notify/webpush";
import { createAccount } from "./sync/db";
import {
  START_TIME,
  happyRoutes,
  makeClock,
  makeEnv,
  makeSleep,
  routedFetch,
  type FakeHandler,
} from "../test/helpers";
import type { Env } from "./env";

const NOW = START_TIME;
const MIN = 60_000;
const DAY = 86_400_000;
const HOOK_PATH = "/api/webhooks/123456789012345678/abcDEF_ghi-123";
const HOOK = `https://discord.com${HOOK_PATH}`;
const HOOK_ROUTE = `discord.com${HOOK_PATH}`;
const FCM_PATH = "/fcm/send/";
const LINK = {
  name: "TestFarmer",
  uuid: "0123456789abcdef0123456789abcdef",
  profileId: "fedcba9876543210fedcba9876543210",
  profiles: [],
};
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

afterEach(() => vi.restoreAllMocks());

function emptyFuel(): GardenState {
  return {
    level: 8,
    experience: 1000,
    unlockedPlotIds: ["beginner_1"],
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    composter: {
      organicMatter: 100_000,
      fuel: 0,
      compostUnits: 0,
      lastSave: NOW - 60 * MIN,
      upgrades: {
        speed: 0,
        multiDrop: 0,
        fuelCap: 0,
        organicMatterCap: 0,
        costReduction: 0,
      },
    },
  };
}

interface Device {
  id: string;
  endpoint: string;
  route: string;
  p256dh: string;
  auth: string;
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
  authRaw: Uint8Array;
}

/** Throwaway subscription keys, generated per test run. */
async function makeDevice(id: string): Promise<Device> {
  const pair = (await crypto.subtle.generateKey(ECDH, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const authRaw = crypto.getRandomValues(new Uint8Array(16));
  return {
    id,
    endpoint: `https://fcm.googleapis.com${FCM_PATH}${id}`,
    route: `fcm.googleapis.com${FCM_PATH}${id}`,
    p256dh: toBase64Url(publicRaw),
    auth: toBase64Url(authRaw),
    privateKey: pair.privateKey,
    publicRaw,
    authRaw,
  };
}

/** Test-side user agent: RFC 8291 section 3.4 decryption. */
async function decrypt(body: Uint8Array, d: Device): Promise<unknown> {
  const salt = body.slice(0, 16);
  const idlen = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, ECDH, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: asKey,
      } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      d.privateKey,
      256,
    ),
  );
  const te = new TextEncoder();
  const derive = async (
    s: Uint8Array,
    ikm: Uint8Array,
    info: Uint8Array,
    n: number,
  ) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
          "deriveBits",
        ]),
        n * 8,
      ),
    );
  const ikm = await derive(
    d.authRaw,
    ecdh,
    new Uint8Array([
      ...te.encode("WebPush: info\0"),
      ...d.publicRaw,
      ...asPublic,
    ]),
    32,
  );
  const cek = await derive(
    salt,
    ikm,
    te.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await derive(
    salt,
    ikm,
    te.encode("Content-Encoding: nonce\0"),
    12,
  );
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher),
  );
  return JSON.parse(new TextDecoder().decode(record.slice(0, -1)));
}

interface AccountSeed {
  id: string;
  webhook?: boolean;
  devices?: Device[];
  garden?: GardenState;
}

/** Verified channels, a fresh snapshot and default rules. */
async function seed(db: D1Database, s: AccountSeed): Promise<void> {
  const rules = JSON.stringify(defaultAlertRules(true));
  await createAccount(db, {
    id: s.id,
    codeHash: `hash-${s.id}`,
    link: LINK,
    now: NOW,
  });
  if (s.webhook === true) {
    await saveWebhook(db, s.id, HOOK, NOW);
    await verifyWebhookStmt(db, s.id, rules, NOW).run();
  }
  for (const [i, d] of (s.devices ?? []).entries()) {
    await upsertSubscription(
      db,
      s.id,
      { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
      NOW + i,
    );
  }
  if ((s.devices ?? []).length > 0) {
    await verifyPushStmt(db, s.id, rules, NOW).run();
  }
  await saveSnapshotStmt(db, s.id, NOW - MIN, s.garden ?? emptyFuel()).run();
}

async function seedContests(env: Env): Promise<void> {
  await env.CACHE.put(
    "contests",
    JSON.stringify({
      fetchedAt: NOW + 30 * DAY,
      value: {
        contests: [],
        source: { name: "EliteBot", url: "https://elitebot.dev" },
      },
    }),
  );
}

async function vapidEnv(): Promise<Partial<Env>> {
  const keys = await generateVapidKeys();
  return {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "mailto:ops@example.com",
  };
}

async function setup(
  opts: {
    withVapid?: boolean;
    hook?: FakeHandler;
    push?: Record<string, FakeHandler>;
  } = {},
) {
  const clock = makeClock(NOW);
  const { sleep } = makeSleep();
  const hooks: string[] = [];
  const pushed = new Map<string, Uint8Array[]>();
  const net = routedFetch(
    happyRoutes({
      [HOOK_ROUTE]: opts.hook ?? (() => new Response(null, { status: 204 })),
      ...(opts.push ?? {}),
    }),
  );
  const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/api/webhooks/"))
      hooks.push(String(init?.body));
    if (url.pathname.startsWith(FCM_PATH)) {
      const list = pushed.get(url.pathname) ?? [];
      list.push(init?.body as Uint8Array);
      pushed.set(url.pathname, list);
    }
    return net.fetch(input, init);
  }) as typeof fetch;
  const env = makeEnv(opts.withVapid === false ? {} : await vapidEnv());
  await seedContests(env);
  return {
    clock,
    env,
    net,
    hooks,
    pushed,
    run: () =>
      runSync(env, {
        fetch: recording,
        now: clock.now,
        sleep,
        hypixelState: createRateLimitState(),
      }),
    pushesTo: (d: Device) => (pushed.get(`${FCM_PATH}${d.id}`) ?? []).length,
    totalPushes: () => net.calls.filter((c) => c.includes(FCM_PATH)).length,
    posts: () => net.calls.filter((c) => c === HOOK_ROUTE).length,
  };
}

/** The snapshot goes stale after 5 minutes; keep it fresh (same garden, same alert key) so no Hypixel call is needed. */
const refreshSnapshot = (
  t: { env: Env; clock: { now: () => number } },
  id: string,
  garden: GardenState = emptyFuel(),
) => saveSnapshotStmt(t.env.DB, id, t.clock.now() - MIN, garden).run();

const ok = () => new Response(null, { status: 201 });
const gone = () => new Response(null, { status: 410 });
const fail = () => new Response(null, { status: 500 });

const makeDue = (db: D1Database) =>
  db.prepare("UPDATE alert_settings SET next_sync_at = 0").run();
const count = async (db: D1Database, sql: string) =>
  (await db.prepare(sql).first<{ n: number }>())?.n;
const logCount = (db: D1Database) =>
  count(db, "SELECT COUNT(*) AS n FROM alert_log");
const subCount = (db: D1Database, id: string) =>
  count(
    db,
    `SELECT COUNT(*) AS n FROM push_subscriptions WHERE account_id = '${id}'`,
  );
const nextSync = (db: D1Database, id: string) =>
  count(
    db,
    `SELECT next_sync_at AS n FROM alert_settings WHERE account_id = '${id}'`,
  );
const pushOk = (db: D1Database, id: string) =>
  count(
    db,
    `SELECT push_ok AS n FROM alert_settings WHERE account_id = '${id}'`,
  );

describe("runSync - web push delivery", () => {
  it("pushes to a push-only account, claims once, and sends nothing on the next tick", async () => {
    const d = await makeDevice("d1");
    const t = await setup({ push: { [d.route]: ok } });
    await seed(t.env.DB, { id: "a", devices: [d] });
    const first = await t.run();
    expect(first).toMatchObject({ due: 1, sent: 0, pushSent: 1 });
    expect(t.pushesTo(d)).toBe(1);
    expect(await logCount(t.env.DB)).toBe(1);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    const second = await t.run();
    expect(second.pushSent).toBe(0);
    expect(t.pushesTo(d)).toBe(1);
  });

  it("sends one message per channel and device, with a decryptable payload matching the Discord embed", async () => {
    const [d1, d2] = [await makeDevice("d1"), await makeDevice("d2")];
    const t = await setup({ push: { [d1.route]: ok, [d2.route]: ok } });
    await seed(t.env.DB, { id: "a", webhook: true, devices: [d1, d2] });
    const summary = await t.run();
    expect(summary).toMatchObject({ sent: 1, pushSent: 2 });
    expect(t.posts()).toBe(1);
    expect(t.pushesTo(d1)).toBe(1);
    expect(t.pushesTo(d2)).toBe(1);
    expect(await logCount(t.env.DB)).toBe(1);

    const embed = (
      JSON.parse(t.hooks[0] ?? "{}") as {
        embeds: { title: string; description: string }[];
      }
    ).embeds[0];
    for (const d of [d1, d2]) {
      const body = t.pushed.get(`${FCM_PATH}${d.id}`)?.[0];
      expect(body).toBeDefined();
      const payload = (await decrypt(body as Uint8Array, d)) as {
        title: string;
        body: string;
        tag: string;
        url: string;
      };
      expect(payload.title).toBe(embed?.title.slice(0, 80));
      expect(payload.body).toBe(embed?.description.slice(0, 200));
      expect(payload.url).toBe("/");
      const row = await t.env.DB.prepare(
        "SELECT type, key FROM alert_log",
      ).first<{ type: string; key: string }>();
      expect(payload.tag).toBe(`${row?.type}:${row?.key}`.slice(0, 64));
    }
  });

  it("a device answering 500 stops push for the account: one attempt, both claims released, both sent next tick", async () => {
    const d = await makeDevice("d1");
    let status = 500;
    const t = await setup({
      push: { [d.route]: () => new Response(null, { status }) },
    });
    const garden = {
      ...emptyFuel(),
      visitors: [
        { id: "v1", name: "One" },
        { id: "v2", name: "Two" },
        { id: "v3", name: "Three" },
        { id: "v4", name: "Four" },
        { id: "v5", name: "Five" },
      ],
    };
    await seed(t.env.DB, { id: "a", devices: [d], garden });
    await t.run();
    expect(t.pushesTo(d)).toBe(1);
    expect(await logCount(t.env.DB)).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);

    status = 201;
    t.clock.advance(5 * MIN + 1000);
    await refreshSnapshot(t, "a", garden);
    const second = await t.run();
    expect(second.pushSent).toBe(2);
    expect(await logCount(t.env.DB)).toBe(2);
  });

  it("a push-only account returns early once the push cap is spent: no claims, still due", async () => {
    const accounts = ["acc0", "acc1", "acc2", "acc3", "acc4"];
    const devices = new Map<string, Device[]>();
    for (const id of accounts) {
      devices.set(
        id,
        await Promise.all(["a", "b", "c"].map((s) => makeDevice(`${id}${s}`))),
      );
    }
    const t = await setup({
      push: Object.fromEntries(
        [...devices.values()].flat().map((d) => [d.route, ok]),
      ),
    });
    for (const id of accounts)
      await seed(t.env.DB, { id, devices: devices.get(id) ?? [] });
    // acc4 has no fresh snapshot: without the early return it would cost a Hypixel call.
    await t.env.DB.prepare(
      "DELETE FROM garden_snapshot WHERE account_id = 'acc4'",
    ).run();
    const summary = await t.run();
    expect(summary.pushSent).toBe(MAX_PUSH_SENDS_PER_RUN);
    expect(summary.hypixelCalls).toBe(0);
    expect(await logCount(t.env.DB)).toBe(4);
    expect(await nextSync(t.env.DB, "acc4")).toBe(0);
  });

  it("deletes a device that answers 410 and still sends to the others", async () => {
    const [d1, d2] = [await makeDevice("d1"), await makeDevice("d2")];
    const t = await setup({ push: { [d1.route]: gone, [d2.route]: ok } });
    await seed(t.env.DB, { id: "a", devices: [d1, d2] });
    const summary = await t.run();
    expect(summary.pushSent).toBe(1);
    expect(t.pushesTo(d2)).toBe(1);
    expect(await subCount(t.env.DB, "a")).toBe(1);
    expect(await pushOk(t.env.DB, "a")).toBe(1);
  });

  it("keeps the claim when Discord retries but a device got the alert", async () => {
    const d = await makeDevice("d1");
    const t = await setup({ hook: fail, push: { [d.route]: ok } });
    await seed(t.env.DB, { id: "a", webhook: true, devices: [d] });
    const first = await t.run();
    expect(first).toMatchObject({ sent: 0, pushSent: 1 });
    expect(await logCount(t.env.DB)).toBe(1);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    await t.run();
    expect(t.pushesTo(d)).toBe(1); // no duplicate
    expect(t.posts()).toBe(1);
  });

  it("releases the claim and reschedules when the only channel says retry, then sends once", async () => {
    const d = await makeDevice("d1");
    let status = 500;
    const t = await setup({
      push: { [d.route]: () => new Response(null, { status }) },
    });
    await seed(t.env.DB, { id: "a", devices: [d] });
    const first = await t.run();
    expect(first.pushSent).toBe(0);
    expect(await logCount(t.env.DB)).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);

    status = 201;
    t.clock.advance(5 * MIN + 1000);
    await refreshSnapshot(t, "a");
    const second = await t.run();
    expect(second.pushSent).toBe(1);
    expect(t.pushesTo(d)).toBe(2); // the failed attempt and the delivery
    expect(await logCount(t.env.DB)).toBe(1);
  });

  it("caps a push retry delay with MAX_DISCORD_RETRY_MS", async () => {
    const d = await makeDevice("d1");
    const t = await setup({
      push: {
        [d.route]: () =>
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "99999999" },
          }),
      },
    });
    await seed(t.env.DB, { id: "a", devices: [d] });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 60 * MIN);
  });

  it("keeps the claim and deletes the device when every channel is dead", async () => {
    const d = await makeDevice("d1");
    const t = await setup({
      hook: () => new Response(null, { status: 404 }),
      push: { [d.route]: gone },
    });
    await seed(t.env.DB, { id: "a", webhook: true, devices: [d] });
    await t.run();
    expect(await logCount(t.env.DB)).toBe(1);
    expect(await subCount(t.env.DB, "a")).toBe(0);
    expect(await pushOk(t.env.DB, "a")).toBeNull();
    expect(
      await count(
        t.env.DB,
        "SELECT webhook_ok AS n FROM alert_settings WHERE account_id = 'a'",
      ),
    ).toBe(0);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    const second = await t.run();
    expect(second.due).toBe(0);
    expect(t.posts()).toBe(1);
    expect(t.totalPushes()).toBe(1);
  });

  it("skips push without VAPID keys: push-only accounts are parked, webhook accounts unaffected", async () => {
    const d = await makeDevice("d1");
    const t = await setup({ withVapid: false, push: { [d.route]: ok } });
    await seed(t.env.DB, { id: "pushonly", devices: [d] });
    await seed(t.env.DB, { id: "hooked", webhook: true, devices: [d] });
    // second account reuses the endpoint under another account id; fine for this test
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await t.run();
    expect(summary).toMatchObject({
      due: 2,
      processed: 2,
      sent: 1,
      pushSent: 0,
    });
    expect(t.totalPushes()).toBe(0);
    expect(t.posts()).toBe(1);
    expect(await nextSync(t.env.DB, "pushonly")).toBe(NOW + 60 * MIN);
    expect(await logCount(t.env.DB)).toBe(1);
    expect(err).not.toHaveBeenCalled();
  });

  it("stops after MAX_PUSH_SENDS_PER_RUN pushes; the rest are released and still due", async () => {
    expect(MAX_PUSH_SENDS_PER_RUN).toBe(12);
    const accounts = ["acc0", "acc1", "acc2", "acc3", "acc4"];
    const devices = new Map<string, Device[]>();
    for (const id of accounts) {
      devices.set(
        id,
        await Promise.all(["a", "b", "c"].map((s) => makeDevice(`${id}${s}`))),
      );
    }
    const t = await setup({
      push: Object.fromEntries(
        [...devices.values()].flat().map((d) => [d.route, ok]),
      ),
    });
    for (const id of accounts)
      await seed(t.env.DB, { id, devices: devices.get(id) ?? [] });

    const summary = await t.run();
    expect(summary.pushSent).toBe(MAX_PUSH_SENDS_PER_RUN);
    expect(await logCount(t.env.DB)).toBe(4);
    // Past the cap a push-only account returns early: still due, no claims.
    expect(await nextSync(t.env.DB, "acc4")).toBe(0);

    // Still due after the delay, and delivered then.
    t.clock.advance(6 * MIN);
    await refreshSnapshot(t, "acc4");
    const next = await t.run();
    expect(next.pushSent).toBe(3);
    expect(await logCount(t.env.DB)).toBe(5);
  });

  it("budgets worst-case sends: webhook plus 3 devices reserves n*(2+sends)", async () => {
    const devices = [
      await makeDevice("d1"),
      await makeDevice("d2"),
      await makeDevice("d3"),
    ];
    const t = await setup({
      push: Object.fromEntries(devices.map((d) => [d.route, ok])),
    });
    await seed(t.env.DB, { id: "a", webhook: true, devices });
    const { Budget } = await import("./budget");
    const spy = vi
      .spyOn(Budget.prototype, "canAfford")
      .mockImplementation((n: number) => n <= 9);
    const summary = await t.run();
    const asked = spy.mock.calls.map(([n]) => n);
    spy.mockRestore();
    // 2 (min) + 2 + 1 candidate * (2 + 4 sends) + 4 sends + 1 (dead-webhook/device cleanup)
    expect(asked).toContain(15);
    expect(summary.stoppedBecause).toBe("budget");
    expect(t.posts()).toBe(0);
    expect(t.totalPushes()).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW);
    expect(await logCount(t.env.DB)).toBe(0);
  });

  it("never logs an endpoint", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [d1, d2, d3] = [
      await makeDevice("secretone"),
      await makeDevice("secrettwo"),
      await makeDevice("secretthree"),
    ];
    const t = await setup({
      push: {
        [d1.route]: gone,
        [d2.route]: () => new Response(null, { status: 400 }),
        [d3.route]: fail,
      },
    });
    await seed(t.env.DB, { id: "a", devices: [d1, d2, d3] });
    await t.run();
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(all).toContain("cron_run");
    expect(all).toContain("push_rejected");
    expect(all).not.toContain("secret");
    expect(all).not.toContain("/fcm/send");
    expect(all).toContain("pushSent");
  });
});
