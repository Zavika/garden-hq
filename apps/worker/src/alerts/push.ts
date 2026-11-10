import { decodeBase64Url } from "../base64url";
import { MAX_PUSH_DEVICES } from "../limits";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: number;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const MAX_KEY_LENGTH = 128;
const MAX_ENDPOINT_LENGTH = 2048;
/** Push services whose endpoints we will contact (SSRF allowlist). */
const ALLOWED_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

/**
 * https only, no credentials, no port other than 443, and the host must be one
 * of the push services or a subdomain of one. Used at subscribe AND send time.
 */
export function isAllowedPushEndpoint(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENDPOINT_LENGTH
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** A PushSubscription.toJSON() shape reduced to what we store; null when anything is off. */
export function parsePushSubscription(
  body: unknown,
): PushSubscriptionInput | null {
  if (typeof body !== "object" || body === null) return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: unknown };
  if (!isAllowedPushEndpoint(endpoint)) return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  const pub = decodeBase64Url(p256dh, MAX_KEY_LENGTH);
  const secret = decodeBase64Url(auth, MAX_KEY_LENGTH);
  if (pub === null || pub.length !== 65 || pub[0] !== 0x04) return null;
  if (secret === null || secret.length !== 16) return null;
  return { endpoint, p256dh: p256dh as string, auth: auth as string };
}

interface DbSub {
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
}

export async function listSubscriptions(
  db: D1Database,
  accountId: string,
): Promise<PushSubscriptionRow[]> {
  const res = await db
    .prepare(
      "SELECT endpoint, p256dh, auth, created_at FROM push_subscriptions WHERE account_id = ?1 ORDER BY created_at ASC, endpoint ASC",
    )
    .bind(accountId)
    .all<DbSub>();
  return (res.results ?? []).map((r) => ({
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    auth: r.auth,
    createdAt: r.created_at,
  }));
}

/**
 * Subscriptions of every given account in ONE statement (cron). Only accounts
 * whose push channel is verified (push_ok = 1) appear; an unverified device
 * never receives alerts. Oldest first, like listSubscriptions.
 */
export async function loadSubscriptionsFor(
  db: D1Database,
  ids: readonly string[],
): Promise<Map<string, PushSubscriptionRow[]>> {
  const out = new Map<string, PushSubscriptionRow[]>();
  if (ids.length === 0) return out;
  const marks = ids.map((_, i) => `?${i + 1}`).join(",");
  const res = await db
    .prepare(
      "SELECT p.account_id, p.endpoint, p.p256dh, p.auth, p.created_at FROM push_subscriptions p " +
        "JOIN alert_settings s ON s.account_id = p.account_id AND s.push_ok = 1 " +
        `WHERE p.account_id IN (${marks}) ORDER BY p.account_id, p.created_at ASC, p.endpoint ASC`,
    )
    .bind(...ids)
    .all<DbSub & { account_id: string }>();
  for (const r of res.results ?? []) {
    const list = out.get(r.account_id) ?? [];
    list.push({
      endpoint: r.endpoint,
      p256dh: r.p256dh,
      auth: r.auth,
      createdAt: r.created_at,
    });
    out.set(r.account_id, list);
  }
  return out;
}

/** Cron cleanup after deleting dead devices: the push channel is unverified again once none are left. */
export function resetPushOkIfNoSubsStmt(
  db: D1Database,
  accountId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE alert_settings SET push_ok = NULL WHERE account_id = ?1 AND ${NO_SUBS}`,
    )
    .bind(accountId);
}

/** Device count without reading endpoints or keys. */
export async function countSubscriptions(
  db: D1Database,
  accountId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM push_subscriptions WHERE account_id = ?1",
    )
    .bind(accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Idempotent per endpoint. Keeps the newest MAX_PUSH_DEVICES; rules stay NULL until a test push is verified. */
export async function upsertSubscription(
  db: D1Database,
  accountId: string,
  sub: PushSubscriptionInput,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "INSERT INTO push_subscriptions (account_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
          "ON CONFLICT (account_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at",
      )
      .bind(accountId, sub.endpoint, sub.p256dh, sub.auth, now),
    db
      .prepare(
        "DELETE FROM push_subscriptions WHERE account_id = ?1 AND endpoint != ?3 AND endpoint NOT IN " +
          "(SELECT endpoint FROM push_subscriptions WHERE account_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2)",
      )
      .bind(accountId, MAX_PUSH_DEVICES, sub.endpoint),
    db
      .prepare(
        "INSERT INTO alert_settings (account_id, discord_webhook, webhook_ok, rules, next_sync_at, updated_at) " +
          "VALUES (?1, NULL, NULL, NULL, 0, ?2) " +
          "ON CONFLICT (account_id) DO UPDATE SET updated_at = excluded.updated_at",
      )
      .bind(accountId, now),
    // last_seen_at drives the 60-day inactivity cutoff; same as saveWebhook.
    db
      .prepare("UPDATE accounts SET last_seen_at = ?2 WHERE id = ?1")
      .bind(accountId, now),
  ]);
}

export function deleteSubscriptionStmt(
  db: D1Database,
  accountId: string,
  endpoint: string,
): D1PreparedStatement {
  return db
    .prepare(
      "DELETE FROM push_subscriptions WHERE account_id = ?1 AND endpoint = ?2",
    )
    .bind(accountId, endpoint);
}

const NO_SUBS =
  "NOT EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = ?1)";

/** Removes one device. When it was the last one: push_ok is reset, and an account with no webhook loses its settings, snapshot and log. */
export async function deleteSubscription(
  db: D1Database,
  accountId: string,
  endpoint: string,
): Promise<void> {
  await db.batch([
    deleteSubscriptionStmt(db, accountId, endpoint),
    db
      .prepare(
        `UPDATE alert_settings SET push_ok = NULL WHERE account_id = ?1 AND ${NO_SUBS}`,
      )
      .bind(accountId),
    // Child rows first, then the settings row they are conditioned on.
    db
      .prepare(
        `DELETE FROM alert_log WHERE account_id = ?1 AND ${NO_SUBS} AND NOT EXISTS (SELECT 1 FROM alert_settings s WHERE s.account_id = ?1 AND s.discord_webhook IS NOT NULL)`,
      )
      .bind(accountId),
    db
      .prepare(
        `DELETE FROM garden_snapshot WHERE account_id = ?1 AND ${NO_SUBS} AND NOT EXISTS (SELECT 1 FROM alert_settings s WHERE s.account_id = ?1 AND s.discord_webhook IS NOT NULL)`,
      )
      .bind(accountId),
    db
      .prepare(
        `DELETE FROM alert_settings WHERE account_id = ?1 AND discord_webhook IS NULL AND ${NO_SUBS}`,
      )
      .bind(accountId),
  ]);
}

/** Accounts that can currently be alerted through push (feeds nothing but diagnostics and tests). */
export async function countPushAccounts(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(DISTINCT account_id) AS n FROM push_subscriptions")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A test push went through: mark ok and seed the default rules if there are none yet. */
export function verifyPushStmt(
  db: D1Database,
  accountId: string,
  defaultRulesJson: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE alert_settings SET push_ok = 1, rules = COALESCE(rules, ?2), next_sync_at = 0, updated_at = ?3 WHERE account_id = ?1",
    )
    .bind(accountId, defaultRulesJson, now);
}
