# Phase 4B — Progress in Cloud Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync gamification progress (quests, achievements, derived archive) through the existing op-based cloud save, via migration `0004`, three first-write-wins ops, and `progress` in the sync response.

**Architecture:** `progress: ProgressData` becomes part of core `StoredData` (so `SyncStateResponse` carries it). Three new idempotent monotone ops (`setQuests`, `completeQuest`, `unlockAchievement`) are applied identically by core `applyOp` (client) and by D1 statements (worker, INSERT OR IGNORE / `done_at IS NULL`). The client emits ops by diffing `ProgressData` (`progressOps`). XP/level/streak stay derived; the server only stores rows and computes the `archive` for rows older than `keepDays`.

**Tech Stack:** TypeScript strict, vitest, Hono on Cloudflare Workers, D1 (SQLite), React + Zustand web app.

**Spec:** `docs/superpowers/specs/2026-11-10-phase-4-gamification-design.md` (§4 data model/ops/migration, §5 budget, milestone B).

## Global Constraints

- No `any` in `packages/core`. Game numbers (xp, keepDays, skew) come from `data/*.json` via existing exports (`questXp`, `QUEST_KEEP_DAYS`, `SKEW_MS`, `getAchievement`); no magic numbers.
- Every core function gets a vitest test; fixtures only, no live API calls.
- First-write-wins for the three new ops; all idempotent; replaying a queue is safe.
- Server validates: known `kind`, `xp` equal to data files, `day` within [today − QUEST_KEEP_DAYS, today + 1] in the account time zone (ruling: seed/join uploads history), slot 0–2, ≤ 3 records per day, `at`/`createdAt` not more than `SKEW_MS` in the future.
- Migration `0004_progress.sql`: tables `quest_log` and `achievements`, **no extra indexes**; `player_xp` is NOT created.
- Op budget: `MAX_OPS_PER_REQUEST` (40) statements per batch must still hold — each op is exactly ONE D1 statement.
- The client never writes ops on open: nothing is enqueued unless a quest is created/completed or an achievement unlocks.
- Do not break existing tests; run `pnpm typecheck && pnpm lint && pnpm test` at the end of each task.

## Rulings made while planning (carry into ledger)

1. `quest_log` gets an extra `expires_at INTEGER NOT NULL` column (the spec's `QuestRecord.expiresAt` has no column otherwise). Cost if wrong: one more column.
2. `completeQuest` op carries `kind` in addition to `{day, slot, at}`; it only applies when the stored record's kind matches. Prevents a stale queued completion from marking a *different* device's winning quest done after a first-write-wins conflict. Cost if wrong: one extra field.
3. The `archive` is server-computed and not uploadable: seeding/joining cloud save does not carry a local archive (only exists after 14+ days of local use; Phase 4A is hours old). Cost if wrong: loss of pre-cloud history older than 14 days.
4. To avoid an import cycle (`sync.ts` → `progress.ts` → `quests.ts` → `sync.ts`), `DEFAULT_TIME_ZONE` moves to a new `timezone.ts` and is re-exported from `sync.ts`.

## File Structure

- Create `packages/core/src/timezone.ts` — `DEFAULT_TIME_ZONE`.
- Modify `packages/core/src/progress.ts` — export `parseQuestRecord`; add `progressOps(prev, next)`.
- Modify `packages/core/src/sync.ts` — `StoredData.progress`, 3 new ops (type, apply, parse, opKey, seed, join).
- Modify `packages/core/src/quests.ts`, `index.ts` — import path, exports.
- Create `apps/worker/migrations/0004_progress.sql`.
- Modify `apps/worker/src/sync/db.ts` — statements, `readState(db, account, now)`, delete cascade, `filterProgressOps`.
- Modify `apps/worker/src/routes/sync.ts` — context filter, pass `now`.
- Modify `apps/web/src/state/storage.ts`, `sync.ts` — emit/rebase progress ops.

---

### Task 1: Core — progress in StoredData and the three ops

**Files:**
- Create: `packages/core/src/timezone.ts`
- Modify: `packages/core/src/quests.ts` (import `DEFAULT_TIME_ZONE` from `./timezone`), `packages/core/src/sync.ts`, `packages/core/src/progress.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/sync.test.ts`, `packages/core/src/progress.test.ts`

**Interfaces:**
- Produces (exact):
  ```ts
  // sync.ts
  export interface StoredData { link; assignments; greenhouses; timeZone; progress: ProgressData }
  export type SyncOp = ...existing
    | { t: "setQuests"; day: string; quests: QuestRecord[] }
    | { t: "completeQuest"; day: string; slot: number; kind: QuestKind; at: number }
    | { t: "unlockAchievement"; id: string; at: number; xp: number };
  // progress.ts
  export function parseQuestRecord(raw: unknown): QuestRecord | null; // existing parseRecord, now exported
  export function progressOps(prev: ProgressData, next: ProgressData): SyncOp[];
  ```
- `EMPTY_STORED_DATA` gains `progress: EMPTY_PROGRESS`.

- [ ] **Step 1: Break the cycle.** Create `timezone.ts` exporting `export const DEFAULT_TIME_ZONE = "Europe/Warsaw";`. In `sync.ts` replace the const with `export { DEFAULT_TIME_ZONE } from "./timezone"; import { DEFAULT_TIME_ZONE } from "./timezone";` (sync still uses it in `EMPTY_STORED_DATA`). In `quests.ts` import it from `./timezone`. Export `./timezone` is not needed from `index.ts` (still exported through `sync`).

- [ ] **Step 2: Write failing tests** in `sync.test.ts` (use existing quest fixtures from `quest-fixtures.ts` if it offers a `QuestRecord` builder, else inline a record):
  - `applyOp setQuests` adds missing slots, keeps existing slots (first write wins), is idempotent (same reference returned on replay).
  - `applyOp completeQuest` sets `doneAt` when null and kind matches; no-op when already done (earliest `at` kept), when record missing, or when `kind` differs.
  - `applyOp unlockAchievement` inserts when absent, keeps the original when present.
  - `parseOps` rejects: setQuests with unknown kind, `xp` ≠ `questXp(kind)`, a record whose `day` ≠ `op.day`, duplicate slots, 0 or >3 records, slot ≥ 3, bad day string; completeQuest with bad slot/at/unknown kind; unlockAchievement with unknown id, `xp` ≠ `getAchievement(id).xp`, bad `at`. Accepts valid ones.
  - `opKey`: `q:${day}`, `qd:${day}:${slot}`, `ach:${id}`; `enqueueOp` of the same setQuests day replaces the earlier one, different days coexist.
  - `seedOps(local)` includes setQuests (grouped per day), completeQuest for done records, unlockAchievement per achievement; none when progress empty. `planJoin(local, server)` adds only records/achievements the server lacks (quests by `day|slot`; server wins), counting `added`/`kept` consistently with existing behaviour.
  In `progress.test.ts`: `progressOps(prev, next)`: new records → one setQuests per day; newly done → completeQuest (with kind); new achievements → unlockAchievement; unchanged → `[]`; compaction (records removed, archive changed) → `[]`; same reference → `[]`.

- [ ] **Step 3: Run** `pnpm --filter @garden-hq/core test` — verify new tests fail.

- [ ] **Step 4: Implement.**
  - `progress.ts`: rename `parseRecord` → exported `parseQuestRecord`. Add
    ```ts
    export function progressOps(prev: ProgressData, next: ProgressData): SyncOp[] {
      if (prev === next) return [];
      const ops: SyncOp[] = [];
      const old = new Map(prev.quests.map((q) => [`${q.day}|${q.slot}`, q]));
      const created = new Map<string, QuestRecord[]>();
      for (const q of next.quests) {
        const before = old.get(`${q.day}|${q.slot}`);
        if (before === undefined) {
          created.set(q.day, [...(created.get(q.day) ?? []), q]);
        }
      }
      for (const [day, quests] of created) ops.push({ t: "setQuests", day, quests });
      for (const q of next.quests) {
        const before = old.get(`${q.day}|${q.slot}`);
        // A record created and done in the same diff also needs its completion.
        if (q.doneAt !== null && (before === undefined || before.doneAt === null)) {
          ops.push({ t: "completeQuest", day: q.day, slot: q.slot, kind: q.kind, at: q.doneAt });
        }
      }
      for (const [id, a] of Object.entries(next.achievements)) {
        if (!Object.hasOwn(prev.achievements, id)) {
          ops.push({ t: "unlockAchievement", id, at: a.at, xp: a.xp });
        }
      }
      return ops;
    }
    ```
    (`import type { SyncOp } from "./sync"` — type-only import avoids a runtime cycle.)
  - `sync.ts`: add `progress` to `StoredData`/`EMPTY_STORED_DATA`; extend `SyncOp`; `applyOp` cases using `addQuests`, `completeQuest` (extra check `target.kind === op.kind`; implement by guarding before calling the existing `completeQuest(p, day, slot, at)`), `unlockAchievement` from `progress.ts`, each returning `data` unchanged when the progress reference is unchanged; `parseOp` cases per Step 2 (use `parseQuestRecord`, `questXp`, `getAchievement`, `QUESTS_PER_DAY`, `addDays`-free day regex `^\d{4}-\d{2}-\d{2}$`, `at` via the existing 0..MAX_EPOCH_MS check); `opKey`; `seedOps`; `planJoin`. `plotOf` already handles ops without `plotId`.
  - `index.ts`: export `progressOps`, `parseQuestRecord`.
  - Fix any type errors in the rest of the repo caused by the new required field (`pnpm typecheck` across the workspace: worker `readState`, web fixtures). In this task only make the worker/web **compile** with `progress: EMPTY_PROGRESS` where needed; real behaviour comes in Tasks 2–3.

- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm test` — all green.

- [ ] **Step 6: Commit** `feat(core): progress in StoredData and setQuests/completeQuest/unlockAchievement ops` (end with the Co-Authored-By line from the session attribution).

---

### Task 2: Worker — migration 0004, statements, pull with progress

**Files:**
- Create: `apps/worker/migrations/0004_progress.sql`
- Modify: `apps/worker/src/sync/db.ts`, `apps/worker/src/routes/sync.ts`
- Test: `apps/worker/src/sync/db.test.ts`, `apps/worker/src/routes/sync.test.ts`, `apps/worker/test/d1.test.ts` only if it enumerates migrations

**Interfaces:**
- Consumes (Task 1): the 3 new `SyncOp`s, `QuestRecord`, `ProgressData`, `QUEST_KEEP_DAYS`, `SKEW_MS`, `dayKey`, `addDays`.
- Produces:
  ```ts
  readState(db, account, now: number): Promise<SyncStateResponse>   // now added
  filterProgressOps(ops: readonly SyncOp[], now: number, timeZone: string): { ops: SyncOp[]; rejected: number }
  ```

- [ ] **Step 1: Migration** `0004_progress.sql` — the spec's SQL (§4) with the added column:
  ```sql
  CREATE TABLE quest_log (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    slot       INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    params     TEXT NOT NULL,
    baseline   REAL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    done_at    INTEGER,
    xp         INTEGER NOT NULL,
    PRIMARY KEY (account_id, day, slot)
  );
  CREATE TABLE achievements (
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    xp          INTEGER NOT NULL,
    PRIMARY KEY (account_id, id)
  );
  ```
  Check how `test/d1.ts` loads migrations (glob vs list) and make sure `0004` is applied in tests.

- [ ] **Step 2: Failing tests** (`db.test.ts`, using `setup()`; `apply` uses now=100 so use a helper with a realistic `now`):
  - setQuests inserts rows; replay and a second differing setQuests for the same day change nothing (first wins); one op = one statement (spy on `db.batch` length or assert via row counts).
  - completeQuest sets `done_at` once, ignores a later `at`, ignores wrong `kind`, ignores missing row.
  - unlockAchievement first-wins.
  - `readState` returns `progress` with rows of the last `QUEST_KEEP_DAYS` days (by account tz `dayKey`), all achievements, and `archive` = {xp: SUM of done older rows, doneQuests: COUNT, doneDays: distinct done days older, ascending, newest 400}; empty account → `EMPTY_PROGRESS`-equal. `params` JSON round-trips; `baseline` null round-trips.
  - `deleteAccount` removes quest_log and achievements rows.
  - `filterProgressOps`: drops setQuests/completeQuest whose `day` is outside `[addDays(dayKey(now,tz), -QUEST_KEEP_DAYS), addDays(dayKey(now,tz), 1)]`; drops ops with `at`/`createdAt` > now + `SKEW_MS`; keeps other op types untouched; `rejected` counts drops; time-zone dependence (a day that is "tomorrow" in Warsaw but not in UTC).
  Route test (`routes/sync.test.ts`): POST with valid setQuests/completeQuest/unlockAchievement → GET returns `progress`; invalid-xp op → `rejected` 1 and nothing stored; ETag changes after a progress op; 304 still works.

- [ ] **Step 3: Run** `pnpm --filter @garden-hq/worker test` — new tests fail.

- [ ] **Step 4: Implement** in `db.ts`:
  - `stmtFor` cases (A = account id):
    - `setQuests`: one statement
      `INSERT OR IGNORE INTO quest_log (account_id, day, slot, kind, params, baseline, created_at, expires_at, done_at, xp) VALUES (...),(...)` built from `op.quests.length` row groups (≤ 3 → ≤ 30 bound params); `done_at` bound as the record's `doneAt` (null for fresh), `params` as `JSON.stringify`.
    - `completeQuest`: `UPDATE quest_log SET done_at = ?4 WHERE account_id = ?1 AND day = ?2 AND slot = ?3 AND kind = ?5 AND done_at IS NULL`.
    - `unlockAchievement`: `INSERT OR IGNORE INTO achievements (account_id, id, unlocked_at, xp) VALUES (?1,?2,?3,?4)`.
  - `readState(db, account, now)`: extend the existing `db.batch` with 4 more statements: quest rows `WHERE day >= ?cutoff`, achievements, archive aggregate `SELECT COUNT(*) AS n, COALESCE(SUM(xp),0) AS xp FROM quest_log WHERE account_id=?1 AND day < ?2 AND done_at IS NOT NULL`, distinct done days `SELECT DISTINCT day FROM quest_log WHERE account_id=?1 AND day < ?2 AND done_at IS NOT NULL ORDER BY day DESC LIMIT 400` (reverse to ascending). `cutoff = addDays(dayKey(now, account.tz), -QUEST_KEEP_DAYS)`. Build `ProgressData`; run it through `sanitizeProgress` so malformed rows are dropped and xp is re-derived from data files. Total batch is 6 statements, within budget.
  - `filterProgressOps` as specified; `deleteAccount` adds the two DELETEs before the accounts delete.
  - `routes/sync.ts`: after `parseOpsLenient`, run `filterProgressOps(parsed.ops, now, account.tz)`; apply the filtered ops; `rejected = parsed.rejected + filtered.rejected`; pass `now` to both `readState` calls (GET uses `deps.now()`).
  - Update all other `readState(...)` callers (grep) to pass `now`.

- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm test` — all green.

- [ ] **Step 6: Commit** `feat(worker): quest_log/achievements tables, progress ops and progress in sync pull`.

---

### Task 3: Web — emit, rebase and adopt progress

**Files:**
- Modify: `apps/web/src/state/storage.ts`, `apps/web/src/state/sync.ts`
- Test: `apps/web/src/state/sync.test.ts`, `apps/web/src/state/storage.test.ts`, `apps/web/src/state/progress.test.tsx` as needed

**Interfaces:**
- Consumes (Task 1): `progressOps`, new `SyncOp`s, `StoredData.progress`.
- `storage.setProgress(next)` keeps its signature; the sync engine's wrapped `setProgress` additionally enqueues `progressOps(before.progress, next)`.

- [ ] **Step 1: Failing tests** (`sync.test.ts`, following the existing engine test harness):
  - With cloud save on, `setProgress` with a new quest set enqueues one `setQuests`; with a completed quest enqueues `completeQuest`; with a new achievement enqueues `unlockAchievement`; `setProgress` with the same reference or a compaction-only change enqueues nothing.
  - With cloud save off nothing is enqueued and local progress still updates (4A behaviour unchanged).
  - A pull whose server `progress` has quest slots the client lacks: the client adopts them (`applyServer` no longer keeps local progress wholesale); pending `setQuests` for already-present slots is ignored by `applyOp` (first wins); a pending `completeQuest` with a mismatching `kind` does not complete the server's record.
  - Join/seed: enabling cloud save on an account with local progress uploads it (setQuests/completeQuest/unlockAchievement via `seedOps`/`planJoin`); the server's progress wins conflicts.
  - Mounting/rendering the engine with unchanged progress enqueues nothing.

- [ ] **Step 2: Run** `pnpm --filter @garden-hq/web test` — new tests fail.

- [ ] **Step 3: Implement.**
  - `storage.ts`: `StoredData` no longer needs its own `progress` field (core `StoredData` has it) — keep the `StoredData` export name and simplify to a re-export; `EMPTY` becomes `EMPTY_STORED_DATA`; `sanitize` keeps `progress: sanitizeProgress(d.progress)`.
  - `sync.ts`: `withoutRevision` includes `progress: state.progress`; `applyServer` drops the `progress: local.progress` override (server progress is the base; pending/in-flight ops are re-applied on top); the final-state merge near line ~506 likewise; wrap `setProgress` with a custom wrapper: capture `before = base.getSnapshot().progress`, call `base.setProgress(next)`, and if the snapshot changed, for each `progressOps(before, base.getSnapshot().progress)` call `enqueue(op)` and `joinBuffer.push(op)` when `joining` (same rules as `wrap`). Do NOT re-apply these ops to data (setProgress already committed the whole `next`, including compaction).
  - Make sure `sendable()` accepts the new ops (it uses `parseOps`).

- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test` from the repo root — all green.

- [ ] **Step 5: Commit** `feat(web): sync gamification progress through cloud save`.

---

### Task 4: Docs and verification notes

**Files:** Modify `data/VERIFY.md`, `apps/worker/README.md` (migration list / D1 apply instructions if present).

- [ ] **Step 1:** In `data/VERIFY.md` add: archive is not uploadable (ruling 3); D1 per-invocation statement count with the 6-statement `readState` batch; first-write-wins race with `kind` guard.
- [ ] **Step 2:** If `apps/worker/README.md` lists migrations or `wrangler d1 migrations apply` steps, add `0004_progress.sql`.
- [ ] **Step 3: Run** `pnpm typecheck && pnpm lint && pnpm test`; **Commit** `docs: phase 4B verification notes`.

## Self-Review

- Spec coverage: migration 0004 (T2), three ops with first-write-wins and replay-safety (T1, T2), server validation incl. xp/day/at/slots (T1 parse + T2 filter), progress in sync response with archive (T2), budget (one statement per op, T2), client rebase (T3), local-only mode unchanged (T3 test), account delete cascade (T2). The 4A UI is untouched.
- Types: `SyncOp` names/fields are identical in all tasks (`setQuests {day, quests}`, `completeQuest {day, slot, kind, at}`, `unlockAchievement {id, at, xp}`).
- Deployment note (for the final message): the production D1 needs `wrangler d1 migrations apply` for `0004` **before** the Worker deploy, otherwise sync pulls fail on the missing tables. CI deploy ordering must be checked in Task 4.
