import { defaultAlertRules, type GardenState } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { makeD1 } from "../../test/d1";
import { ALERT_LOG_RETENTION_MS, INACTIVE_ACCOUNT_MS } from "../limits";
import { applyOpsToDb, createAccount, deleteAccount } from "../sync/db";
import {
  claimStmt,
  countWebhooks,
  loadAccountData,
  loadAlertSettings,
  loadDueAccounts,
  markWebhookDeadStmt,
  parseSnapshot,
  pruneAlertLogStmt,
  releaseClaimStmt,
  removeAlertSettings,
  saveRules,
  saveSnapshotStmt,
  saveWebhook,
  setNextSyncStmt,
  verifyWebhookStmt,
} from "./db";

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const MIN = 60_000;
const HOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";
const LINK = {
  name: "TestFarmer",
  uuid: "0123456789abcdef0123456789abcdef",
  profileId: "fedcba9876543210fedcba9876543210",
  profiles: [],
};
const RULES_JSON = JSON.stringify(defaultAlertRules(true));

const GARDEN: GardenState = {
  level: 8,
  experience: 10,
  unlockedPlotIds: ["beginner_1"],
  visitorsServedTotal: 0,
  visitors: [],
  greenhouse: { lockedCells: [] },
  composter: {
    organicMatter: 1,
    fuel: 0,
    compostUnits: 0,
    lastSave: NOW,
    upgrades: {
      speed: 0,
      multiDrop: 0,
      fuelCap: 0,
      organicMatterCap: 0,
      costReduction: 0,
    },
  },
};

async function account(
  db: D1Database,
  id: string,
  opts: { webhook?: boolean; verified?: boolean; lastSeen?: number } = {},
) {
  await createAccount(db, {
    id,
    codeHash: `hash-${id}`,
    link: LINK,
    now: opts.lastSeen ?? NOW,
  });
  if (opts.webhook !== false) await saveWebhook(db, id, HOOK, NOW);
  if (opts.verified) await verifyWebhookStmt(db, id, RULES_JSON, NOW).run();
  // saveWebhook counts as activity; restore the requested last-seen time.
  if (opts.lastSeen !== undefined) {
    await db
      .prepare("UPDATE accounts SET last_seen_at = ?2 WHERE id = ?1")
      .bind(id, opts.lastSeen)
      .run();
  }
}

describe("alert settings", () => {
  it("saves a webhook as untested with no rules", async () => {
    const db = makeD1();
    await account(db, "a");
    expect(await loadAlertSettings(db, "a")).toEqual({
      webhook: HOOK,
      webhookOk: null,
      rules: null,
    });
    expect(await countWebhooks(db)).toBe(1);
  });
  it("verifying marks it ok and seeds default rules only once", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    const first = await loadAlertSettings(db, "a");
    expect(first?.webhookOk).toBe(true);
    expect(first?.rules?.contest_soon.enabled).toBe(true);
    const custom = defaultAlertRules(true);
    custom.contest_soon = { enabled: false, leadMinutes: 9 };
    await saveRules(db, "a", custom, NOW);
    await verifyWebhookStmt(db, "a", RULES_JSON, NOW).run();
    expect((await loadAlertSettings(db, "a"))?.rules?.contest_soon).toEqual({
      enabled: false,
      leadMinutes: 9,
    });
  });
  it("replacing the webhook resets the test status but keeps the rules", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await saveWebhook(db, "a", `${HOOK}x`, NOW);
    const s = await loadAlertSettings(db, "a");
    expect(s?.webhookOk).toBeNull();
    expect(s?.rules).not.toBeNull();
  });
  it("marks a webhook dead", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await markWebhookDeadStmt(db, "a", NOW).run();
    expect((await loadAlertSettings(db, "a"))?.webhookOk).toBe(false);
  });
  it("a corrupt stored rules blob reads as null", async () => {
    const db = makeD1();
    await account(db, "a");
    await db
      .prepare(
        "UPDATE alert_settings SET rules = 'not json' WHERE account_id = 'a'",
      )
      .run();
    expect((await loadAlertSettings(db, "a"))?.rules).toBeNull();
  });
  it("removeAlertSettings deletes settings, snapshot and log", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await db.batch([
      saveSnapshotStmt(db, "a", NOW, GARDEN),
      claimStmt(db, "a", "contest_soon", "k", NOW),
    ]);
    await removeAlertSettings(db, "a");
    for (const t of ["alert_settings", "garden_snapshot", "alert_log"]) {
      expect(
        (
          await db
            .prepare(`SELECT COUNT(*) AS n FROM ${t}`)
            .first<{ n: number }>()
        )?.n,
      ).toBe(0);
    }
  });
});

describe("loadDueAccounts", () => {
  it("returns only verified, working accounts with an enabled rule", async () => {
    const db = makeD1();
    await account(db, "untested");
    await account(db, "ok", { verified: true });
    await account(db, "dead", { verified: true });
    await markWebhookDeadStmt(db, "dead", NOW).run();
    await account(db, "off", { verified: true });
    await saveRules(db, "off", defaultAlertRules(false), NOW);
    const due = await loadDueAccounts(db, NOW, 10);
    expect(due.map((d) => d.accountId)).toEqual(["ok"]);
    expect(due[0]).toMatchObject({
      webhook: HOOK,
      profileId: LINK.profileId,
      snapshotJson: null,
      snapshotFetchedAt: null,
    });
  });
  it("honours next_sync_at with the cron slack, ordering and limit", async () => {
    const db = makeD1();
    for (const id of ["a", "b", "c", "d"])
      await account(db, id, { verified: true });
    await setNextSyncStmt(db, "a", NOW + 30_000).run(); // inside the 60 s slack: due
    await setNextSyncStmt(db, "b", NOW + 5 * MIN).run(); // not due
    await setNextSyncStmt(db, "c", NOW - 10 * MIN).run(); // most overdue: first
    await setNextSyncStmt(db, "d", NOW - 1 * MIN).run();
    expect(
      (await loadDueAccounts(db, NOW, 10)).map((d) => d.accountId),
    ).toEqual(["c", "d", "a"]);
    expect(await loadDueAccounts(db, NOW, 2)).toHaveLength(2);
  });
  it("skips accounts inactive for 60 days", async () => {
    const db = makeD1();
    await account(db, "old", {
      verified: true,
      lastSeen: NOW - INACTIVE_ACCOUNT_MS - MIN,
    });
    await account(db, "new", { verified: true });
    expect(
      (await loadDueAccounts(db, NOW, 10)).map((d) => d.accountId),
    ).toEqual(["new"]);
  });
  it("includes the stored snapshot", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await saveSnapshotStmt(db, "a", NOW - MIN, GARDEN).run();
    const [row] = await loadDueAccounts(db, NOW, 10);
    expect(row?.snapshotFetchedAt).toBe(NOW - MIN);
    expect(
      parseSnapshot(row?.snapshotJson ?? null, row?.snapshotFetchedAt ?? null),
    ).toEqual({ garden: GARDEN, fetchedAt: NOW - MIN });
  });
});

describe("parseSnapshot", () => {
  it("rejects missing, corrupt, wrong-version and invalid snapshots", () => {
    expect(parseSnapshot(null, null)).toBeNull();
    expect(parseSnapshot("nope", 1)).toBeNull();
    expect(
      parseSnapshot(JSON.stringify({ v: 99, garden: GARDEN }), 1),
    ).toBeNull();
    expect(
      parseSnapshot(JSON.stringify({ v: 1, garden: { level: 1 } }), 1),
    ).toBeNull();
  });
});

describe("loadAccountData", () => {
  it("returns assignments and greenhouse plans per account", async () => {
    const db = makeD1();
    await account(db, "a");
    await account(db, "b");
    await applyOpsToDb(
      db,
      "a",
      [
        { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
        { t: "markGreenhouse", plotId: "beginner_2" },
        { t: "setWateringInterval", plotId: "beginner_2", hours: 6 },
        { t: "markGreenhouseWatered", plotId: "beginner_2", at: NOW },
      ],
      NOW,
    );
    const data = await loadAccountData(db, ["a", "b"]);
    expect(data.get("a")).toEqual({
      assignments: { beginner_1: "wheat" },
      greenhouses: {
        beginner_2: { lastWateredAt: NOW, wateringIntervalHours: 6 },
      },
    });
    expect(data.get("b")).toEqual({ assignments: {}, greenhouses: {} });
  });
  it("is empty for no ids", async () => {
    expect((await loadAccountData(makeD1(), [])).size).toBe(0);
  });
});

describe("claims and pruning", () => {
  it("a claim wins once, can be released, and wins again", async () => {
    const db = makeD1();
    await account(db, "a");
    const changes = async (s: D1PreparedStatement) =>
      (await s.run()).meta.changes;
    expect(await changes(claimStmt(db, "a", "contest_soon", "k", NOW))).toBe(1);
    expect(await changes(claimStmt(db, "a", "contest_soon", "k", NOW))).toBe(0);
    expect(
      await changes(claimStmt(db, "a", "composter_fuel_out", "k", NOW)),
    ).toBe(1);
    await releaseClaimStmt(db, "a", "contest_soon", "k").run();
    expect(await changes(claimStmt(db, "a", "contest_soon", "k", NOW))).toBe(1);
  });
  it("prunes only rows older than the retention", async () => {
    const db = makeD1();
    await account(db, "a");
    await claimStmt(
      db,
      "a",
      "t",
      "old",
      NOW - ALERT_LOG_RETENTION_MS - MIN,
    ).run();
    await claimStmt(db, "a", "t", "new", NOW - MIN).run();
    await pruneAlertLogStmt(db, NOW).run();
    const rows = await db
      .prepare("SELECT key FROM alert_log")
      .all<{ key: string }>();
    expect(rows.results.map((r) => r.key)).toEqual(["new"]);
  });
});

describe("deleteAccount", () => {
  it("removes alert rows with the account", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await db.batch([
      saveSnapshotStmt(db, "a", NOW, GARDEN),
      claimStmt(db, "a", "t", "k", NOW),
    ]);
    await deleteAccount(db, "a");
    for (const t of ["alert_settings", "garden_snapshot", "alert_log"]) {
      expect(
        (
          await db
            .prepare(`SELECT COUNT(*) AS n FROM ${t}`)
            .first<{ n: number }>()
        )?.n,
      ).toBe(0);
    }
  });
});
