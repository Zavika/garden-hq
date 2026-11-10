import { defaultAlertRules } from "@garden-hq/core";
import { describe, expect, it, vi } from "vitest";
import { makeD1 } from "../../test/d1";
import { createAccount } from "../sync/db";
import {
  countAlertingAccounts,
  loadAlertSettings,
  loadDueAccounts,
  markWebhookDeadStmt,
  verifyWebhookStmt,
  removeAlertSettings,
  saveSnapshotStmt,
  saveWebhook,
  claimStmt,
} from "./db";
import {
  countPushAccounts,
  countSubscriptions,
  deleteSubscription,
  isAllowedPushEndpoint,
  listSubscriptions,
  loadSubscriptionsFor,
  parsePushSubscription,
  upsertSubscription,
  verifyPushStmt,
} from "./push";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const HOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";
const LINK = {
  name: "TestFarmer",
  uuid: "0123456789abcdef0123456789abcdef",
  profileId: "fedcba9876543210fedcba9876543210",
  profiles: [],
};
const RULES_JSON = JSON.stringify(defaultAlertRules(true));
const FCM = "https://fcm.googleapis.com/fcm/send/";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomKey(len: number, first?: number): Uint8Array {
  const out = crypto.getRandomValues(new Uint8Array(len));
  if (first !== undefined) out[0] = first;
  return out;
}
const P256DH = b64url(randomKey(65, 0x04));
const AUTH = b64url(randomKey(16));
function sub(n: number) {
  return { endpoint: `${FCM}${n}`, p256dh: P256DH, auth: AUTH };
}

async function account(db: D1Database, id: string) {
  await createAccount(db, { id, codeHash: `hash-${id}`, link: LINK, now: NOW });
}
async function count(db: D1Database, table: string): Promise<number> {
  return (
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

describe("isAllowedPushEndpoint", () => {
  it("accepts the known push services", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/Q",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isAllowedPushEndpoint(u)).toBe(true);
    }
  });
  it("rejects look-alikes, insecure, credentials, ports and junk", () => {
    for (const u of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "http://web.push.apple.com/Q",
      "https://evil.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "https://notfcm.googleapis.com.example/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "ftp://fcm.googleapis.com/x",
      "",
      `https://fcm.googleapis.com/${"a".repeat(2049)}`,
    ]) {
      expect(isAllowedPushEndpoint(u)).toBe(false);
    }
    for (const v of [
      null,
      undefined,
      5,
      {},
      ["https://web.push.apple.com/Q"],
    ]) {
      expect(isAllowedPushEndpoint(v)).toBe(false);
    }
  });
});

describe("parsePushSubscription", () => {
  const good = { endpoint: `${FCM}abc`, keys: { p256dh: P256DH, auth: AUTH } };
  it("accepts a real-length subscription", () => {
    expect(parsePushSubscription(good)).toEqual({
      endpoint: `${FCM}abc`,
      p256dh: P256DH,
      auth: AUTH,
    });
  });
  it("rejects bad keys and shapes", () => {
    const withKeys = (keys: Record<string, unknown>) => ({
      endpoint: good.endpoint,
      keys,
    });
    expect(
      parsePushSubscription(
        withKeys({ p256dh: b64url(randomKey(64, 0x04)), auth: AUTH }),
      ),
    ).toBeNull();
    expect(
      parsePushSubscription(
        withKeys({ p256dh: b64url(randomKey(66, 0x04)), auth: AUTH }),
      ),
    ).toBeNull();
    expect(
      parsePushSubscription(
        withKeys({ p256dh: b64url(randomKey(65, 0x03)), auth: AUTH }),
      ),
    ).toBeNull();
    expect(
      parsePushSubscription(
        withKeys({ p256dh: P256DH, auth: b64url(randomKey(15)) }),
      ),
    ).toBeNull();
    expect(
      parsePushSubscription(
        withKeys({ p256dh: P256DH, auth: b64url(randomKey(17)) }),
      ),
    ).toBeNull();
    // standard base64 (with + / =) is not base64url
    const std = btoa(String.fromCharCode(...randomKey(16, 0xfb)));
    expect(
      parsePushSubscription(withKeys({ p256dh: P256DH, auth: std })),
    ).toBeNull();
    const stdPub = btoa(String.fromCharCode(...randomKey(65, 0x04))) + "=";
    expect(
      parsePushSubscription(withKeys({ p256dh: stdPub, auth: AUTH })),
    ).toBeNull();
    expect(parsePushSubscription({ endpoint: good.endpoint })).toBeNull();
    expect(
      parsePushSubscription({ endpoint: good.endpoint, keys: { auth: AUTH } }),
    ).toBeNull();
    expect(parsePushSubscription({ keys: good.keys })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
    expect(
      parsePushSubscription({ ...good, endpoint: "https://evil.com/x" }),
    ).toBeNull();
  });
});

describe("push subscriptions db", () => {
  it("upsert is idempotent and creates a rules-less settings row", async () => {
    const db = makeD1();
    await account(db, "a");
    await upsertSubscription(db, "a", sub(1), NOW);
    await upsertSubscription(db, "a", sub(1), NOW + 1000);
    const list = await listSubscriptions(db, "a");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      endpoint: `${FCM}1`,
      createdAt: NOW + 1000,
    });
    expect(await loadAlertSettings(db, "a")).toEqual({
      webhook: null,
      webhookOk: null,
      pushOk: null,
      rules: null,
    });
    const seen = await db
      .prepare("SELECT last_seen_at FROM accounts WHERE id = 'a'")
      .first<{ last_seen_at: number }>();
    expect(seen?.last_seen_at).toBe(NOW + 1000);
  });
  it("countSubscriptions counts per account", async () => {
    const db = makeD1();
    await account(db, "a");
    await account(db, "b");
    expect(await countSubscriptions(db, "a")).toBe(0);
    await upsertSubscription(db, "a", sub(1), NOW);
    await upsertSubscription(db, "a", sub(2), NOW + 1);
    await upsertSubscription(db, "b", sub(3), NOW);
    expect(await countSubscriptions(db, "a")).toBe(2);
    expect(await countSubscriptions(db, "b")).toBe(1);
  });
  it("keeps an existing webhook and rules when push is added", async () => {
    const db = makeD1();
    await account(db, "a");
    await saveWebhook(db, "a", HOOK, NOW);
    await upsertSubscription(db, "a", sub(1), NOW);
    expect((await loadAlertSettings(db, "a"))?.webhook).toBe(HOOK);
  });
  it("a 4th device evicts the oldest", async () => {
    const db = makeD1();
    await account(db, "a");
    for (let i = 1; i <= 4; i++) {
      await upsertSubscription(db, "a", sub(i), NOW + i);
    }
    expect((await listSubscriptions(db, "a")).map((s) => s.endpoint)).toEqual([
      `${FCM}2`,
      `${FCM}3`,
      `${FCM}4`,
    ]);
  });
  it("equal timestamps evict by insertion order and never the new device", async () => {
    const db = makeD1();
    await account(db, "a");
    // Endpoints chosen so the newest one sorts lowest alphabetically.
    const eps = ["d", "c", "b", "a"].map((x) => ({
      ...sub(0),
      endpoint: `${FCM}${x}`,
    }));
    for (const e of eps) await upsertSubscription(db, "a", e, NOW);
    expect(
      (await listSubscriptions(db, "a")).map((s) => s.endpoint).sort(),
    ).toEqual([`${FCM}a`, `${FCM}b`, `${FCM}c`]);
  });
  it("countAlertingAccounts counts webhook-only, push-only and both once", async () => {
    const db = makeD1();
    for (const id of ["w", "p", "b", "none"]) await account(db, id);
    await saveWebhook(db, "w", HOOK, NOW);
    await upsertSubscription(db, "p", sub(1), NOW);
    await saveWebhook(db, "b", HOOK, NOW);
    await upsertSubscription(db, "b", sub(2), NOW);
    await upsertSubscription(db, "b", sub(3), NOW + 1);
    expect(await countAlertingAccounts(db)).toBe(3);
    expect(await countPushAccounts(db)).toBe(2);
  });
  it("removing the webhook keeps push, rules, snapshot and log", async () => {
    const db = makeD1();
    await account(db, "a");
    await saveWebhook(db, "a", HOOK, NOW);
    await upsertSubscription(db, "a", sub(1), NOW);
    await verifyPushStmt(db, "a", RULES_JSON, NOW).run();
    await claimStmt(db, "a", "t", "k", NOW).run();
    await removeAlertSettings(db, "a", NOW + 5);
    const s = await loadAlertSettings(db, "a");
    expect(s).toMatchObject({ webhook: null, webhookOk: null, pushOk: true });
    expect(s?.rules).not.toBeNull();
    const upd = await db
      .prepare("SELECT updated_at FROM alert_settings WHERE account_id = 'a'")
      .first<{ updated_at: number }>();
    expect(upd?.updated_at).toBe(NOW + 5);
    expect(await count(db, "alert_log")).toBe(1);
    expect(await listSubscriptions(db, "a")).toHaveLength(1);
  });
  it("removing the webhook with no subscriptions deletes the row", async () => {
    const db = makeD1();
    await account(db, "a");
    await saveWebhook(db, "a", HOOK, NOW);
    await removeAlertSettings(db, "a", NOW + 5);
    expect(await loadAlertSettings(db, "a")).toBeNull();
  });
  it("removing the last subscription with no webhook deletes the row", async () => {
    const db = makeD1();
    await account(db, "a");
    await upsertSubscription(db, "a", sub(1), NOW);
    await upsertSubscription(db, "a", sub(2), NOW + 1);
    await verifyPushStmt(db, "a", RULES_JSON, NOW).run();
    await claimStmt(db, "a", "t", "k", NOW).run();
    await saveSnapshotStmt(db, "a", NOW, {
      level: 1,
      experience: 0,
      unlockedPlotIds: [],
      visitorsServedTotal: 0,
      visitors: [],
      greenhouse: { lockedCells: [] },
      composter: {
        organicMatter: 0,
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
    }).run();
    await deleteSubscription(db, "a", `${FCM}1`);
    expect(await loadAlertSettings(db, "a")).not.toBeNull();
    expect(await count(db, "alert_log")).toBe(1);
    await deleteSubscription(db, "a", `${FCM}2`);
    expect(await loadAlertSettings(db, "a")).toBeNull();
    expect(await count(db, "alert_log")).toBe(0);
    expect(await count(db, "garden_snapshot")).toBe(0);
  });
  it("removing the last subscription keeps a webhook account and resets push_ok", async () => {
    const db = makeD1();
    await account(db, "a");
    await saveWebhook(db, "a", HOOK, NOW);
    await upsertSubscription(db, "a", sub(1), NOW);
    await verifyPushStmt(db, "a", RULES_JSON, NOW).run();
    await deleteSubscription(db, "a", `${FCM}1`);
    expect(await loadAlertSettings(db, "a")).toMatchObject({
      webhook: HOOK,
      pushOk: null,
    });
  });
  it("loadDueAccounts includes verified push-only accounts, not untested ones", async () => {
    const db = makeD1();
    await account(db, "ok");
    await account(db, "untested");
    await upsertSubscription(db, "ok", sub(1), NOW);
    await upsertSubscription(db, "untested", sub(2), NOW);
    await verifyPushStmt(db, "ok", RULES_JSON, NOW).run();
    const due = await loadDueAccounts(db, NOW, 10);
    expect(due.map((d) => d.accountId)).toEqual(["ok"]);
    expect(due[0]?.webhook).toBeNull();
  });
  it("loadDueAccounts only returns a webhook that is verified working", async () => {
    const db = makeD1();
    for (const id of ["dead", "untested", "good"]) {
      await account(db, id);
      await saveWebhook(db, id, HOOK, NOW);
      await upsertSubscription(db, id, sub(1), NOW);
      await verifyPushStmt(db, id, RULES_JSON, NOW).run();
    }
    await markWebhookDeadStmt(db, "dead", NOW).run();
    await verifyWebhookStmt(db, "good", RULES_JSON, NOW).run();
    const due = new Map(
      (await loadDueAccounts(db, NOW, 10)).map((d) => [d.accountId, d.webhook]),
    );
    expect(due.get("dead")).toBeNull();
    expect(due.get("untested")).toBeNull();
    expect(due.get("good")).toBe(HOOK);
  });
  it("loadDueAccounts excludes push_ok accounts that lost all subscriptions", async () => {
    const db = makeD1();
    await account(db, "a");
    await upsertSubscription(db, "a", sub(1), NOW);
    await verifyPushStmt(db, "a", RULES_JSON, NOW).run();
    await db.prepare("DELETE FROM push_subscriptions").run();
    expect(await loadDueAccounts(db, NOW, 10)).toEqual([]);
  });
});

describe("loadSubscriptionsFor", () => {
  it("returns devices grouped by account in one statement, only for verified push", async () => {
    const db = makeD1();
    for (const id of ["a", "b", "unverified", "other"]) await account(db, id);
    await upsertSubscription(db, "a", sub(1), NOW);
    await upsertSubscription(db, "a", sub(2), NOW + 1);
    await upsertSubscription(db, "b", sub(3), NOW);
    await upsertSubscription(db, "unverified", sub(4), NOW);
    await upsertSubscription(db, "other", sub(5), NOW);
    for (const id of ["a", "b", "other"])
      await verifyPushStmt(db, id, RULES_JSON, NOW).run();

    const prepare = vi.spyOn(db, "prepare");
    const map = await loadSubscriptionsFor(db, ["a", "b", "unverified"]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(map.get("a")?.map((s) => s.endpoint)).toEqual([
      `${FCM}1`,
      `${FCM}2`,
    ]);
    expect(map.get("b")?.map((s) => s.endpoint)).toEqual([`${FCM}3`]);
    expect(map.has("unverified")).toBe(false);
    expect(map.has("other")).toBe(false);
    expect((await loadSubscriptionsFor(db, [])).size).toBe(0);
  });
});
