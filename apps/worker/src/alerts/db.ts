import {
  defaultAlertRules,
  parseAlertRules,
  parseGardenState,
  type AlertRules,
  type GardenState,
  type GreenhousePlan,
} from "@garden-hq/core";
import {
  ALERT_LOG_RETENTION_MS,
  CRON_SLACK_MS,
  INACTIVE_ACCOUNT_MS,
} from "../limits";

export const SNAPSHOT_VERSION = 1;

export interface AlertSettingsRow {
  webhook: string | null;
  /** null = never tested. */
  webhookOk: boolean | null;
  /** null = never tested; true = a test push went through. */
  pushOk: boolean | null;
  rules: AlertRules | null;
}

interface DbSettings {
  discord_webhook: string | null;
  webhook_ok: number | null;
  push_ok: number | null;
  rules: string | null;
}

export function parseStoredRules(json: string | null): AlertRules | null {
  if (json === null) return null;
  try {
    const parsed = parseAlertRules(JSON.parse(json), defaultAlertRules(false));
    return parsed.ok ? parsed.rules : null;
  } catch {
    return null;
  }
}

export async function loadAlertSettings(
  db: D1Database,
  accountId: string,
): Promise<AlertSettingsRow | null> {
  const row = await db
    .prepare(
      "SELECT discord_webhook, webhook_ok, push_ok, rules FROM alert_settings WHERE account_id = ?1",
    )
    .bind(accountId)
    .first<DbSettings>();
  if (row === null) return null;
  return {
    webhook: row.discord_webhook,
    webhookOk: row.webhook_ok === null ? null : row.webhook_ok === 1,
    pushOk: row.push_ok === null ? null : row.push_ok === 1,
    rules: parseStoredRules(row.rules),
  };
}

/** Accounts with any alert channel: a webhook or at least one push subscription. */
export async function countAlertingAccounts(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM alert_settings s WHERE s.discord_webhook IS NOT NULL " +
        "OR EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = s.account_id)",
    )
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function touchStmt(
  db: D1Database,
  accountId: string,
  now: number,
): D1PreparedStatement {
  // last_seen_at drives the 60-day inactivity cutoff; settings writes count as activity (authenticate also bumps once per day).
  return db
    .prepare("UPDATE accounts SET last_seen_at = ?2 WHERE id = ?1")
    .bind(accountId, now);
}

/** Stores a new webhook as untested; existing rules are kept. */
export async function saveWebhook(
  db: D1Database,
  accountId: string,
  url: string,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "INSERT INTO alert_settings (account_id, discord_webhook, webhook_ok, rules, next_sync_at, updated_at) " +
          "VALUES (?1, ?2, NULL, NULL, 0, ?3) " +
          "ON CONFLICT (account_id) DO UPDATE SET discord_webhook = excluded.discord_webhook, " +
          "webhook_ok = NULL, next_sync_at = 0, updated_at = excluded.updated_at",
      )
      .bind(accountId, url, now),
    touchStmt(db, accountId, now),
  ]);
}

/** A test message went through: mark ok and seed the default rules if there are none yet. */
export function verifyWebhookStmt(
  db: D1Database,
  accountId: string,
  defaultRulesJson: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE alert_settings SET webhook_ok = 1, rules = COALESCE(rules, ?2), next_sync_at = 0, updated_at = ?3 WHERE account_id = ?1",
    )
    .bind(accountId, defaultRulesJson, now);
}

export function markWebhookDeadStmt(
  db: D1Database,
  accountId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE alert_settings SET webhook_ok = 0, updated_at = ?2 WHERE account_id = ?1",
    )
    .bind(accountId, now);
}

export async function saveRules(
  db: D1Database,
  accountId: string,
  rules: AlertRules,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE alert_settings SET rules = ?2, next_sync_at = 0, updated_at = ?3 WHERE account_id = ?1",
      )
      .bind(accountId, JSON.stringify(rules), now),
    touchStmt(db, accountId, now),
  ]);
}

/**
 * Webhook removal. Push survives it: when the account still has subscriptions the
 * webhook is cleared but the row, rules, snapshot and log stay; otherwise everything goes.
 */
export async function removeAlertSettings(
  db: D1Database,
  accountId: string,
  now: number,
): Promise<void> {
  const noSubs =
    "NOT EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = ?1)";
  await db.batch([
    db
      .prepare(
        `UPDATE alert_settings SET discord_webhook = NULL, webhook_ok = NULL, updated_at = ?2 WHERE account_id = ?1 AND NOT ${noSubs}`,
      )
      .bind(accountId, now),
    db
      .prepare(`DELETE FROM alert_log WHERE account_id = ?1 AND ${noSubs}`)
      .bind(accountId),
    db
      .prepare(
        `DELETE FROM garden_snapshot WHERE account_id = ?1 AND ${noSubs}`,
      )
      .bind(accountId),
    db
      .prepare(`DELETE FROM alert_settings WHERE account_id = ?1 AND ${noSubs}`)
      .bind(accountId),
  ]);
}

export interface DueAccount {
  accountId: string;
  /** null for a push-only account. */
  webhook: string | null;
  rules: string | null;
  profileId: string;
  tz: string;
  snapshotJson: string | null;
  snapshotFetchedAt: number | null;
}

interface DbDue {
  account_id: string;
  discord_webhook: string | null;
  rules: string | null;
  profile_id: string;
  tz: string;
  snapshot_json: string | null;
  snapshot_fetched_at: number | null;
}

/**
 * Accounts the cron should look at now, most overdue first. The LIKE is a cheap
 * prefilter for "at least one enabled rule" so accounts with everything off
 * cannot fill the batch; the rules JSON is written by JSON.stringify of our own
 * objects, so the `"enabled":true` substring is exact. The cron re-checks in code.
 */
export async function loadDueAccounts(
  db: D1Database,
  now: number,
  limit: number,
): Promise<DueAccount[]> {
  const res = await db
    .prepare(
      "SELECT s.account_id, CASE WHEN s.webhook_ok = 1 THEN s.discord_webhook END AS discord_webhook, s.rules, a.profile_id, a.tz, " +
        "g.json AS snapshot_json, g.fetched_at AS snapshot_fetched_at " +
        "FROM alert_settings s " +
        "JOIN accounts a ON a.id = s.account_id " +
        "LEFT JOIN garden_snapshot g ON g.account_id = s.account_id " +
        "WHERE ((s.webhook_ok = 1 AND s.discord_webhook IS NOT NULL) " +
        "OR (s.push_ok = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = s.account_id))) " +
        "AND s.rules LIKE '%\"enabled\":true%' " +
        "AND s.next_sync_at <= ?1 AND a.last_seen_at > ?2 " +
        "ORDER BY s.next_sync_at ASC, s.account_id ASC LIMIT ?3",
    )
    .bind(now + CRON_SLACK_MS, now - INACTIVE_ACCOUNT_MS, limit)
    .all<DbDue>();
  return (res.results ?? []).map((r) => ({
    accountId: r.account_id,
    webhook: r.discord_webhook,
    rules: r.rules,
    profileId: r.profile_id,
    tz: r.tz,
    snapshotJson: r.snapshot_json,
    snapshotFetchedAt: r.snapshot_fetched_at,
  }));
}

export interface StoredPlayerData {
  assignments: Record<string, string>;
  greenhouses: Record<string, GreenhousePlan>;
}

/** Assignments and Greenhouse plans for up to ~10 accounts in ONE batch of two statements. */
export async function loadAccountData(
  db: D1Database,
  ids: readonly string[],
): Promise<Map<string, StoredPlayerData>> {
  const out = new Map<string, StoredPlayerData>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { assignments: {}, greenhouses: {} });
  const marks = ids.map((_, i) => `?${i + 1}`).join(",");
  const [assignRes, ghRes] = await db.batch([
    db
      .prepare(
        `SELECT account_id, plot_id, crop_id FROM plot_assignments WHERE account_id IN (${marks})`,
      )
      .bind(...ids),
    db
      .prepare(
        `SELECT account_id, plot_id, last_watered_at, watering_interval_hours FROM greenhouses WHERE account_id IN (${marks})`,
      )
      .bind(...ids),
  ]);
  for (const r of (assignRes?.results ?? []) as {
    account_id: string;
    plot_id: string;
    crop_id: string;
  }[]) {
    const entry = out.get(r.account_id);
    if (entry !== undefined) entry.assignments[r.plot_id] = r.crop_id;
  }
  for (const r of (ghRes?.results ?? []) as {
    account_id: string;
    plot_id: string;
    last_watered_at: number | null;
    watering_interval_hours: number | null;
  }[]) {
    const entry = out.get(r.account_id);
    if (entry !== undefined) {
      entry.greenhouses[r.plot_id] = {
        lastWateredAt: r.last_watered_at,
        wateringIntervalHours: r.watering_interval_hours,
      };
    }
  }
  return out;
}

export function parseSnapshot(
  json: string | null,
  fetchedAt: number | null,
): { garden: GardenState; fetchedAt: number } | null {
  if (json === null || fetchedAt === null) return null;
  try {
    const body: unknown = JSON.parse(json);
    if (typeof body !== "object" || body === null) return null;
    const { v, garden } = body as { v?: unknown; garden?: unknown };
    if (v !== SNAPSHOT_VERSION) return null;
    const parsed = parseGardenState(garden);
    return parsed === null ? null : { garden: parsed, fetchedAt };
  } catch {
    return null;
  }
}

export function saveSnapshotStmt(
  db: D1Database,
  accountId: string,
  fetchedAt: number,
  garden: GardenState,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO garden_snapshot (account_id, fetched_at, json) VALUES (?1, ?2, ?3) " +
        "ON CONFLICT (account_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
    )
    .bind(
      accountId,
      fetchedAt,
      JSON.stringify({ v: SNAPSHOT_VERSION, garden }),
    );
}

export function setNextSyncStmt(
  db: D1Database,
  accountId: string,
  at: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE alert_settings SET next_sync_at = ?2 WHERE account_id = ?1",
    )
    .bind(accountId, at);
}

/** meta.changes === 1 means this caller won the right to send. */
export function claimStmt(
  db: D1Database,
  accountId: string,
  type: string,
  key: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT OR IGNORE INTO alert_log (account_id, type, key, sent_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(accountId, type, key, now);
}

export function releaseClaimStmt(
  db: D1Database,
  accountId: string,
  type: string,
  key: string,
): D1PreparedStatement {
  return db
    .prepare(
      "DELETE FROM alert_log WHERE account_id = ?1 AND type = ?2 AND key = ?3",
    )
    .bind(accountId, type, key);
}

export function pruneAlertLogStmt(
  db: D1Database,
  now: number,
): D1PreparedStatement {
  return db
    .prepare("DELETE FROM alert_log WHERE sent_at < ?1")
    .bind(now - ALERT_LOG_RETENTION_MS);
}
