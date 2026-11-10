import {
  addDays,
  defaultAlertRules,
  questXp,
  type AlertRules,
  type Contest,
  type GardenState,
  type SyncOp,
} from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimStmt,
  loadAlertSettings,
  saveSnapshotStmt,
  saveWebhook,
  verifyWebhookStmt,
} from "./alerts/db";
import { runSync } from "./cron";
import { createRateLimitState } from "./hypixel";
import {
  CRON_BATCH,
  MAX_HYPIXEL_CALLS_PER_RUN,
  SUBREQUEST_BUDGET,
} from "./limits";
import { applyOpsToDb, createAccount } from "./sync/db";
import {
  ELITEBOT_ROUTE,
  GARDEN_ROUTE,
  START_TIME,
  happyRoutes,
  json,
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
const LINK = {
  name: "TestFarmer",
  uuid: "0123456789abcdef0123456789abcdef",
  profileId: "fedcba9876543210fedcba9876543210",
  profiles: [],
};

afterEach(() => vi.restoreAllMocks());

/** No fuel: the composter has been out since the last save, so fuel_out fires. */
function emptyFuel(over: Partial<GardenState["composter"]> = {}): GardenState {
  return garden({ fuel: 0, ...over });
}
/** Plenty of everything: no composter alert. */
function quiet(): GardenState {
  return garden({ fuel: 1e9, organicMatter: 1e9 });
}
function garden(c: Partial<GardenState["composter"]>): GardenState {
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
      ...c,
    },
  };
}

interface Seed {
  id: string;
  garden?: GardenState;
  /** Minutes old; default 1 (fresh enough to reuse). */
  snapshotAgeMin?: number;
  rules?: AlertRules;
}

async function seed(db: D1Database, s: Seed): Promise<void> {
  await createAccount(db, {
    id: s.id,
    codeHash: `hash-${s.id}`,
    link: LINK,
    now: NOW,
  });
  await applyOpsToDb(
    db,
    s.id,
    [{ t: "setAssignment", plotId: "beginner_1", cropId: "wheat" }],
    NOW,
  );
  await saveWebhook(db, s.id, HOOK, NOW);
  await verifyWebhookStmt(
    db,
    s.id,
    JSON.stringify(s.rules ?? defaultAlertRules(true)),
    NOW,
  ).run();
  if (s.garden !== undefined) {
    await saveSnapshotStmt(
      db,
      s.id,
      NOW - (s.snapshotAgeMin ?? 1) * MIN,
      s.garden,
    ).run();
  }
}

/** The cron reads the shared `contests` KV entry; a far-future fetchedAt keeps it fresh whatever the test clock does. */
async function seedContests(env: Env, contests: Contest[]): Promise<void> {
  await env.CACHE.put(
    "contests",
    JSON.stringify({
      fetchedAt: NOW + 30 * DAY,
      value: {
        contests,
        source: { name: "EliteBot", url: "https://elitebot.dev" },
      },
    }),
  );
}

const makeDue = (db: D1Database) =>
  db.prepare("UPDATE alert_settings SET next_sync_at = 0").run();
const nextSync = async (db: D1Database, id: string) =>
  (
    await db
      .prepare(
        "SELECT next_sync_at AS n FROM alert_settings WHERE account_id = ?1",
      )
      .bind(id)
      .first<{ n: number }>()
  )?.n;

function setup(routes: Record<string, FakeHandler> = {}, start = NOW) {
  const clock = makeClock(start);
  const { sleep } = makeSleep();
  const bodies: string[] = [];
  const net = routedFetch(
    happyRoutes({
      [HOOK_ROUTE]: () => new Response(null, { status: 204 }),
      ...routes,
    }),
  );
  const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/webhooks/"))
      bodies.push(String(init?.body));
    return net.fetch(input, init);
  }) as typeof fetch;
  const env = makeEnv();
  return {
    clock,
    env,
    net,
    bodies,
    run: () =>
      runSync(env, {
        fetch: recording,
        now: clock.now,
        sleep,
        hypixelState: createRateLimitState(),
      }),
    posts: () => net.calls.filter((c) => c === HOOK_ROUTE).length,
    gardenCalls: () => net.calls.filter((c) => c === GARDEN_ROUTE).length,
  };
}

describe("runSync — delivery and dedupe", () => {
  it("sends the fuel alert once across two consecutive runs", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    const first = await t.run();
    expect(first).toMatchObject({
      due: 1,
      processed: 1,
      sent: 1,
      hypixelCalls: 0,
      stoppedBecause: "done",
    });
    expect(t.posts()).toBe(1);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    await t.run();
    expect(t.posts()).toBe(1); // same lastSave -> same key -> claim lost -> no second message
  });

  it("re-arms after a refill (new last_save -> new key)", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    await saveSnapshotStmt(
      t.env.DB,
      "a",
      NOW,
      emptyFuel({ lastSave: NOW - 10 * MIN }),
    ).run();
    await makeDue(t.env.DB);
    t.clock.advance(MIN);
    await t.run();
    expect(t.posts()).toBe(2);
  });

  it("sends a contest alert once, as an embed that cannot ping", async () => {
    const t = setup();
    await seedContests(t.env, [
      { startsAt: NOW + 4 * MIN, crops: ["wheat", "carrot", "potato"] },
    ]);
    await seed(t.env.DB, { id: "a", garden: quiet() });
    await t.run();
    expect(t.posts()).toBe(1);
    const payload = JSON.parse(t.bodies[0] ?? "{}") as {
      embeds: { title: string; footer: { text: string } }[];
      allowed_mentions: unknown;
    };
    expect(payload.embeds[0]?.title).toContain("Wheat");
    expect(payload.embeds[0]?.footer.text).toMatch(/^Last synced \d+ min ago/);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("sends nothing when the rule is off", async () => {
    const t = setup();
    await seedContests(t.env, []);
    const rules = defaultAlertRules(true);
    rules.composter_fuel_out = { enabled: false };
    await seed(t.env.DB, { id: "a", garden: emptyFuel(), rules });
    await t.run();
    expect(t.posts()).toBe(0);
  });

  it("does not look at an account whose rules are all off", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, {
      id: "a",
      garden: emptyFuel(),
      rules: defaultAlertRules(false),
    });
    expect(await t.run()).toMatchObject({ due: 0, sent: 0 });
  });
});

describe("runSync — Discord failures", () => {
  it("releases the claim on a 5xx and retries next run", async () => {
    let calls = 0;
    const t = setup({
      [HOOK_ROUTE]: () =>
        new Response(null, { status: ++calls === 1 ? 500 : 204 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    const first = await t.run();
    expect(first.sent).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    const second = await t.run();
    expect(second.sent).toBe(1);
    expect(t.posts()).toBe(2);
  });

  it("honours a 429 retry_after for the reschedule", async () => {
    const t = setup({
      [HOOK_ROUTE]: () => json({ retry_after: 600 }, { status: 429 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 600_000);
  });

  it("a 404 marks the webhook dead, stops for that account, and keeps the claim", async () => {
    const t = setup({
      [HOOK_ROUTE]: () => new Response(null, { status: 404 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    expect((await loadAlertSettings(t.env.DB, "a"))?.webhookOk).toBe(false);
    expect(
      (
        await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_log").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);

    await makeDue(t.env.DB);
    t.clock.advance(MIN);
    await t.run();
    expect(t.posts()).toBe(1); // no longer due: not asked again
  });
});

describe("runSync — multiple candidates", () => {
  const threeVisitors = (): GardenState => ({
    ...emptyFuel(),
    visitors: [
      { id: "v1", name: "One" },
      { id: "v2", name: "Two" },
      { id: "v3", name: "Three" },
      { id: "v4", name: "Four" },
      { id: "v5", name: "Five" },
    ],
  });
  const logCount = async (db: D1Database) =>
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM alert_log")
        .first<{ n: number }>()
    )?.n;

  it("on a 5xx releases the failing claim and every unsent one", async () => {
    const t = setup({
      [HOOK_ROUTE]: () => new Response(null, { status: 500 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: threeVisitors() });
    await t.run();
    expect(t.posts()).toBe(1); // stopped after the first failure
    expect(await logCount(t.env.DB)).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);
  });

  it("on a dead webhook keeps all claims and marks it dead", async () => {
    const t = setup({
      [HOOK_ROUTE]: () => new Response(null, { status: 404 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: threeVisitors() });
    await t.run();
    expect(t.posts()).toBe(1);
    expect(await logCount(t.env.DB)).toBe(2);
    expect((await loadAlertSettings(t.env.DB, "a"))?.webhookOk).toBe(false);
  });

  it("clamps an absurd 429 retry_after to one hour", async () => {
    const t = setup({
      [HOOK_ROUTE]: () => json({ retry_after: 10_000_000 }, { status: 429 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 60 * MIN);
  });
});

describe("runSync — isolation, caps and budget", () => {
  it("one failing account does not block the others", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "bad", garden: emptyFuel() });
    await seed(t.env.DB, { id: "good", garden: emptyFuel() });
    const realDb = t.env.DB;
    // Fail only the per-account write batch for "bad" (its setNextSync statement binds the id first).
    const failing = Object.assign(Object.create(realDb) as D1Database, {
      batch: (stmts: D1PreparedStatement[]) =>
        stmts.some((s) => {
          const st = s as unknown as { sql: string; params: unknown[] };
          return st.sql.includes("next_sync_at") && st.params[0] === "bad";
        })
          ? Promise.reject(new Error("boom"))
          : realDb.batch(stmts),
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await runSync(
      { ...t.env, DB: failing },
      {
        fetch: t.net.fetch,
        now: t.clock.now,
        sleep: async () => undefined,
        hypixelState: createRateLimitState(),
      },
    );
    expect(summary.sent).toBe(1);
    expect(t.posts()).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("cron_account_failed");
    expect(summary.processed).toBe(1);
    expect(await nextSync(t.env.DB, "bad")).toBe(NOW + 5 * MIN); // no longer at the head of the queue
  });

  it("processes at most CRON_BATCH accounts per run, oldest first, the rest next run", async () => {
    const t = setup();
    await seedContests(t.env, []);
    for (let i = 0; i < CRON_BATCH + 2; i++)
      await seed(t.env.DB, {
        id: `acc${String(i).padStart(2, "0")}`,
        garden: quiet(),
      });
    expect(await t.run()).toMatchObject({
      due: CRON_BATCH,
      processed: CRON_BATCH,
    });
    const left = await t.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM alert_settings WHERE next_sync_at = 0",
    ).first<{ n: number }>();
    expect(left?.n).toBe(2);
    expect(await t.run()).toMatchObject({ due: 2 });
  });

  it("caps Hypixel calls per run and leaves the rest untouched", async () => {
    const t = setup();
    await seedContests(t.env, []);
    for (let i = 0; i < CRON_BATCH; i++)
      await seed(t.env.DB, { id: `acc${String(i).padStart(2, "0")}` }); // no snapshot
    const summary = await t.run();
    expect(t.gardenCalls()).toBe(MAX_HYPIXEL_CALLS_PER_RUN);
    expect(summary.hypixelCalls).toBe(MAX_HYPIXEL_CALLS_PER_RUN);
    expect(summary.subrequests).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    const untouched = await t.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM alert_settings WHERE next_sync_at = 0",
    ).first<{ n: number }>();
    expect(untouched?.n).toBe(CRON_BATCH - MAX_HYPIXEL_CALLS_PER_RUN);
  });

  it("reuses a fresh snapshot and refetches a stale one", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "fresh", garden: quiet(), snapshotAgeMin: 1 });
    await seed(t.env.DB, { id: "stale", garden: quiet(), snapshotAgeMin: 10 });
    await t.run();
    expect(t.gardenCalls()).toBe(1);
    const row = await t.env.DB.prepare(
      "SELECT fetched_at AS f FROM garden_snapshot WHERE account_id = 'stale'",
    ).first<{ f: number }>();
    expect(row?.f).toBe(NOW);
  });

  it("stops the whole run when Hypixel rejects the key", async () => {
    const t = setup({
      [GARDEN_ROUTE]: () =>
        json({ success: false, cause: "Invalid API key" }, { status: 403 }),
    });
    await seedContests(t.env, []);
    for (const id of ["a", "b", "c"]) await seed(t.env.DB, { id });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await t.run();
    expect(summary.stoppedBecause).toBe("hypixel_key");
    expect(t.gardenCalls()).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("hypixel_key_rejected");
  });

  it("stops the whole run on a 401 too", async () => {
    const t = setup({
      [GARDEN_ROUTE]: () => json({ success: false }, { status: 401 }),
    });
    await seedContests(t.env, []);
    for (const id of ["a", "b"]) await seed(t.env.DB, { id });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await t.run();
    expect(summary.stoppedBecause).toBe("hypixel_key");
    expect(t.gardenCalls()).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("hypixel_key_rejected");
  });

  it("defers an account (due now, no claims) when the budget cannot cover its alerts", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    // 3 visitors + fuel_out = 2 candidates; leave too little room by running after a big spend.
    const real = t.env.DB;
    let first = true;
    const tight = Object.assign(Object.create(real) as D1Database, {
      batch: (stmts: D1PreparedStatement[]) => {
        // loadAccountData is the first batch; everything after is per account.
        if (first) {
          first = false;
          return real.batch(stmts);
        }
        return real.batch(stmts);
      },
    });
    const { Budget } = await import("./budget");
    const spy = vi
      .spyOn(Budget.prototype, "canAfford")
      .mockImplementation(function (
        this: InstanceType<typeof Budget>,
        n: number,
      ) {
        return n <= 3; // only trivial work fits
      });
    const summary = await runSync(
      { ...t.env, DB: tight },
      {
        fetch: t.net.fetch,
        now: t.clock.now,
        sleep: async () => undefined,
        hypixelState: createRateLimitState(),
      },
    );
    spy.mockRestore();
    expect(summary.stoppedBecause).toBe("budget");
    expect(t.posts()).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW);
    expect(
      (
        await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_log").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });

  it("backs an account off when Hypixel is down, and carries on", async () => {
    const t = setup({
      [GARDEN_ROUTE]: () => new Response("down", { status: 500 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a" });
    const summary = await t.run();
    expect(summary.stoppedBecause).toBe("done");
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);
  });
});

describe("runSync — scheduling", () => {
  it("checks again in 15 minutes when nothing is coming up", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: quiet() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 15 * MIN);
  });
  it("checks again in 5 minutes when a contest alert is about to fire", async () => {
    const t = setup();
    await seedContests(t.env, [{ startsAt: NOW + 15 * MIN, crops: ["wheat"] }]);
    await seed(t.env.DB, { id: "a", garden: quiet() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);
  });
});

describe("runSync — housekeeping and secrecy", () => {
  it("prunes the alert log on the run that crosses UTC midnight, not on others", async () => {
    const midnight = Date.UTC(2026, 9, 2, 0, 1, 0);
    const t = setup({}, midnight);
    await seed(t.env.DB, { id: "a" });
    await claimStmt(t.env.DB, "a", "t", "old", midnight - 8 * DAY).run();
    await claimStmt(t.env.DB, "a", "t", "new", midnight - DAY).run();
    await t.env.DB.prepare("UPDATE alert_settings SET webhook_ok = 0").run(); // nothing due; prune still runs
    await t.run();
    const keys = (
      await t.env.DB.prepare("SELECT key FROM alert_log").all<{ key: string }>()
    ).results.map((r) => r.key);
    expect(keys).toEqual(["new"]);

    await claimStmt(t.env.DB, "a", "t", "old2", midnight - 9 * DAY).run();
    t.clock.advance(5 * MIN);
    await t.run();
    expect(
      (
        await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_log").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(2);
  });

  it("never writes the webhook URL or token to any log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = setup({
      [HOOK_ROUTE]: () => new Response(null, { status: 404 }),
    });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(all).not.toContain("abcDEF_ghi-123");
    expect(all).not.toContain("123456789012345678");
  });

  it("continues without contest alerts when the contest sources are down", async () => {
    const t = setup({
      [ELITEBOT_ROUTE]: () => new Response("x", { status: 500 }),
    });
    await seed(t.env.DB, { id: "a", garden: emptyFuel() }); // no seeded contests, cache miss, source down
    const summary = await t.run();
    expect(summary.sent).toBe(1); // the fuel alert still goes out
  });
});

describe("runSync — streak_risk guard", () => {
  const HOUR = 60 * MIN;
  /** 22:00 in Warsaw (CEST): the quest day resets at 22:00Z, two hours away. */
  const WIN = Date.UTC(2026, 9, 1, 20, 0, 0);
  const DAY_KEY = "2026-10-01";

  function streakRules(over: Partial<AlertRules["streak_risk"]> = {}) {
    const rules = defaultAlertRules(true);
    rules.streak_risk = { enabled: true, leadHours: 3, ...over };
    return rules;
  }

  /** `streak` previous quest days done; today's three quests created, not done. */
  async function seedStreak(
    t: ReturnType<typeof setup>,
    opts: {
      streak: number;
      todayQuests?: boolean;
      served?: number;
      waterQuest?: boolean;
      rules?: AlertRules;
      start?: number;
    },
  ): Promise<void> {
    const start = opts.start ?? WIN;
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", rules: opts.rules ?? streakRules() });
    await saveSnapshotStmt(t.env.DB, "a", start - MIN, {
      ...quiet(),
      visitorsServedTotal: opts.served ?? 0,
    }).run();
    const params = { profileId: LINK.profileId, target: 3 };
    const ops: SyncOp[] = [];
    for (let k = 1; k <= opts.streak; k++) {
      const day = addDays(DAY_KEY, -k);
      ops.push({
        t: "setQuests",
        day,
        quests: [
          {
            day,
            slot: 0,
            kind: "serve_visitors",
            params,
            baseline: 0,
            createdAt: start - k * DAY,
            expiresAt: start - k * DAY + DAY,
            doneAt: start - k * DAY + HOUR,
            xp: questXp("serve_visitors"),
          },
        ],
      });
    }
    if (opts.todayQuests !== false) {
      ops.push({
        t: "setQuests",
        day: DAY_KEY,
        quests: [0, 1, 2].map((slot) => ({
          day: DAY_KEY,
          slot,
          kind:
            opts.waterQuest === true && slot === 1
              ? "water_greenhouse"
              : "serve_visitors",
          params: { ...params, target: slot === 0 ? 3 : 100 },
          baseline: 0,
          createdAt: start - 6 * HOUR,
          expiresAt: start + 2 * HOUR,
          doneAt: null,
          xp: questXp("serve_visitors"),
        })),
      });
    }
    await applyOpsToDb(t.env.DB, "a", ops, start - 7 * HOUR);
  }

  const revision = async (db: D1Database) =>
    (
      await db
        .prepare("SELECT revision AS r FROM accounts WHERE id = 'a'")
        .first<{ r: number }>()
    )?.r;
  const doneToday = async (db: D1Database) =>
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM quest_log WHERE account_id = 'a' AND day = ?1 AND done_at IS NOT NULL",
        )
        .bind(DAY_KEY)
        .first<{ n: number }>()
    )?.n;
  const streakKeys = async (db: D1Database) =>
    (
      await db
        .prepare("SELECT key FROM alert_log WHERE type = 'streak_risk'")
        .all<{ key: string }>()
    ).results.map((r) => r.key);

  it("sends one alert for a live streak with nothing done, and dedupes", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 5 });
    await t.run();
    expect(t.posts()).toBe(1);
    const payload = JSON.parse(t.bodies[0] ?? "{}") as {
      embeds: { title: string }[];
    };
    expect(payload.embeds[0]?.title).toContain("5-day streak");
    expect(await streakKeys(t.env.DB)).toEqual([`streak:${DAY_KEY}`]);
    expect(await doneToday(t.env.DB)).toBe(0);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    await t.run();
    expect(t.posts()).toBe(1);
  });

  it("stays silent and records the completion when the garden already shows it", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 5, served: 5 });
    const before = await revision(t.env.DB);
    await t.run();
    expect(t.posts()).toBe(0);
    expect(await doneToday(t.env.DB)).toBe(1);
    expect(await revision(t.env.DB)).toBe((before ?? 0) + 1);
    expect(await streakKeys(t.env.DB)).toEqual([]);
  });

  it("treats a streak with no quest rows for today as at risk", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 4, todayQuests: false });
    await t.run();
    expect(t.posts()).toBe(1);
  });

  it("does nothing, and reads no quests, outside the window", async () => {
    const start = Date.UTC(2026, 9, 1, 12, 0, 0); // reset is 10 h away
    const t = setup({}, start);
    await seedStreak(t, { streak: 5, start });
    const prepare = vi.spyOn(t.env.DB, "prepare");
    await t.run();
    expect(t.posts()).toBe(0);
    expect(
      prepare.mock.calls.filter(([sql]) => sql.includes("quest_log")),
    ).toHaveLength(0);
    expect(t.gardenCalls()).toBe(0);
  });

  it("stays silent below the minimum streak", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 2 });
    await t.run();
    expect(t.posts()).toBe(0);
  });

  it("stays silent when the rule is off", async () => {
    const t = setup({}, WIN);
    const rules = streakRules({ enabled: false });
    await seedStreak(t, { streak: 5, rules });
    const prepare = vi.spyOn(t.env.DB, "prepare");
    await t.run();
    expect(t.posts()).toBe(0);
    expect(
      prepare.mock.calls.filter(([sql]) => sql.includes("quest_log")),
    ).toHaveLength(0);
  });

  it("skips the check without alerting or throwing when the budget is short", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 5, served: 5 });
    const { Budget } = await import("./budget");
    // Refuse only the guard's own reserve (read 4 + bump 1 + 3 completions + min account cost).
    const spy = vi
      .spyOn(Budget.prototype, "canAfford")
      .mockImplementation((n: number) => n !== 4 + 1 + 3 + 2);
    const summary = await t.run();
    const asked = spy.mock.calls.map(([n]) => n);
    expect(asked).toContain(10);
    spy.mockRestore();
    expect(summary.processed).toBe(1);
    expect(t.posts()).toBe(0);
    expect(await doneToday(t.env.DB)).toBe(0);
  });

  it("does not credit user-logged waterings, so the alert still fires", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 5, waterQuest: true });
    await applyOpsToDb(
      t.env.DB,
      "a",
      [
        { t: "markGreenhouse", plotId: "beginner_1" },
        { t: "markGreenhouseWatered", plotId: "beginner_1", at: WIN - HOUR },
      ],
      WIN,
    );
    await t.run();
    expect(await doneToday(t.env.DB)).toBe(0);
    expect(await streakKeys(t.env.DB)).toEqual([`streak:${DAY_KEY}`]);
  });

  it("never alerts when the check itself fails", async () => {
    const t = setup({}, WIN);
    await seedStreak(t, { streak: 5 });
    const real = t.env.DB;
    const flaky = Object.assign(Object.create(real) as D1Database, {
      batch: (stmts: D1PreparedStatement[]) =>
        stmts.some((s) =>
          (s as unknown as { sql: string }).sql.includes("FROM quest_log"),
        )
          ? Promise.reject(new Error("boom"))
          : real.batch(stmts),
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runSync(
      { ...t.env, DB: flaky },
      {
        fetch: t.net.fetch,
        now: t.clock.now,
        sleep: async () => undefined,
        hypixelState: createRateLimitState(),
      },
    );
    expect(t.posts()).toBe(0);
    expect(err.mock.calls.flat().join(" ")).toContain(
      "cron_streak_check_failed",
    );
  });
});
