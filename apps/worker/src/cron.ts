import {
  completeQuest,
  dayKey,
  deriveAlerts,
  evaluateQuests,
  nextResetMs,
  nextSyncAt,
  normalizeGarden,
  streakOnlyWakeAt,
  streakWindowStart,
  summarizeProgress,
  unwrapGardenResponse,
  type AlertCandidate,
  type AlertInput,
  type AlertRules,
  type Contest,
  type GardenState,
  type StreakInfo,
  type SyncOp,
} from "@garden-hq/core";
import {
  claimStmt,
  loadAccountData,
  loadDueAccounts,
  markWebhookDeadStmt,
  parseSnapshot,
  parseStoredRules,
  pruneAlertLogStmt,
  releaseClaimStmt,
  saveSnapshotStmt,
  setNextSyncStmt,
  type DueAccount,
  type StoredPlayerData,
} from "./alerts/db";
import { Budget, countingFetch } from "./budget";
import { getCachedContests } from "./contests";
import type { Env } from "./env";
import { AppError } from "./errors";
import {
  createHypixelClient,
  createRateLimitState,
  type HypixelClient,
  type RateLimitState,
} from "./hypixel";
import {
  CRON_BATCH,
  CRON_ERROR_RETRY_MS,
  CRON_NO_GARDEN_RETRY_MS,
  HYPIXEL_ATTEMPT_RESERVE,
  MAX_DISCORD_RETRY_MS,
  MAX_HYPIXEL_CALLS_PER_RUN,
  SNAPSHOT_REUSE_MS,
  SUBREQUEST_BUDGET,
  utcDay,
} from "./limits";
import { logError } from "./log";
import { alertEmbed, sendDiscord } from "./notify/discord";
import { applyOpsToDb, readProgress } from "./sync/db";

export interface CronDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Tests pass a fresh one; production uses a module-level state shared within an isolate. */
  hypixelState?: RateLimitState;
}

export type StoppedBecause = "done" | "budget" | "hypixel_key" | "hypixel_rate";

export interface RunSummary {
  due: number;
  processed: number;
  hypixelCalls: number;
  sent: number;
  subrequests: number;
  stoppedBecause: StoppedBecause;
}

/** Shared across cron invocations in one isolate so RateLimit-* headers carry over. */
const isolateHypixelState = createRateLimitState();

/** Fewest subrequests worth starting an account for: its snapshot + next_sync batch. */
const MIN_ACCOUNT_COST = 2;
/** Cron ticks every 5 minutes; this is the tick that crosses UTC midnight. */
const TICK_MS = 5 * 60_000;
/** An account with nothing enabled (rules changed under us) is parked for an hour. */
const PARK_MS = 60 * 60_000;

class StopRun extends Error {
  constructor(readonly reason: "hypixel_key" | "hypixel_rate") {
    super(reason);
  }
}

interface RunContext {
  env: Env;
  now: number;
  budget: Budget;
  fetchFn: typeof fetch;
  client: HypixelClient;
  contests: Contest[];
  data: Map<string, StoredPlayerData>;
  summary: RunSummary;
}

async function loadContests(
  env: Env,
  ctx: { fetchFn: typeof fetch; now: () => number; budget: Budget },
): Promise<Contest[]> {
  ctx.budget.charge(2); // KV read, plus a write on a cache miss
  try {
    return (await getCachedContests(env.CACHE, ctx.fetchFn, ctx.now)).value
      .contests;
  } catch {
    logError("cron_contests_unavailable");
    return [];
  }
}

async function setNextSync(
  ctx: RunContext,
  accountId: string,
  at: number,
): Promise<void> {
  await setNextSyncStmt(ctx.env.DB, accountId, at).run();
  ctx.budget.charge(1);
}

/** Returns the fresh garden, or null after deferring the account. Throws StopRun for run-wide problems. */
async function fetchGarden(
  ctx: RunContext,
  account: DueAccount,
): Promise<GardenState | null> {
  ctx.summary.hypixelCalls++;
  try {
    const raw = unwrapGardenResponse(
      await ctx.client.garden(account.profileId),
    );
    if (raw === null) {
      await setNextSync(
        ctx,
        account.accountId,
        ctx.now + CRON_NO_GARDEN_RETRY_MS,
      );
      return null;
    }
    return normalizeGarden(raw);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === "bad_api_key" || err.code === "missing_api_key") {
      logError("hypixel_key_rejected");
      throw new StopRun("hypixel_key");
    }
    if (err.code === "rate_limited") throw new StopRun("hypixel_rate");
    await setNextSync(ctx, account.accountId, ctx.now + CRON_ERROR_RETRY_MS);
    return null;
  }
}

async function deliver(
  ctx: RunContext,
  account: DueAccount,
  syncedAt: number,
  won: AlertCandidate[],
): Promise<void> {
  const db = ctx.env.DB;
  const release: AlertCandidate[] = [];
  let stop: "retry" | "dead" | null = null;
  let retryAfterMs = CRON_ERROR_RETRY_MS;

  for (const candidate of won) {
    if (stop === "retry") {
      release.push(candidate);
      continue;
    }
    if (stop === "dead") continue; // claims are kept: a re-added webhook must not replay stale alerts
    const result = await sendDiscord(
      ctx.fetchFn,
      account.webhook,
      alertEmbed(candidate, syncedAt, ctx.now),
    );
    if (result.kind === "sent") {
      ctx.summary.sent++;
    } else if (result.kind === "retry") {
      stop = "retry";
      release.push(candidate);
      if (result.retryAfterSeconds !== null) {
        retryAfterMs = Math.min(
          Math.max(retryAfterMs, result.retryAfterSeconds * 1000),
          MAX_DISCORD_RETRY_MS,
        );
      }
    } else if (result.kind === "dead") {
      stop = "dead";
      logError("webhook_dead");
    } else {
      logError("discord_rejected", { status: result.status });
    }
  }

  // Claim-first dedupe: if this batch fails, released claims stay held and those
  // alerts are lost (accepted: better than a duplicate send on a flaky D1).
  const stmts = release.map((c) =>
    releaseClaimStmt(db, account.accountId, c.type, c.key),
  );
  if (stop === "retry") {
    stmts.push(setNextSyncStmt(db, account.accountId, ctx.now + retryAfterMs));
  }
  if (stop === "dead") {
    stmts.push(markWebhookDeadStmt(db, account.accountId, ctx.now));
  }
  if (stmts.length > 0) {
    await db.batch(stmts);
    ctx.budget.charge(stmts.length);
  }
}

/** progress read batch (4) + revision-bumping batch (1) + one statement per completion. */
const STREAK_READ_COST = 4;
const STREAK_WRITE_COST = 1;

/**
 * Streak state for the alert, after crediting any quest the fresh garden already
 * proves done (so a player who finished in game is never warned). Returns
 * undefined when outside the window, unaffordable, or on any failure: no streak
 * info means no streak alert, never a false one.
 */
async function checkStreak(
  ctx: RunContext,
  account: DueAccount,
  rules: AlertRules,
  current: { garden: GardenState; fetchedAt: number },
): Promise<StreakInfo | undefined> {
  if (!rules.streak_risk.enabled) return undefined;
  const { now, budget, env } = ctx;
  try {
    const resetAt = nextResetMs(now, account.tz);
    if (now < streakWindowStart(rules, resetAt)) return undefined;
    // Reads, then at most a few completions and one revision bump; cap what a
    // single account can add so the check stays bounded.
    const reserve = STREAK_READ_COST + STREAK_WRITE_COST + 3;
    if (!budget.canAfford(reserve + MIN_ACCOUNT_COST)) return undefined;

    const today = dayKey(now, account.tz);
    let progress = await readProgress(
      env.DB,
      account.accountId,
      account.tz,
      now,
    );
    budget.charge(STREAK_READ_COST);
    const completions = evaluateQuests(progress.quests, {
      now,
      timeZone: account.tz,
      profileId: account.profileId,
      garden: current.garden,
      gardenFetchedAt: current.fetchedAt,
      member: null,
      memberFetchedAt: null,
      // User-logged data is never credited by the cron.
      greenhouses: {},
    });
    const ops: SyncOp[] = [];
    for (const c of completions) {
      const record = progress.quests.find(
        (q) => q.day === c.day && q.slot === c.slot,
      );
      const next = completeQuest(progress, c.day, c.slot, c.at);
      if (record === undefined || next === progress) continue;
      progress = next;
      ops.push({
        t: "completeQuest",
        day: c.day,
        slot: c.slot,
        kind: record.kind,
        at: c.at,
      });
    }
    if (ops.length > 0) {
      await applyOpsToDb(env.DB, account.accountId, ops, now);
      budget.charge(ops.length + STREAK_WRITE_COST);
    }
    const summary = summarizeProgress(progress, today);
    return {
      day: today,
      streak: summary.streak,
      doneToday: summary.doneToday,
      resetAt,
    };
  } catch (err) {
    logError("cron_streak_check_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    return undefined;
  }
}

async function processAccount(
  ctx: RunContext,
  account: DueAccount,
): Promise<void> {
  const { env, now, budget, summary } = ctx;
  const db = env.DB;

  const rules = parseStoredRules(account.rules);
  if (rules === null || !Object.values(rules).some((r) => r.enabled)) {
    await setNextSync(ctx, account.accountId, now + PARK_MS);
    return;
  }

  // Streak-only accounts cannot alert before the lead window opens: skip them
  // (no Hypixel call, no quest reads) until then, then use the normal cadence.
  const wakeAt = streakOnlyWakeAt(rules, now, nextResetMs(now, account.tz));
  if (wakeAt !== null) {
    await setNextSync(ctx, account.accountId, wakeAt);
    return;
  }

  const cached = parseSnapshot(account.snapshotJson, account.snapshotFetchedAt);
  let current =
    cached !== null && now - cached.fetchedAt < SNAPSHOT_REUSE_MS
      ? cached
      : null;
  let fetched = false;
  if (current === null) {
    if (
      summary.hypixelCalls >= MAX_HYPIXEL_CALLS_PER_RUN ||
      !budget.canAfford(HYPIXEL_ATTEMPT_RESERVE + MIN_ACCOUNT_COST)
    ) {
      return; // keeps next_sync_at, so it goes first next run
    }
    const garden = await fetchGarden(ctx, account);
    if (garden === null) return;
    current = { garden, fetchedAt: now };
    fetched = true;
  }

  const stored = ctx.data.get(account.accountId) ?? {
    assignments: {},
    greenhouses: {},
  };
  const streak = await checkStreak(ctx, account, rules, current);
  const input: AlertInput = {
    now,
    garden: current.garden,
    contests: ctx.contests,
    assignments: stored.assignments,
    greenhouses: stored.greenhouses,
    rules,
    ...(streak === undefined ? {} : { streak }),
  };

  const candidates = deriveAlerts(input);
  // Worst case for n candidates: snapshot + next_sync + n claims (2n+2 with the
  // batch), then up to n sends/releases plus one reschedule (n+1) => 3n+3; the
  // fetched path adds one more for a final reschedule, so reserve 3n+4.
  const affordable =
    candidates.length === 0 ||
    budget.canAfford(MIN_ACCOUNT_COST + 2 + candidates.length * 3);
  const claims = affordable ? candidates : [];
  if (!affordable) summary.stoppedBecause = "budget";
  // Out of budget: leave the account due so the next run sends the alerts.
  const nextAt = affordable ? nextSyncAt(input, current.fetchedAt) : now;

  const stmts: D1PreparedStatement[] = [];
  if (fetched) {
    stmts.push(
      saveSnapshotStmt(
        db,
        account.accountId,
        current.fetchedAt,
        current.garden,
      ),
    );
  }
  stmts.push(setNextSyncStmt(db, account.accountId, nextAt));
  const claimStart = stmts.length;
  for (const c of claims) {
    stmts.push(claimStmt(db, account.accountId, c.type, c.key, now));
  }

  const results = await db.batch(stmts);
  budget.charge(stmts.length);

  const won = claims.filter(
    (_, i) => results[claimStart + i]?.meta.changes === 1,
  );
  await deliver(ctx, account, current.fetchedAt, won);
}

export async function runSync(env: Env, deps: CronDeps): Promise<RunSummary> {
  const now = deps.now();
  const budget = new Budget(SUBREQUEST_BUDGET);
  const fetchFn = countingFetch(deps.fetch, budget);
  const client = createHypixelClient({
    fetch: fetchFn,
    apiKey: env.HYPIXEL_API_KEY,
    now: deps.now,
    sleep: deps.sleep,
    state: deps.hypixelState ?? isolateHypixelState,
  });
  const summary: RunSummary = {
    due: 0,
    processed: 0,
    hypixelCalls: 0,
    sent: 0,
    subrequests: 0,
    stoppedBecause: "done",
  };

  const due = await loadDueAccounts(env.DB, now, CRON_BATCH);
  budget.charge(1);
  summary.due = due.length;

  if (due.length > 0) {
    const data = await loadAccountData(
      env.DB,
      due.map((a) => a.accountId),
    );
    budget.charge(2);
    const contests = await loadContests(env, {
      fetchFn,
      now: deps.now,
      budget,
    });
    const ctx: RunContext = {
      env,
      now,
      budget,
      fetchFn,
      client,
      contests,
      data,
      summary,
    };

    for (const account of due) {
      if (!budget.canAfford(MIN_ACCOUNT_COST)) {
        summary.stoppedBecause = "budget";
        break;
      }
      try {
        await processAccount(ctx, account);
        summary.processed++;
      } catch (err) {
        if (err instanceof StopRun) {
          summary.stoppedBecause = err.reason;
          break;
        }
        // Name only: messages can carry SQL parameters (the webhook URL).
        logError("cron_account_failed", {
          name: err instanceof Error ? err.name : "unknown",
        });
        // Push the poison account back so it cannot head the queue every run.
        if (budget.canAfford(1)) {
          try {
            await setNextSync(
              ctx,
              account.accountId,
              now + CRON_ERROR_RETRY_MS,
            );
          } catch (e) {
            logError("cron_reschedule_failed", {
              name: e instanceof Error ? e.name : "unknown",
            });
          }
        }
      }
    }
  }

  if (utcDay(now) !== utcDay(now - TICK_MS) && budget.canAfford(1)) {
    await pruneAlertLogStmt(env.DB, now).run();
    budget.charge(1);
  }

  summary.subrequests = budget.used;
  console.log(JSON.stringify({ event: "cron_run", ...summary }));
  return summary;
}

export async function scheduledSync(env: Env): Promise<RunSummary> {
  try {
    return await runSync(env, {
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  } catch (err) {
    logError("cron_failed", {
      name: err instanceof Error ? err.name : "unknown",
    });
    throw err;
  }
}
