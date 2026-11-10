# Phase 4C — Streak-at-risk Discord Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional, off-by-default `streak_risk` Discord alert: when a player's quest streak is ≥ `minStreak`, no quest is done today, and local time is within `leadHours` of the daily reset, the cron checks a fresh garden for in-game completions first, then sends at most one message per day.

**Architecture:** `streak_risk` is a new `AlertType` in core (`deriveAlerts` stays pure and takes a precomputed `streak` input). The Worker cron, only for accounts that opted in and are inside the window, loads the account's `quest_log` progress (reusing the Phase 4B read path), runs `evaluateQuests` against the fresh garden, persists any completions as `completeQuest` ops, computes `summarizeProgress`, and passes the result into `deriveAlerts`. Dedupe key `streak:<day>` via the existing `alert_log` claim.

**Tech Stack:** TypeScript strict, vitest, Hono/Cloudflare Worker + D1, React.

**Spec:** `docs/superpowers/specs/2026-11-10-phase-4-gamification-design.md` §7 (and §4 trust model).

## Global Constraints

- Off by default: `streak_risk` is NOT in `data/alerts.json` `enabledAfterTest`.
- Dedupe key `streak:<day>` (day = quest day key in the account tz); one message per day at most.
- Message: "Your 6-day streak ends in 3 h. One quest keeps it alive." (streak and hours substituted; use "min" instead of "h" when under an hour). Discord payload rules unchanged (`allowed_mentions: none`, existing `alertEmbed`/`sendDiscord`).
- False-alarm guard: inside the window the cron must evaluate quests against a FRESH garden snapshot (not older than `SNAPSHOT_REUSE_MS`) and write completions before deciding. User-logged quests (`water_greenhouse`) are never counted by the cron (it passes empty greenhouses).
- Only accounts that opted in AND are inside the window get the extra work; everything counts against the existing per-run Hypixel-call cap and subrequest budget (`Budget`). If the budget cannot afford the extra statements, skip the streak check this run (no alert, no crash).
- No `any` in `packages/core`; numbers (defaults, bounds) live in `data/alerts.json`; every core function has a vitest test; fixtures only.
- `pnpm typecheck && pnpm lint && pnpm test` green at the end of each task (run packages separately if the machine is slow).

## Rulings made while planning (carry into ledger)

1. Only `leadHours` is user-editable (UI/validator support one param per alert type, see `alertParam`); `minStreak` is a data constant (3) in `data/alerts.json`. Cost if wrong: one fixed setting.
2. In the guard the cron evaluates with `member: null` (no extra Hypixel profile call). Garden-only quests (`serve_visitors`, `gain_garden_xp`, `unlock_plot`) are confirmable; member-based quests (mutations, `contest_crop`) are not, so a rare false alarm is possible if the player's only completion was one of those. Cost if wrong: occasional false alarm; documented in `data/VERIFY.md`.
3. Cron-written completions go through the existing `applyOpsToDb` (so the revision bumps and devices re-pull); they count toward the account's daily ops counter (a handful per day).
4. Wake-up scheduling: no wake-up needed; baseline (15 min) < min lead (1 h).

## File Structure

- Modify `data/alerts.json` — `streak_risk` rule (`leadHours: 3`), bounds `leadHours` {1, 12}, `streak: { minStreak: 3 }`.
- Modify `packages/core/src/alerts.ts` — `ALERT_TYPES`, `AlertParam`, `AlertInput.streak`, `deriveAlerts`, `streakWindowStart` helper.
- Modify `apps/worker/src/sync/db.ts` — export `readProgress(db, accountId, tz, now)` (extract from `readState`).
- Modify `apps/worker/src/alerts/db.ts` — `DueAccount.tz`, `loadDueAccounts` selects `a.tz`.
- Modify `apps/worker/src/cron.ts` — streak guard in `processAccount`.
- Modify `apps/web/src/components/AlertsSection.tsx` — label/unit for `streak_risk`.
- Modify `data/VERIFY.md`.

---

### Task 1: Core — `streak_risk` alert type, derivation and scheduling

**Files:**
- Modify: `data/alerts.json`, `packages/core/src/alerts.ts`
- Test: `packages/core/src/alerts.test.ts`, `packages/core/src/data-integrity.test.ts` (if it checks alerts.json)

**Interfaces:**
- Produces (exact):
  ```ts
  // alerts.ts
  export type AlertParam = "leadMinutes" | "threshold" | "leadHours";
  // ALERT_TYPES gains "streak_risk" (append last)
  export interface StreakInfo {
    day: string;        // quest day key (dayKey(now, tz))
    streak: number;     // summarizeProgress(...).streak
    doneToday: boolean; // summarizeProgress(...).doneToday
    resetAt: number;    // epoch ms of the next reset (nextResetMs(now, tz))
  }
  export interface AlertInput extends PlannerInput { rules: AlertRules; streak?: StreakInfo }
  export function streakWindowStart(rules: AlertRules, resetAt: number): number; // resetAt - leadHours*3_600_000
  ```
- `defaultAlertRules` yields `streak_risk: { enabled: false, leadHours: 3 }` (even after test).

- [ ] **Step 1: Write failing tests** in `alerts.test.ts`:
  - `parseAlertRules` accepts `{streak_risk:{enabled:true, leadHours:5}}`; rejects `leadHours` 0 and 13 and a non-integer; rejects `leadMinutes` on streak_risk.
  - `defaultAlertRules(true).streak_risk.enabled === false`; existing stored rules JSON without `streak_risk` still parse (base fills it).
  - `deriveAlerts`: with rule enabled and `streak: {day:"2026-11-10", streak:6, doneToday:false, resetAt: now + 2h}` → exactly one candidate `{type:"streak_risk", key:"streak:2026-11-10"}` whose title is `Your 6-day streak ends in 2 h. One quest keeps it alive.` (and `... ends in 40 min. ...` under an hour); no candidate when: rule disabled, `streak` undefined, `doneToday` true, `streak < minStreak` (2), `resetAt - now > leadHours h` (outside window), `resetAt <= now`.
  - `nextSyncAt`: no wake-up needed; baseline (15 min) < min lead (1 h).
- [ ] **Step 2: Run** `pnpm --filter @garden-hq/core test` — new tests fail.
- [ ] **Step 3: Implement.** `data/alerts.json`: add `"streak_risk": { "leadHours": 3 }` to `rules`, `"leadHours": { "min": 1, "max": 12 }` to `bounds`, `"streak": { "minStreak": 3 }` top-level (bump `lastVerified` to 2026-11-10). In `alerts.ts` extend the `AlertData` type, `ALERT_TYPES`, `AlertParam`, `lead` helpers as needed, add `StreakInfo`, `streakWindowStart`, the `deriveAlerts` branch. Hours formatting: ≥ 60 min → whole hours rounded up (`Math.ceil`), else minutes (at least 1).
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test` — green (fix compile fallout in worker/web, e.g. exhaustive `Record<AlertType, …>` maps: add a temporary `streak_risk` label in `AlertsSection.tsx` LABELS so web compiles; Task 3 finalizes it).
- [ ] **Step 5: Commit** `feat(core): streak_risk alert type, derivation and scheduling`.

---

### Task 2: Worker — progress read path and the cron guard

**Files:**
- Modify: `apps/worker/src/sync/db.ts` (extract `readProgress`), `apps/worker/src/alerts/db.ts` (`DueAccount.tz`), `apps/worker/src/cron.ts`
- Test: `apps/worker/src/sync/progress.db.test.ts` (readProgress), `apps/worker/src/cron.test.ts`

**Interfaces:**
- Consumes (Task 1): `StreakInfo`, `AlertInput.streak`, `streakWindowStart`, rules with `streak_risk.leadHours`; Phase 4B: `ProgressData`, `evaluateQuests`, `summarizeProgress`, `dayKey`, `nextResetMs`, `applyOpsToDb`.
- Produces: `export async function readProgress(db: D1Database, accountId: string, tz: string, now: number): Promise<ProgressData>` (same result `readState` currently builds; `readState` calls it — no behaviour change; the 6-statement batch for the whole state stays ONE batch, so `readProgress` runs its own 4-statement batch and `readState` keeps its combined batch by sharing the row-parsing helper — do not add a round trip to `readState`).

- [ ] **Step 1: Failing tests.**
  - `readProgress` returns the same `ProgressData` that `readState(...).progress` returns for a seeded account (quests in window, achievements, archive).
  - cron (`cron.test.ts`, follow the existing fixtures/harness for Discord + Hypixel fakes): with streak_risk enabled, a 5-day streak (done quest rows for the previous 5 quest days in `quest_log`), today's three quests undone, `now` inside the leadHours window, fresh garden showing visitors served ≥ baseline+target for one of today's `serve_visitors` quests → NO Discord message, the quest row now has `done_at`, the account revision bumped. Same setup with nothing completed in the garden → exactly one message, title contains "5-day streak", an `alert_log` row `streak:<day>`; a second run in the same window sends nothing (dedupe). Outside the window (reset more than leadHours away) → no message and no `quest_log` read (assert statement count / no extra Hypixel call beyond the normal one). Streak below `minStreak` → none. Rule disabled → none. Budget too low for the extra statements → no alert, no throw, no write. An account whose today's quests do not exist yet (no rows) with a streak that is alive → treated as at risk (streak from yesterday alive, `doneToday` false) → alert; this is intended (quests are only created when the app opens).
- [ ] **Step 2: Run** `pnpm --filter @garden-hq/worker test` — new tests fail.
- [ ] **Step 3: Implement.**
  - `readProgress`: extract from `readState` (keep SQL identical; same cutoff `addDays(dayKey(now, tz), -QUEST_KEEP_DAYS)`; same `sanitizeProgress`).
  - `DueAccount` gains `tz: string` (`a.tz` in `loadDueAccounts`); update the mapper and every test constructing a `DueAccount`.
  - `processAccount`: after computing `current` (snapshot reuse logic unchanged) and BEFORE `deriveAlerts`: if `rules.streak_risk.enabled`, compute `resetAt = nextResetMs(now, tz)`; if `now >= streakWindowStart(rules, resetAt)` and the budget can afford the extra cost (reserve: 4 statements for `readProgress` batch + 1 per completion + 1 revision-bumping batch; charge via `budget.charge`): ensure the garden is fresh — if `current` came from a cached snapshot older than `SNAPSHOT_REUSE_MS` the existing logic already refetches; otherwise the reused snapshot (< 5 min) counts as fresh. Then `progress = await readProgress(...)`, `completions = evaluateQuests(progress.quests, { now, timeZone: tz, seed: "", profileId: account.profileId, garden: current.garden, gardenFetchedAt: current.fetchedAt, member: null, memberFetchedAt: null, greenhouses: {}, contests: ctx.contests })` (build the `EvalContext` exactly as `evaluateQuests` requires; check the type), apply them with `applyOpsToDb` as `completeQuest` ops (kind from the record), fold into `progress` with core `completeQuest`, then `summarizeProgress(progress, today)` → `streak: { day: today, streak, doneToday, resetAt }` on the `AlertInput`. Wrap the whole guard in try/catch: on any error log `cron_streak_check_failed` (name only) and continue WITHOUT a streak alert (a failed guard must never produce a false alarm).
  - Everything else (claims, delivery, `nextSyncAt`) unchanged; `nextSyncAt` is unchanged (no streak wake-up; baseline 15 min < min lead 1 h).
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test` — green.
- [ ] **Step 5: Commit** `feat(worker): streak_risk cron guard with in-game completion check`.

---

### Task 3: Web Settings row and docs

**Files:**
- Modify: `apps/web/src/components/AlertsSection.tsx`, `data/VERIFY.md`
- Test: `apps/web/src/components/AlertsSection.test.tsx`

**Interfaces:** Consumes Task 1's `streak_risk` type/param (`alertParam("streak_risk") === "leadHours"`).

- [ ] **Step 1: Failing test:** the Alerts section renders a "Streak about to break" row (label), with unit text "hours before the daily reset" and a hint "Off by default. Needs Cloud save so the server knows your quests. Quests done in-game are checked before alerting."; it is unchecked by default after a test message; toggling and editing the number saves `{streak_risk:{enabled:true, leadHours:N}}` through the existing save path; out-of-range input shows the existing validation behaviour.
- [ ] **Step 2: Run** `pnpm --filter @garden-hq/web test -- AlertsSection` — fails.
- [ ] **Step 3: Implement** the `LABELS.streak_risk` entry (replace the Task 1 placeholder) — follow the existing rows' structure; no new component.
- [ ] **Step 4:** `data/VERIFY.md`: add "Streak alert (Phase 4C)" notes: guard evaluates garden-only quests (member quests not confirmable → rare false alarm); alert only fires for accounts with Cloud save progress (quests are created when the app opens); `leadHours` editable, `minStreak` fixed at 3; CPU/budget of the extra statements unmeasured on real D1 (measure with `wrangler tail`).
- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm test`; **Commit** `feat(web): streak alert setting and docs`.

## Self-Review

- Spec §7 coverage: type + off by default (T1), conditions streak ≥ minStreak / none done today / within leadHours (T1), false-alarm guard with fresh garden + `evaluateQuests` + completion writes + user-logged never counted (T2), dedupe `streak:<day>` and message (T1/T2), webhook/`allowed_mentions` reuse (unchanged), capacity/budget note (T2 reserve, T3 VERIFY).
- Type names consistent: `StreakInfo`, `streakWindowStart`, `readProgress`, `AlertInput.streak`.
- Deviation noted in rulings: only `leadHours` editable.
