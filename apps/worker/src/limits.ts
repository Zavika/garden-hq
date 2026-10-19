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
