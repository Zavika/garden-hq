/**
 * Write budgets that protect the shared Cloudflare free-plan D1 quota
 * (100,000 rows written per day for the whole deployment). Both numbers are
 * tunable guesses sized against that quota, not measured values:
 * - a heavy real user writes well under 1,000 ops a day (each op is roughly
 *   one row plus the revision bump per batch);
 * - 50 creations x 1,000 ops stays far below 100k on a single day.
 *
 * Caveat: the account cap counts CREATIONS in the last 24 h (the
 * account_creations log, which survives account deletion), not live accounts.
 * Accounts accumulate across days, so the real daily ceiling is
 * (live accounts) x MAX_OPS_PER_ACCOUNT_PER_DAY, which grows over time.
 * Revisit both numbers once there is real usage.
 */
export const MAX_OPS_PER_ACCOUNT_PER_DAY = 1000;
export const MAX_ACCOUNTS_CREATED_PER_DAY = 50;

export const MS_PER_DAY = 86_400_000;

/** UTC day number (days since the epoch) used for the per-account counter. */
export function utcDay(now: number): number {
  return Math.floor(now / MS_PER_DAY);
}

/** Whole seconds from `now` to the next UTC midnight (at least 1). */
export function secondsToNextUtcDay(now: number): number {
  return Math.max(1, Math.ceil(((utcDay(now) + 1) * MS_PER_DAY - now) / 1000));
}

/**
 * Cron / alerts operating limits (Phase 3C). Tunable guesses sized against the
 * free plan (50 subrequests and 10 ms CPU per invocation), not measured values:
 * see data/VERIFY.md "Alerts cron".
 */
/**
 * During the hourly contest surge every account moves to the 5-minute cadence
 * and needs a fresh Hypixel snapshot, capped at MAX_HYPIXEL_CALLS_PER_RUN (8)
 * per run, so more than ~8 alerting accounts would drop contest alerts.
 * Follow-up: derive contest/greenhouse alerts from a stale snapshot.
 */
export const MAX_ALERTING_ACCOUNTS = 8;
/** Devices per account that can receive web push; the oldest is dropped when a 4th is added. */
export const MAX_PUSH_DEVICES = 3;
/** Push sends (each one encrypts and signs) allowed in one cron run; the rest are retried next run. */
export const MAX_PUSH_SENDS_PER_RUN = 12;
export const CRON_BATCH = 10;
export const MAX_HYPIXEL_CALLS_PER_RUN = 8;
/** Of the 50 allowed; the rest is headroom for retries and releases. */
export const SUBREQUEST_BUDGET = 40;
/** The Hypixel client retries a call up to 3 times (hypixel.ts MAX_ATTEMPTS). */
export const HYPIXEL_ATTEMPT_RESERVE = 3;
export const SNAPSHOT_REUSE_MS = 5 * 60_000;
/** next_sync_at is set a few hundred ms after a cron tick; without slack a 5 min reschedule slips to 10. */
export const CRON_SLACK_MS = 60_000;
export const CRON_ERROR_RETRY_MS = 5 * 60_000;
export const CRON_NO_GARDEN_RETRY_MS = 60 * 60_000;
export const INACTIVE_ACCOUNT_MS = 60 * MS_PER_DAY;
export const ALERT_LOG_RETENTION_MS = 7 * MS_PER_DAY;
/** Upper bound for a Discord 429 retry_after reschedule. */
export const MAX_DISCORD_RETRY_MS = 60 * 60_000;
