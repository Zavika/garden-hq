# Phase 3B — Cloud save (D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the player's own data (link, plot crop assignments, Greenhouses, time zone) to Cloudflare D1 behind a random sync code, so it follows them across devices, with `localStorage` kept as the offline cache.

**Architecture:** One pure op vocabulary in `packages/core` (`SyncOp` + `applyOp`) is the single definition of "how a change mutates saved data". The web `GardenStorage` is refactored to apply ops through it; a `SyncEngine` wraps the storage, queues ops while a sync code exists, and flushes them to the Worker. The Worker validates ops with the same core code and applies them to D1 as idempotent per-key writes in one `db.batch`. Identity is a 160-bit sync code (only its SHA-256 is stored) sent as a Bearer token, rate-limited per IP.

**Tech Stack:** TypeScript strict, Hono on Cloudflare Workers, Cloudflare D1 (free plan), React + Vite, vitest (+ Testing Library in `apps/web`), pnpm workspaces. Worker D1 tests run the real SQL against Node's built-in `node:sqlite` through a thin D1-shaped adapter.

**Spec:** `docs/superpowers/specs/2026-10-07-phase-3-planner-sync-alerts-design.md`, section "B. Cloud save (D1)", "Free-plan budget", "Security and privacy notes" and "Decisions" 1-3, 6. Read it first.

## Global Constraints

- TypeScript strict everywhere; **no `any` in `packages/core`**.
- Game numbers and thresholds come from `/data/*.json`, never magic numbers in code (CLAUDE.md §9). (App limits such as max Greenhouses stay named constants, as they are today.)
- Every `core` function gets a vitest test; tests use fixtures/fakes, never live API calls.
- Free plan only. Limits (verified in the spec on 2026-10-07): 50 subrequests per invocation **including D1 and KV calls**, 10 ms CPU per invocation, 1,000 KV writes/day, D1 100,000 rows written/day. Sync routes must write **nothing to KV** and keep D1 round trips to a few per request (use `db.batch`).
- Sync code: **at least 128 bits of entropy (160 chosen)**, `crypto.getRandomValues`, base32, shown in groups of 4; server stores only the SHA-256 hash; never logged, never returned after creation.
- **Every request that presents a code counts against a per-IP limiter** (failed lookups weigh more), returns 429 + `Retry-After`.
- Settings shows the code (masked, reveal toggle) with **Copy** and the warning "Save this somewhere safe. It is the only way to restore your data on another device or after clearing your browser. We cannot recover it."
- `localStorage` stays the offline cache; app behaves exactly as today when signed out or offline.
- Conflicts: **last write wins per key, server receive time**. Joining an existing account from a device with local data: **union, cloud wins on the same key**, with a one-line summary; local data is untouched until the merge succeeds.
- `clearAll` clears local data only. "Delete cloud data" is a separate, confirmed action. No account recovery.
- No polling timer. Flush on app start, tab visible, `online`, and 2 s after a mutation.
- Discord webhooks, `alert_settings`, `garden_snapshot`, `alert_log` and the cron belong to milestone C and are **not** created here.
- Mobile-first UI; must work at 380 px width. Follow existing component and CSS conventions.
- When a mechanic is uncertain add a `// VERIFY:` comment and an entry in `data/VERIFY.md`.
- Commits end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `phase-3b-cloud-save`. Do not push; the owner pushes.
- Run commands from the repo root `C:\Users\azzaw\garden-hq` (Git Bash). Packages: `@garden-hq/core`, `@garden-hq/worker`, `@garden-hq/web`. Per-package: `pnpm --filter <pkg> test -- <file>`, `pnpm --filter <pkg> typecheck`. Before finishing every task also run `pnpm lint` and `pnpm format` (fix with `pnpm format:write`).

## Decisions made in this plan (flag to owner)

1. **Migration 0001 creates only `accounts`, `plot_assignments`, `greenhouses`.** The spec lists all six tables in 0001, but `alert_settings`, `garden_snapshot` and `alert_log` have no reader or writer until milestone C. Milestone C adds `0002` and extends account deletion. Unused tables cost nothing but also test nothing.
2. **`accounts` gets two extra columns:** `profiles TEXT` (JSON list of `{profileId,name,selected}` so a second device can show the profile picker without another Hypixel call) and `revision INTEGER` (ETag; bumped on every `POST /api/sync`).
3. **D1 test strategy:** no Miniflare pool. A ~60-line adapter exposes `node:sqlite` as a D1 subset (`prepare/bind/run/first/all`, atomic `batch`) so the real migration and the real SQL are tested. Node is 22.18 (`node:sqlite` needs no flag). It prints an experimental warning; harmless.
4. **Account creation does not verify the uuid against Hypixel** (would cost a call per signup). The data is public and only affects that account's own saves. Milestone C's cron is the first thing that calls Hypixel with it.
5. **Rate limits:** a second Cloudflare rate-limit binding `CODE_LIMITER` (30 per 60 s per IP) for requests presenting a code; each failed lookup consumes 4 extra units. Account creation uses the existing `RATE_LIMITER`. The KV-counter fallback exists for local dev only; in production the binding is used so sync traffic costs **zero KV writes**.
6. **Queue coalescing:** pending ops for the same key collapse to the last one (bounded queue, safe because every op is an idempotent set/delete). Greenhouse `mark`/`unmark` are barriers.
7. **Deploy:** CI gains a `wrangler d1 migrations apply DB --remote` step before `wrangler deploy`. The CI API token needs **D1 Edit** permission (owner action; see Task 8).

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/sync.ts` (new) | `StoredData` types, constants, `SyncOp`, `applyOp`, `parseOps`, `enqueueOp`, `seedOps`, `planJoin`, `rebase` |
| `packages/core/src/synccode.ts` (new) | `normalizeSyncCode`, `isSyncCode`, `formatSyncCode` (pure) |
| `packages/core/src/api.ts` | `unauthorized` error code; `SyncStateResponse`, `AccountCreateResponse` |
| `apps/web/src/state/storage.ts` | Refactor mutators onto `applyOp`; add `replaceAll` |
| `apps/worker/wrangler.toml` | `[[d1_databases]] DB`, `CODE_LIMITER` binding |
| `apps/worker/migrations/0001_init.sql` (new) | Tables |
| `apps/worker/test/d1.ts` (new), `test/node-sqlite.d.ts` (new) | D1-shaped adapter over `node:sqlite` |
| `apps/worker/src/env.ts`, `errors.ts`, `cors.ts`, `app.ts` | Bindings, 401, CORS methods/headers, route mounting |
| `apps/worker/src/synccode.ts` (new) | Generate code, SHA-256 hash |
| `apps/worker/src/auth.ts` (new) | `authenticate()` — Bearer parse, per-IP limiter, lookup |
| `apps/worker/src/sync/db.ts` (new) | SQL: create/find/read/apply/delete |
| `apps/worker/src/routes/account.ts`, `routes/sync.ts` (new) | HTTP |
| `apps/web/src/api/client.ts` | POST/DELETE + auth header + ETag; sync methods |
| `apps/web/src/state/sync.ts` (new) | `SyncEngine` |
| `apps/web/src/state/SyncProvider.tsx` (new) | Context + hooks |
| `apps/web/src/components/SyncSection.tsx` (new) | Settings UI |
| `apps/web/src/App.tsx`, `screens/SettingsScreen.tsx`, `test/renderWithProviders.tsx` | Wiring |
| `.github/workflows/ci.yml`, `apps/worker/README.md`, `data/VERIFY.md` | Deploy + docs |

---

### Task 1: Core — ops, apply, validate, queue, merge

**Files:**
- Create: `packages/core/src/sync.ts`, `packages/core/src/sync.test.ts`, `packages/core/src/synccode.ts`, `packages/core/src/synccode.test.ts`
- Modify: `packages/core/src/index.ts` (export both), `packages/core/src/api.ts` (add `"unauthorized"` to `ApiErrorCode`; add response types)

**Interfaces:**
- Produces (used by Tasks 2-7), exactly:

```ts
export const MAX_GREENHOUSES = 3;
export const MAX_WATERING_INTERVAL_HOURS = 720;
export const MAX_OPS_PER_REQUEST = 200;
export const DEFAULT_TIME_ZONE = "Europe/Warsaw";
export const CELL_KEY_RE: RegExp;                    // /^\d,\d$/
export interface StoredLink { name: string; uuid: string; profileId: string; profiles: ProfileSummary[] }
export interface GreenhouseSave { cells: Record<string,string>; lastWateredAt: number | null; wateringIntervalHours: number | null }
export interface StoredData { link: StoredLink | null; assignments: Record<string,string>; greenhouses: Record<string,GreenhouseSave>; timeZone: string }
export const EMPTY_STORED_DATA: StoredData;
export function validWateringInterval(v: unknown): number | null;
export type SyncOp = /* see below */;
export function applyOp(data: StoredData, op: SyncOp): StoredData;   // returns the SAME object when nothing changes
export function applyOps(data: StoredData, ops: readonly SyncOp[]): StoredData;
export function parseOps(raw: unknown): { ok: true; ops: SyncOp[] } | { ok: false; error: string };
export function opKey(op: SyncOp): string;
export function enqueueOp(queue: readonly SyncOp[], op: SyncOp): SyncOp[];
export function seedOps(local: StoredData): SyncOp[];
export function planJoin(local: StoredData, server: StoredData): { ops: SyncOp[]; added: number; kept: number };
// synccode.ts
export const SYNC_CODE_LENGTH = 32;
export function normalizeSyncCode(raw: string): string;   // strip non [A-Za-z2-7], uppercase
export function isSyncCode(normalized: string): boolean;   // /^[A-Z2-7]{32}$/
export function formatSyncCode(normalized: string): string; // groups of 4 joined by "-"
// api.ts
export interface SyncStateResponse extends StoredData { revision: number }
export interface AccountCreateResponse { syncCode: string }   // normalized, 32 chars
```

`SyncOp` union (field `t` discriminates):

```ts
export type SyncOp =
  | { t: "setAssignment"; plotId: string; cropId: string | null }
  | { t: "markGreenhouse"; plotId: string }
  | { t: "unmarkGreenhouse"; plotId: string }
  | { t: "setGreenhouseCell"; plotId: string; cellKey: string; contentId: string | null }
  | { t: "markGreenhouseWatered"; plotId: string; at: number }
  | { t: "setWateringInterval"; plotId: string; hours: number | null }
  | { t: "setTimeZone"; timeZone: string }
  | { t: "setLink"; link: StoredLink };
```

- [ ] **Step 1: Write failing tests** — `packages/core/src/sync.test.ts`. Cover (write them out fully, one `it` each):
  - `applyOp`: `setAssignment` sets / clears; `markGreenhouse` creates an empty save, is idempotent, returns the **same object** when already marked, when at `MAX_GREENHOUSES`, or when the plot id is unknown (`getPlot`); `unmarkGreenhouse` removes and is a no-op (same object) if absent; `setGreenhouseCell` sets/clears a cell, ignores a missing Greenhouse, a bad cell key (`"10,1"`), and a non-placeable id (`isPlaceableId`); `markGreenhouseWatered` sets `lastWateredAt`; `setWateringInterval` accepts `1`, `720`, `null`, rejects `0`, `721`, `NaN` (no change); `setTimeZone`; `setLink`.
  - `parseOps`: accepts a valid mixed list; rejects non-array, more than `MAX_OPS_PER_REQUEST`, unknown `t`, unknown plot id (`"nope_1"`), unknown crop (`getCrop`), bad cell key, non-placeable content id, `at` not a finite number in `[0, 8.64e15]`, interval out of range, time zone that is empty / longer than 64 chars / not accepted by `Intl.DateTimeFormat(undefined, { timeZone })`, link with a non-UUID `uuid`, a `profileId` that is not a UUID, a name failing `/^[A-Za-z0-9_]{1,16}$/`, or more than 20 profiles. `ok:false` carries a short human `error` such as `"op 3: unknown plot"`.
  - `opKey`: `setAssignment` -> `a:<plotId>`; cell -> `c:<plotId>:<cellKey>`; watered -> `w:<plotId>`; interval -> `i:<plotId>`; tz -> `tz`; link -> `link`; mark/unmark -> `g:<plotId>`.
  - `enqueueOp`: two `setAssignment` for one plot collapse to the last; ops for different plots both stay; `setGreenhouseCell` same cell collapses; an `unmarkGreenhouse` then `markGreenhouse` in between (barrier, same `plotId`) stops an earlier cell op from being collapsed; result never mutates the input array.
  - `seedOps`: from a data set with 2 assignments, 1 Greenhouse (2 cells, watered, interval) and tz `UTC` -> `applyOps(EMPTY_STORED_DATA, seedOps(x))` equals `x` minus `link` (property check by `toEqual`).
  - `planJoin`: local has plots A,B assigned, server has A with a **different** crop and C -> ops contain only `setAssignment B`, `added === 1`, `kept === 1`; Greenhouse in local not on server is added when server has < 3, skipped (counted as `kept`) when server already has 3; Greenhouse on both: local-only cells are added, differing cells keep the server value (`kept++`), `lastWateredAt`/interval taken from local only if server's is `null`; `timeZone` and `link` never produce ops. Empty local -> `{ ops: [], added: 0, kept: 0 }`.
  - Property test for the Worker's later SQL oracle: `applyOps(EMPTY, seedOps(x))` after `applyOps(..., enqueued)` — skip; Task 5 does the oracle comparison.

  `packages/core/src/synccode.test.ts`: `normalizeSyncCode("abcd-efgh ijkl")` -> `"ABCDEFGHIJKL"`; rejects `0,1,8,9` characters by stripping; `isSyncCode` true for 32 chars of `A-Z2-7`, false for 31 / 33 / lowercase; `formatSyncCode("A".repeat(32))` -> `"AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA"`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @garden-hq/core test -- sync`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement `packages/core/src/synccode.ts`**

```ts
export const SYNC_CODE_LENGTH = 32;
const CODE_RE = /^[A-Z2-7]{32}$/;

/** Uppercases and drops everything outside the base32 alphabet (spaces, dashes, 0/1/8/9). */
export function normalizeSyncCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function isSyncCode(normalized: string): boolean {
  return CODE_RE.test(normalized);
}

export function formatSyncCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join("-") ?? "";
}
```

- [ ] **Step 4: Implement `packages/core/src/sync.ts`**

Move the types and rules out of `apps/web/src/state/storage.ts` (copy their bodies: `validInterval` -> `validWateringInterval`, `CELL_KEY_RE`, `MAX_*`, `DEFAULT_TIME_ZONE`). Imports: `getPlot` from `./plots`, `isPlaceableId` from `./greenhouse-data`, `getCrop` from `./crops`, `ProfileSummary` from `./types`.

`applyOp` skeleton (implement every case; each returns `data` itself on a no-op):

```ts
export function applyOp(data: StoredData, op: SyncOp): StoredData {
  switch (op.t) {
    case "setAssignment": {
      const has = op.plotId in data.assignments;
      if (op.cropId === null) {
        if (!has) return data;
        const assignments = { ...data.assignments };
        delete assignments[op.plotId];
        return { ...data, assignments };
      }
      if (data.assignments[op.plotId] === op.cropId) return data;
      return { ...data, assignments: { ...data.assignments, [op.plotId]: op.cropId } };
    }
    case "markGreenhouse": {
      if (op.plotId in data.greenhouses) return data;
      if (getPlot(op.plotId) === undefined) return data;
      if (Object.keys(data.greenhouses).length >= MAX_GREENHOUSES) return data;
      return {
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [op.plotId]: { cells: {}, lastWateredAt: null, wateringIntervalHours: null },
        },
      };
    }
    // unmarkGreenhouse, setGreenhouseCell, markGreenhouseWatered,
    // setWateringInterval, setTimeZone, setLink: same pattern, using the
    // exact guards from the current storage.ts mutators.
  }
}
```

`applyOps` = `ops.reduce(applyOp, data)`.

`parseOps(raw)`: iterate with index `i`, each op must be an object with a string `t`; validate per variant as listed in the tests; error text `op ${i}: <reason>`. Link validation: `uuid` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, `profileId` same, name `/^[A-Za-z0-9_]{1,16}$/`, `profiles` array <= 20 of `{profileId:string(<=64), name:string(<=64), selected:boolean}`. Return normalized copies (not the raw objects) so extra properties are dropped.

`enqueueOp`:

```ts
function plotOf(op: SyncOp): string | null {
  return "plotId" in op ? op.plotId : null;
}
const BARRIERS = new Set(["markGreenhouse", "unmarkGreenhouse"]);

export function enqueueOp(queue: readonly SyncOp[], op: SyncOp): SyncOp[] {
  const key = opKey(op);
  const plot = plotOf(op);
  const out = [...queue];
  if (!BARRIERS.has(op.t)) {
    // Walk back; stop at a mark/unmark of the same Greenhouse (ordering matters across it).
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = out[i];
      if (plot !== null && plotOf(prev) === plot && BARRIERS.has(prev.t)) break;
      if (opKey(prev) === key) {
        out.splice(i, 1);
        break;
      }
    }
  }
  out.push(op);
  return out;
}
```

Note: marking/unmarking is itself never collapsed (it is the barrier), so `mark, unmark, mark` stays as three ops. That is correct and small.

`seedOps(local)`: `setTimeZone`; one `setAssignment` per entry; per Greenhouse: `markGreenhouse`, one `setGreenhouseCell` per cell, `markGreenhouseWatered` if non-null, `setWateringInterval` if non-null. Order: markGreenhouse before its cell ops.

`planJoin(local, server)` per the test list; `added` counts every local item that produced an op group (an assignment, a Greenhouse, a cell, a watered/interval value each count 1); `kept` counts every local item skipped because the server has a different value or no room.

- [ ] **Step 5: Add API types** in `packages/core/src/api.ts`: append `| "unauthorized"` to `ApiErrorCode`; add

```ts
import type { StoredData } from "./sync";
export interface SyncStateResponse extends StoredData { revision: number }
export interface AccountCreateResponse { syncCode: string }
```

- [ ] **Step 6: Export** `export * from "./sync"; export * from "./synccode";` from `packages/core/src/index.ts`.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @garden-hq/core test && pnpm --filter @garden-hq/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): sync ops, apply/validate/queue/merge, sync-code helpers"
```

---

### Task 2: Web storage onto `applyOp`

**Files:**
- Modify: `apps/web/src/state/storage.ts`
- Test: `apps/web/src/state/storage.test.ts` (existing tests must keep passing; add the two below)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `GardenStorage` gains `replaceAll(next: StoredData): void` (commits without any op side effects, used by the sync engine). All existing methods keep their signatures. `storage.ts` re-exports `StoredData`, `StoredLink`, `GreenhouseSave`, `MAX_GREENHOUSES`, `MAX_WATERING_INTERVAL_HOURS`, `DEFAULT_TIME_ZONE` from `@garden-hq/core` so existing imports (`GreenhousePanel`, `MapSection`, tests) keep working.

- [ ] **Step 1: Write failing tests** appended to `storage.test.ts`:
  - `replaceAll` swaps the data, persists to the backing, and notifies listeners once.
  - `replaceAll` with a hostile object (assignments value is a number) is cleaned by the same loader used at startup (reuse `load`'s parsers; export a `sanitize(raw: unknown): StoredData` from `storage.ts` and call it inside `replaceAll`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @garden-hq/web test -- storage`
Expected: FAIL (`replaceAll` missing).

- [ ] **Step 3: Refactor**
  - Delete the local copies of the types/constants/`validInterval`/`CELL_KEY_RE`; import from core.
  - Replace every mutator body with `commitOp({ t: ..., ... })`, where

```ts
function commitOp(op: SyncOp): StoredData {
  const next = applyOp(data, op);
  if (next !== data) commit(next);
  return next;
}
```

  - `markGreenhouse(plotId)`: `return plotId in commitOp({ t: "markGreenhouse", plotId }).greenhouses;`
  - `clearLink` stays a direct `commit({ ...data, link: null })` (not an op, local only). `clearAll` stays `commit({ ...EMPTY_STORED_DATA })`.
  - `replaceAll(next)`: `commit(sanitize(next))`. `sanitize` is the existing `load` parsing logic split from the `backing.getItem` part.

- [ ] **Step 4: Run the whole web suite**

Run: `pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck`
Expected: PASS (all pre-existing tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state
git commit -m "refactor(web): storage mutators go through core applyOp; add replaceAll"
```

---

### Task 3: D1 database, migration, binding, test adapter

**Files:**
- Create: `apps/worker/migrations/0001_init.sql`, `apps/worker/test/d1.ts`, `apps/worker/test/node-sqlite.d.ts`, `apps/worker/test/d1.test.ts`
- Modify: `apps/worker/wrangler.toml`, `apps/worker/src/env.ts`, `apps/worker/test/helpers.ts`

**Interfaces:**
- Produces: `Env.DB: D1Database`, `Env.CODE_LIMITER?: RateLimiterBinding`; test helper `makeD1(): Promise<D1Database>` (fresh in-memory DB with all migrations applied); `makeEnv()` includes `DB: await`-free sync version `DB: makeD1()` — make `makeD1` **synchronous** (node:sqlite is sync) so `makeEnv` stays sync.

- [ ] **Step 1: Create the database (real Cloudflare account; the owner asked for this)**

Run from `apps/worker`:

```bash
pnpm exec wrangler whoami
pnpm exec wrangler d1 create garden-hq
```
Expected: prints a `database_id` and a suggested `[[d1_databases]]` block. Copy the `database_id`. If `whoami` shows no login, stop and ask the owner to run `! pnpm --filter @garden-hq/worker exec wrangler login`.

- [ ] **Step 2: Add the bindings** to `apps/worker/wrangler.toml` (replace `<ID>`):

```toml
# D1: player cloud saves (free plan: 5M rows read / 100k rows written per day).
[[d1_databases]]
binding = "DB"
database_name = "garden-hq"
database_id = "<ID>"
migrations_dir = "migrations"

# Requests that present a sync code: 30 / 60 s per IP (failed lookups cost 5).
[[ratelimits]]
name = "CODE_LIMITER"
namespace_id = "1002"
simple = { limit = 30, period = 60 }
```
Update the comment above the `CACHE` KV block: per-player data is no longer cached there.

- [ ] **Step 3: Write the migration** `apps/worker/migrations/0001_init.sql`:

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL UNIQUE,
  mc_uuid       TEXT NOT NULL,
  mc_name       TEXT NOT NULL,
  profile_id    TEXT NOT NULL,
  profiles      TEXT NOT NULL DEFAULT '[]',
  tz            TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  revision      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE plot_assignments (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plot_id     TEXT NOT NULL,
  crop_id     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, plot_id)
);

CREATE TABLE greenhouses (
  account_id               TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  plot_id                  TEXT NOT NULL,
  cells                    TEXT NOT NULL DEFAULT '{}',
  last_watered_at          INTEGER,
  watering_interval_hours  REAL,
  updated_at               INTEGER NOT NULL,
  PRIMARY KEY (account_id, plot_id)
);
```

(`code_hash UNIQUE` already creates the lookup index; do not add another, an index costs an extra written row per write.)

- [ ] **Step 4: Apply locally and remotely**

```bash
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler d1 migrations apply DB --remote
```
Expected: `0001_init.sql` applied. (Remote creates the empty tables; nothing reads them until Task 5 deploys.)

- [ ] **Step 5: Env types** in `apps/worker/src/env.ts`: add `DB: D1Database;` and `CODE_LIMITER?: RateLimiterBinding;` (doc-comment: stricter limiter for requests presenting a sync code; KV counter used when absent, dev only).

- [ ] **Step 6: Test adapter.** `apps/worker/test/node-sqlite.d.ts`:

```ts
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
  export class StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint };
  }
}
```

`apps/worker/test/d1.ts` — implement the D1 subset the Worker uses:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Param = string | number | null;

class Stmt {
  constructor(readonly db: DatabaseSync, readonly sql: string, readonly params: Param[] = []) {}
  bind(...params: Param[]): Stmt { return new Stmt(this.db, this.sql, params); }
  exec() {
    const s = this.db.prepare(this.sql);
    const isRead = /^\s*(select|with)\b/i.test(this.sql);
    if (isRead) return { results: s.all(...this.params), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(s.run(...this.params).changes) } };
  }
  async run() { return { success: true, ...this.exec() }; }
  async all() { return { success: true, ...this.exec() }; }
  async first<T>(): Promise<T | null> { return (this.exec().results[0] as T | undefined) ?? null; }
}

export function makeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ success: true, ...s.exec() }));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
```

If `import.meta.dirname` is unavailable under the worker's vitest/tsconfig, use `fileURLToPath(new URL("../migrations", import.meta.url))`.

In `test/helpers.ts`: `import { makeD1 } from "./d1";` and add `DB: makeD1(),` to `makeEnv`'s defaults (before `...overrides`). Add `post/del` helpers to `makeHarness`'s return:

```ts
request: (path: string, init: RequestInit = {}) => app.request(path, init, env),
```

- [ ] **Step 7: Test the adapter** `test/d1.test.ts`: migrations create the three tables; `batch` is atomic (second statement violates a NOT NULL -> first insert rolled back); foreign-key cascade deletes children when an account is deleted.

- [ ] **Step 8: Run**

Run: `pnpm --filter @garden-hq/worker test && pnpm --filter @garden-hq/worker typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/worker .github
git commit -m "feat(worker): D1 database, 0001 migration, bindings, node:sqlite test adapter"
```

---

### Task 4: Worker — sync-code auth, rate limit, CORS, 401

**Files:**
- Create: `apps/worker/src/synccode.ts`, `apps/worker/src/synccode.test.ts`, `apps/worker/src/auth.ts`, `apps/worker/src/auth.test.ts`
- Modify: `apps/worker/src/errors.ts`, `apps/worker/src/cors.ts` (no change needed), `apps/worker/src/app.ts` (CORS methods/headers), `apps/worker/src/ratelimit.ts`

**Interfaces:**
- Consumes: `normalizeSyncCode`, `isSyncCode`, `SYNC_CODE_LENGTH` (Task 1); `Env.DB`, `Env.CODE_LIMITER` (Task 3).
- Produces:

```ts
// synccode.ts
export function generateSyncCode(): string;                    // 32 chars A-Z2-7, from 20 random bytes
export function encodeBase32(bytes: Uint8Array): string;       // RFC 4648, no padding
export function hashSyncCode(normalized: string): Promise<string>; // lowercase hex SHA-256
// auth.ts
export interface AccountRow { id: string; mcUuid: string; mcName: string; profileId: string; profiles: ProfileSummary[]; tz: string; revision: number }
export function authenticate(c: { env: Env; req: { header(n: string): string | undefined } }, now: () => number): Promise<AccountRow>;
// ratelimit.ts
export function pickCodeLimiter(env: Env, now: () => number): Limiter;
export const CODE_FAILURE_COST = 4;  // extra limiter units consumed per failed lookup
```
- `errors.ts`: `unauthorized` -> HTTP 401.

- [ ] **Step 1: Failing tests**
  - `synccode.test.ts`: `encodeBase32(new Uint8Array(20))` is 32 × `"A"`; `encodeBase32` of a known vector (`[0xff × 20]` -> `"7" × 32`); `generateSyncCode()` matches `isSyncCode`, two calls differ; stub `crypto.getRandomValues` (via `vi.spyOn(crypto, "getRandomValues")`) to assert it is called with a 20-byte array; `hashSyncCode("ABC…")` is 64 lowercase hex and stable; differs for a one-character change.
  - `auth.test.ts` (use `makeEnv()`, a fake `Limiter` injected through `env.CODE_LIMITER` as `{ limit: async () => ({ success }) }` with call counting; insert an account row directly with the hash of a known code): missing header -> `unauthorized`; header not `Bearer <32 chars>` -> `unauthorized` **without a DB query**; unknown code -> `unauthorized` and the limiter was called `1 + CODE_FAILURE_COST` times; valid code -> returns the row (profiles parsed from JSON, `revision` number) and the limiter was called once; limiter says no -> `rate_limited` with `retryAfter`, and **no DB query** happens; the code string never appears in any `console` output (spy on `console.log`/`console.error`, assert `JSON.stringify(calls)` lacks it).

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @garden-hq/worker test -- synccode auth`

- [ ] **Step 3: Implement** `synccode.ts`:

```ts
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const SYNC_CODE_BYTES = 20; // 160 bits

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function generateSyncCode(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(SYNC_CODE_BYTES)));
}

export async function hashSyncCode(normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

`errors.ts`: `ErrorStatus` adds `401`; `STATUS.unauthorized = 401`.

`ratelimit.ts`: add

```ts
export const CODE_LIMIT_PER_MINUTE = 30;
export const CODE_FAILURE_COST = 4;

export function pickCodeLimiter(env: Env, now: () => number): Limiter {
  return env.CODE_LIMITER !== undefined
    ? createBindingLimiter(env.CODE_LIMITER)
    : createKvLimiter(env.CACHE, now, CODE_LIMIT_PER_MINUTE); // local dev only
}
```
Update the `createBindingLimiter` doc comment: the 60 s `retryAfter` assumes `period = 60`.

`auth.ts`:

```ts
export async function authenticate(c, now): Promise<AccountRow> {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const code = match === null ? "" : normalizeSyncCode(match[1]);
  if (!isSyncCode(code)) throw new AppError("unauthorized", "Missing or malformed sync code");

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const limiter = pickCodeLimiter(c.env, now);
  const first = await limiter.allow(`code:${ip}`);
  if (!first.ok) throw new AppError("rate_limited", "Too many sync attempts — retry shortly", first.retryAfter);

  const row = await c.env.DB
    .prepare("SELECT id, mc_uuid, mc_name, profile_id, profiles, tz, revision FROM accounts WHERE code_hash = ?1")
    .bind(await hashSyncCode(code))
    .first<{ id: string; mc_uuid: string; mc_name: string; profile_id: string; profiles: string; tz: string; revision: number }>();

  if (row === null) {
    for (let i = 0; i < CODE_FAILURE_COST; i++) await limiter.allow(`code:${ip}`);
    throw new AppError("unauthorized", "Unknown sync code");
  }
  return { id: row.id, mcUuid: row.mc_uuid, mcName: row.mc_name, profileId: row.profile_id, profiles: parseProfiles(row.profiles), tz: row.tz, revision: row.revision };
}
```
`parseProfiles`: `JSON.parse` in try/catch -> `[]`, filter to valid `ProfileSummary` shape.

Note the malformed-header branch skips the limiter and DB on purpose (costs nothing); the spec's "every request that presents a code" is satisfied because a malformed value is not a code.

- [ ] **Step 4: CORS** in `app.ts`: change the `cors({...})` options to

```ts
allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
allowHeaders: ["Authorization", "Content-Type", "If-None-Match"],
exposeHeaders: ["ETag", "Retry-After"],
```
Extend the existing CORS test (in `app.test.ts`) to assert the preflight for `POST /api/sync` from `WEB_ORIGIN` allows `authorization` and from another origin does not.

- [ ] **Step 5: Run + typecheck, expect PASS**

Run: `pnpm --filter @garden-hq/worker test && pnpm --filter @garden-hq/worker typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/worker packages/core
git commit -m "feat(worker): sync-code generation, hashing, per-IP limited bearer auth, CORS for writes"
```

---

### Task 5: Worker — account and sync routes (D1)

**Files:**
- Create: `apps/worker/src/sync/db.ts`, `apps/worker/src/sync/db.test.ts`, `apps/worker/src/routes/account.ts`, `apps/worker/src/routes/account.test.ts`, `apps/worker/src/routes/sync.ts`, `apps/worker/src/routes/sync.test.ts`
- Modify: `apps/worker/src/app.ts` (mount routes)

**Interfaces:**
- Consumes: `authenticate`, `generateSyncCode`, `hashSyncCode`, `parseOps`, `SyncOp`, `SyncStateResponse`, `AccountCreateResponse`, `parseOps` link validation (Task 1), `enforceRateLimit`.
- Produces (db.ts):

```ts
export async function createAccount(db: D1Database, a: { id: string; codeHash: string; link: StoredLink; now: number }): Promise<void>;
export async function readState(db: D1Database, account: AccountRow): Promise<SyncStateResponse>;
export async function applyOpsToDb(db: D1Database, accountId: string, ops: readonly SyncOp[], now: number): Promise<void>; // ONE db.batch, bumps revision, sets last_seen_at
export async function deleteAccount(db: D1Database, accountId: string): Promise<void>;
```
- HTTP: `POST /api/account` body `{ link }` -> `201 { syncCode }`; `GET /api/sync` -> `200 SyncStateResponse` + `ETag: "<revision>"`, or `304` when `If-None-Match` equals it; `POST /api/sync` body `{ ops }` -> `200 SyncStateResponse` + `ETag`; `DELETE /api/account` -> `204`. All responses `Cache-Control: no-store`. Request bodies larger than 64 KB -> `bad_request`.

- [ ] **Step 1: Failing tests**
  - `db.test.ts` (against `makeD1()`): `createAccount` + `readState` returns the link, empty assignments, empty Greenhouses, tz `Europe/Warsaw`, revision 0. Apply the ops below and assert `readState`:
    - `setAssignment` set, overwrite, clear.
    - `markGreenhouse` ×4 distinct plots -> only 3 rows; repeating a mark does not reset an existing Greenhouse's cells.
    - `setGreenhouseCell` set / clear (`json_set` / `json_remove` with path `$."1,2"`), on a missing Greenhouse changes nothing.
    - `markGreenhouseWatered`, `setWateringInterval` (value and `null`), `setTimeZone`, `setLink`.
    - `unmarkGreenhouse`.
    - **Replaying the same op list twice yields the same state** (idempotent) and `revision` increases by 1 per `applyOpsToDb` call.
    - **Oracle test:** for a fixed 25-op sequence mixing every variant, `readState(...)` (minus `revision`) `toEqual` `applyOps(initialData, ops)` from core. This keeps the SQL and `applyOp` from drifting apart.
    - A failing statement rolls back the whole batch (e.g. temporarily drop the account row's FK target: apply ops to an unknown `accountId` and assert nothing was written and it rejects or is a no-op consistently — assert whichever you implement; recommended: ops for an unknown account insert nothing because every write is conditioned on the account existing via the FK).
    - `deleteAccount` removes all rows from all three tables.
  - `account.test.ts`: valid link -> 201, `syncCode` matches `isSyncCode`, DB stores a **hash not the code** (query `code_hash` and assert it is not equal to the code and is 64 hex chars); the returned code authenticates `GET /api/sync`; invalid link (bad uuid / name / profileId) -> 400; missing body -> 400; body > 64 KB -> 400; rate limited by `RATE_LIMITER` (fake binding returning `success:false`) -> 429 with `Retry-After`; `DELETE /api/account` with a valid code -> 204 and a following `GET /api/sync` with the same code -> 401; delete with a wrong code -> 401 and the account survives.
  - `sync.test.ts`: `GET` without header -> 401; wrong code -> 401; `GET` with valid code -> 200 shaped as `SyncStateResponse` with an `ETag`; repeat with `If-None-Match` -> 304 and an empty body; `POST` `{ ops: [...] }` applies and returns the new state and a **changed** ETag; the old ETag now yields 200 again; invalid op (`unknown plot`) -> 400 and **nothing applied** (state unchanged); more than 200 ops -> 400; **last write wins**: two `setAssignment` for one plot in two requests (second via a different "device" code-sharing client) leave the second value; ops for different plots from two requests both survive; replayed request (same body twice) is a no-op beyond the revision; two accounts never see each other's data; the response and the logs never contain the sync code or its hash; sync routes make **zero writes to FakeKV** (`kv.store.size` unchanged) even when `CODE_LIMITER` is unset? — use the binding fake in this test, since the KV fallback writes by design.

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @garden-hq/worker test -- sync account`

- [ ] **Step 3: Implement `sync/db.ts`.**

`createAccount`: one `INSERT INTO accounts (id, code_hash, mc_uuid, mc_name, profile_id, profiles, tz, revision, created_at, last_seen_at) VALUES (?1,?2,?3,?4,?5,?6,'Europe/Warsaw',0,?7,?7)`.

`readState`: one `db.batch` of two selects (`plot_assignments`, `greenhouses` for the account); the account row (link, tz, revision) already came from `authenticate`. Build `link` from the account row; `greenhouses[plot_id] = { cells: JSON.parse(cells) (try/catch -> {}), lastWateredAt, wateringIntervalHours }`. Return `{ link, assignments, greenhouses, timeZone: account.tz, revision: account.revision }`.

`applyOpsToDb`: build a statement array, then `await db.batch(stmts)`:

```ts
const A = accountId;
function stmtFor(db: D1Database, A: string, op: SyncOp, now: number): D1PreparedStatement {
  switch (op.t) {
    case "setAssignment":
      return op.cropId === null
        ? db.prepare("DELETE FROM plot_assignments WHERE account_id = ?1 AND plot_id = ?2").bind(A, op.plotId)
        : db.prepare(
            "INSERT INTO plot_assignments (account_id, plot_id, crop_id, updated_at) VALUES (?1,?2,?3,?4) " +
              "ON CONFLICT (account_id, plot_id) DO UPDATE SET crop_id = excluded.crop_id, updated_at = excluded.updated_at",
          ).bind(A, op.plotId, op.cropId, now);
    case "markGreenhouse":
      return db.prepare(
        "INSERT INTO greenhouses (account_id, plot_id, cells, last_watered_at, watering_interval_hours, updated_at) " +
          "SELECT ?1, ?2, '{}', NULL, NULL, ?3 " +
          "WHERE (SELECT COUNT(*) FROM greenhouses WHERE account_id = ?1) < ?4 " +
          "AND NOT EXISTS (SELECT 1 FROM greenhouses WHERE account_id = ?1 AND plot_id = ?2)",
      ).bind(A, op.plotId, now, MAX_GREENHOUSES);
    case "unmarkGreenhouse":
      return db.prepare("DELETE FROM greenhouses WHERE account_id = ?1 AND plot_id = ?2").bind(A, op.plotId);
    case "setGreenhouseCell": {
      const path = `$."${op.cellKey}"`; // cellKey is validated /^\d,\d$/ by parseOps
      return op.contentId === null
        ? db.prepare("UPDATE greenhouses SET cells = json_remove(cells, ?3), updated_at = ?4 WHERE account_id = ?1 AND plot_id = ?2").bind(A, op.plotId, path, now)
        : db.prepare("UPDATE greenhouses SET cells = json_set(cells, ?3, ?5), updated_at = ?4 WHERE account_id = ?1 AND plot_id = ?2").bind(A, op.plotId, path, now, op.contentId);
    }
    // markGreenhouseWatered: UPDATE greenhouses SET last_watered_at = ?3, updated_at = ?4 ...
    // setWateringInterval:  UPDATE greenhouses SET watering_interval_hours = ?3, updated_at = ?4 ...
    // setTimeZone:          UPDATE accounts SET tz = ?2 WHERE id = ?1
    // setLink:              UPDATE accounts SET mc_uuid = ?2, mc_name = ?3, profile_id = ?4, profiles = ?5 WHERE id = ?1
  }
}
```
Final statement of the batch: `UPDATE accounts SET revision = revision + 1, last_seen_at = ?2 WHERE id = ?1`. Batch size is at most `MAX_OPS_PER_REQUEST + 1` statements, which is fine against the 50-query limit only if D1 counts one batch as one query; **VERIFY:** the spec says "D1 queries per invocation 50". If a batch counts per statement, split into chunks of 40 inside `applyOpsToDb` (still atomic per chunk) — record the finding in `data/VERIFY.md` after checking Cloudflare's D1 limits page, and cap `MAX_OPS_PER_REQUEST` at 40 in `core` if per-statement counting is confirmed. Do this check in this step, before moving on.

`deleteAccount`: `db.batch` of three DELETEs (children first, then the account), not relying on cascade.

- [ ] **Step 4: Implement routes.**

`routes/account.ts`:
- `POST /account`: `await enforceRateLimit(c.env, ip, deps.now)`; read body with `await c.req.text()`, reject `length > 65536`; `JSON.parse` in try/catch -> `bad_request`; validate `link` by running `parseOps([{ t: "setLink", link: body.link }])` (reuses Task 1 validation) and take the parsed link; `const code = generateSyncCode(); await createAccount(c.env.DB, { id: crypto.randomUUID(), codeHash: await hashSyncCode(code), link, now: deps.now() })`; `c.header("Cache-Control","no-store")`; `return c.json({ syncCode: code } satisfies AccountCreateResponse, 201)`.
- `DELETE /account`: `const account = await authenticate(c, deps.now); await deleteAccount(c.env.DB, account.id); return c.body(null, 204)`.

`routes/sync.ts`:
- `GET /sync`: authenticate; `etag = \`"${account.revision}"\``; if `c.req.header("If-None-Match") === etag` -> `c.header("ETag", etag); return c.body(null, 304)`; else `readState` and return it with `ETag`.
- `POST /sync`: authenticate; parse body (same helper, shared in a small `readJsonBody(c)` exported from `routes/account.ts` or a new `src/body.ts`); `parseOps(body.ops)`; on `ok:false` -> `AppError("bad_request", error)`; `await applyOpsToDb(...)`; re-read the account's new revision by `account.revision + 1` is **wrong under concurrency** — instead do `readState` after the batch with a fresh `SELECT revision, tz, mc_*, profiles FROM accounts WHERE id = ?` (add `loadAccount(db, id)` to `db.ts`) and return it.

Mount in `app.ts` next to the others: `app.route("/api", accountRoute(deps)); app.route("/api", syncRoute(deps));`.

- [ ] **Step 5: Run + typecheck + lint, expect PASS**

Run: `pnpm --filter @garden-hq/worker test && pnpm --filter @garden-hq/worker typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add apps/worker packages/core data
git commit -m "feat(worker): account + sync routes backed by D1 (idempotent per-key ops, ETag)"
```

---

### Task 6: Web — API client and SyncEngine

**Files:**
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/state/sync.ts`, `apps/web/src/state/sync.test.ts`

**Interfaces:**
- Consumes: Task 1 (`SyncOp`, `enqueueOp`, `seedOps`, `planJoin`, `applyOps`, `normalizeSyncCode`, `isSyncCode`, `StoredData`, `SyncStateResponse`, `AccountCreateResponse`), Task 2 (`GardenStorage.replaceAll`).
- Produces (client):

```ts
// added to createApiClient()'s return value
createAccount: (link: StoredLink) => Promise<AccountCreateResponse>;
getSync: (code: string, etag: string | null) => Promise<{ state: SyncStateResponse; etag: string } | null>; // null = 304
postSync: (code: string, ops: SyncOp[]) => Promise<{ state: SyncStateResponse; etag: string }>;
deleteAccount: (code: string) => Promise<void>;
export type SyncApi = Pick<ReturnType<typeof createApiClient>, "createAccount" | "getSync" | "postSync" | "deleteAccount">;
```
Also `KNOWN_CODES` gains `"unauthorized"`; `codeFromStatus(401)` -> `"unauthorized"`.

- Produces (engine):

```ts
export type SyncStatus = "signed_out" | "idle" | "syncing" | "offline" | "unauthorized" | "error";
export interface SyncSnapshot {
  code: string | null;      // normalized
  status: SyncStatus;
  pending: number;
  syncedAt: number | null;  // epoch ms of last successful exchange
  summary: { added: number; kept: number } | null; // from the last join
  error: string | null;
}
export interface SyncEngine {
  readonly storage: GardenStorage;          // decorated: mutators also enqueue ops
  getSnapshot(): SyncSnapshot;
  subscribe(l: () => void): () => void;
  enableWithNewAccount(): Promise<void>;    // needs a link
  joinWithCode(raw: string): Promise<void>;
  flush(): Promise<void>;
  signOut(): void;                          // forget the code on this device, keep data
  deleteCloud(): Promise<void>;
  start(): () => void;                      // attach visibility/online listeners + initial flush; returns cleanup
}
export function createSyncEngine(opts: {
  base: GardenStorage; api: SyncApi; backing: Backing | null;
  now?: () => number; debounceMs?: number; // default 2000
}): SyncEngine;
```
Persisted under `localStorage` key `garden-hq:sync:v1` as `{ code, pending: SyncOp[], etag, syncedAt }` (parse defensively; every field optional).

- [ ] **Step 1: Client tests first** (`client.test.ts`, existing style with a fake `fetchFn`):
  - `getSync` sends `Authorization: Bearer <code>` and `If-None-Match` when an etag is given; returns `null` on 304; returns `{ state, etag }` from the `ETag` header on 200; 401 -> `ApiError("unauthorized")`.
  - `postSync` sends JSON `{ ops }` with `Content-Type: application/json`.
  - `createAccount` POSTs `{ link }` without an Authorization header.
  - `deleteAccount` accepts 204 (no body to parse).
  - The sync code never appears in a URL (assert on the called URL).

- [ ] **Step 2: Extend the client.** Generalise the private `get` into `request<T>(method, path, { params, headers, body })`; keep `get` as a thin wrapper so existing methods and tests are untouched. A 204/304 must not call `res.json()`.

- [ ] **Step 3: Engine tests first** (`sync.test.ts`; fake `SyncApi` with `vi.fn`s, `createGardenStorage(null)` base, fake timers). Required cases, each its own `it`:
  1. Signed out: mutating the decorated storage changes data but `pending === 0` and no API call.
  2. `enableWithNewAccount`: calls `createAccount(link)`, stores the code, then `postSync` with `seedOps(local)`; `status === "idle"`; throws a readable error if there is no link (no API call).
  3. After sign-in a mutation enqueues one op, and the flush runs after `debounceMs` (not before); three quick mutations to the same plot send **one** `setAssignment`.
  4. Offline: `postSync` rejects `ApiError("network")` -> `status === "offline"`, ops stay queued (also persisted to the backing), a later `online`-triggered `flush` sends them and clears the queue.
  5. Reload persistence: a second engine built on the same backing sees the code and the pending ops.
  6. Pull: server state replaces local data for keys **without** a pending op; a key with a pending op keeps the local (rebased) value.
  7. 304 on pull changes nothing and still updates `syncedAt`.
  8. `joinWithCode("abcd-…")`: normalizes; invalid format throws before any API call; on 401 local data is untouched and no code is stored; success with differing local data -> POST of only the missing ops, local replaced by cloud + added items, `summary` set (`added`, `kept`), code stored; local data **unchanged if the POST fails** (e.g. network error), no code stored.
  9. `unauthorized` during flush -> `status === "unauthorized"`, queue retained, no further automatic retries until `joinWithCode`/`signOut`.
  10. `rate_limited` -> `status === "error"` with a message containing the wait.
  11. `signOut` clears code and queue, keeps data. `deleteCloud` calls `deleteAccount` then behaves like `signOut`; if the API call fails the code is **kept** and `error` is set.
  12. An op enqueued **while a flush is in flight** is neither lost nor sent twice (resolve the in-flight `postSync` manually after mutating).
  13. `clearAll()` on the decorated storage keeps the code (sign-out is separate) and enqueues nothing.

- [ ] **Step 4: Run, expect FAIL**

Run: `pnpm --filter @garden-hq/web test -- client sync`

- [ ] **Step 5: Implement `sync.ts`.** Shape:

```ts
const KEY = "garden-hq:sync:v1";

export function createSyncEngine(opts): SyncEngine {
  const { base, api, backing } = opts;
  const now = opts.now ?? (() => Date.now());
  const debounceMs = opts.debounceMs ?? 2000;
  let persisted = loadPersisted(backing);            // { code, pending, etag, syncedAt }
  let inFlight: SyncOp[] = [];                       // taken from pending while a request runs
  let status: SyncStatus = persisted.code === null ? "signed_out" : "idle";
  let summary: SyncSnapshot["summary"] = null;
  let error: string | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  let snapshot = buildSnapshot();                    // new object only on change (useSyncExternalStore)

  function save(): void { /* write { code, pending: [...inFlight, ...persisted.pending], etag, syncedAt } in try/catch */ }
  function notify(): void { snapshot = buildSnapshot(); listeners.forEach((l) => l()); }
  function enqueue(op: SyncOp): void {
    if (persisted.code === null) return;
    persisted = { ...persisted, pending: enqueueOp(persisted.pending, op) };
    save(); notify(); schedule();
  }
  function schedule(): void { if (timer) clearTimeout(timer); timer = setTimeout(() => void flush(), debounceMs); }
  // ...
}
```

Decorated storage: object spread of `base` with each mutator wrapped:

```ts
function wrap<A extends unknown[]>(fn: (...a: A) => unknown, toOp: (...a: A) => SyncOp) {
  return (...a: A) => {
    const before = base.getSnapshot();
    const result = fn(...a);
    if (base.getSnapshot() !== before) enqueue(toOp(...a));
    return result;
  };
}
```
Applied to `setLink`, `setAssignment`, `markGreenhouse`, `unmarkGreenhouse`, `setGreenhouseCell`, `markGreenhouseWatered`, `setWateringInterval`, `setTimeZone`. `getSnapshot`, `subscribe`, `clearLink`, `clearAll`, `replaceAll` pass through unchanged. (`clearLink` is local-only by design; the next `setLink` syncs.)

`flush()` (single-flight; if called while `running`, set `again = true` and re-run once when it finishes):
1. If no code -> return. Clear the timer. `status = "syncing"`.
2. Loop: while `persisted.pending.length > 0`: `inFlight = persisted.pending.slice(0, MAX_OPS_PER_REQUEST)`; `persisted.pending = persisted.pending.slice(inFlight.length)`; `await api.postSync(code, inFlight)`; on success `inFlight = []`, `etag = result.etag`, `applyServer(result.state)`.
3. If nothing was pushed: `const r = await api.getSync(code, persisted.etag)`; if `r !== null` -> `applyServer(r.state)` and store etag; set `syncedAt = now()`.
4. `catch (e)`: put `inFlight` back at the **front** of `pending` (`pending = [...inFlight, ...pending]`, `inFlight = []`), map `ApiError.code`: `network` -> `offline`; `unauthorized` -> `unauthorized`; `rate_limited` -> `error` with `Try again in ${retryAfter ?? 60}s`; else `error`. Never rethrow from `flush` (callers are event handlers).
5. `applyServer(state)`: `const { revision: _r, ...server } = state; base.replaceAll(applyOps(server, [...inFlight, ...persisted.pending]))` — i.e. rebase the not-yet-acknowledged ops on top of the server state.

`enableWithNewAccount()`: needs `base.getSnapshot().link`; `const { syncCode } = await api.createAccount(link)`; set `persisted.code`; `await api.postSync(code, seedOps(local))` (skip if empty); `applyServer`; status idle. If the `postSync` fails after the account exists, keep the code and queue the seed ops in `pending` so the next flush completes the migration.

`joinWithCode(raw)`: as in tests 8. Compute `planJoin(local, server)`, POST only `ops` if non-empty, then `base.replaceAll(finalState)`, set code/etag/summary, clear pending.

`start()`: `document.addEventListener("visibilitychange", ...)` (flush when `visibilityState === "visible"`), `window.addEventListener("online", ...)`, and one initial `void flush()`. Return a cleanup that removes both and clears the timer. Guard every `document`/`window` access for tests without them.

- [ ] **Step 6: Run + typecheck + lint, expect PASS**

Run: `pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck && pnpm lint`

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/core
git commit -m "feat(web): sync API client and offline-first SyncEngine"
```

---

### Task 7: Web — provider, Settings "Cloud save" section, wiring

**Files:**
- Create: `apps/web/src/state/SyncProvider.tsx`, `apps/web/src/components/SyncSection.tsx`, `apps/web/src/components/SyncSection.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/screens/SettingsScreen.tsx`, `apps/web/src/screens/SettingsScreen.test.tsx`, `apps/web/src/test/renderWithProviders.tsx`, `apps/web/src/index.css`

**Interfaces:**
- Consumes: `SyncEngine`, `SyncSnapshot`, `createSyncEngine`, `api`, `formatSyncCode`, `isSyncCode`, `normalizeSyncCode`.
- Produces: `SyncProvider({ engine, children })`, `useSyncEngine(): SyncEngine`, `useSyncSnapshot(): SyncSnapshot` (via `useSyncExternalStore`). `renderWithProviders` gains `sync?: SyncEngine`; default builds an engine with `base = storage`, an inert `api` whose methods reject `ApiError("network")`, and `backing: null`, so all existing tests behave as before.

- [ ] **Step 1: Failing tests** `SyncSection.test.tsx` (inject a fake engine object or a real engine with a fake `SyncApi`):
  - Signed out and **linked**: shows "Save to cloud" and an "I already have a code" input + "Use code" button; clicking Save calls `enableWithNewAccount`.
  - Signed out and **not linked**: "Save to cloud" is disabled with the hint "Link a Minecraft name first".
  - Signed in: the code is **masked by default** (`••••-••••-…`, the real characters absent from the DOM); "Show" reveals the formatted code; **Copy** calls `navigator.clipboard.writeText` with the **formatted** code; the exact warning text "Save this somewhere safe. It is the only way to restore your data on another device or after clearing your browser. We cannot recover it." is visible (always, not only when revealed).
  - Status line: "Last synced X min ago" (reuse the existing relative-time helper used by `SyncBar`; grep for it), "N changes waiting to sync" when `pending > 0`, "Offline — changes are saved on this device and will sync later." when offline, "This code was not recognised. Enter it again or sign out of this device." when unauthorized, the error text for `error`.
  - Join summary: after `joinWithCode`, shows "Added 3 items from this device; kept the cloud version for 1." (singular/plural correct: "1 item").
  - "Sign out of this device" calls `signOut`.
  - "Delete cloud data" needs a second confirming click ("Really delete cloud data? This cannot be undone." + "Yes, delete") before calling `deleteCloud`.
  - An invalid pasted code shows an inline error and does not call the engine.

  `SettingsScreen.test.tsx`: existing tests still pass; "Clear local data" still only clears local data and does not call the engine's `deleteCloud`.

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @garden-hq/web test -- SyncSection Settings`

- [ ] **Step 3: Implement.**
  - `SyncProvider.tsx`: context holding the engine; `useSyncSnapshot` = `useSyncExternalStore(engine.subscribe, engine.getSnapshot)`; follow the lint pattern in `StorageProvider.tsx` (`// eslint-disable-next-line react-refresh/only-export-components`).
  - `App.tsx`: build once with `useState`: `const [{ engine }] = useState(() => { const base = createGardenStorage(browserBacking()); return { engine: createSyncEngine({ base, api, backing: browserBacking() }) }; })`; render `<StorageProvider storage={engine.storage}><SyncProvider engine={engine}>…`; `useEffect(() => engine.start(), [engine])`. (StrictMode double-invokes effects; `start()` must be safe to call twice because cleanup runs between.)
  - `SyncSection.tsx`: a `<section>` card titled "Cloud save" using existing `card` / button classes; copy button uses `navigator.clipboard?.writeText` in try/catch and shows "Copied" for 2 s. Mask with a `<code>` element; keep the real string only in a closure/state, rendered only when revealed.
  - `SettingsScreen.tsx`: render `<SyncSection />` between the time zone and the link controls. Keep "Clear local data" and add a one-line note under it: "Your cloud copy is not affected."
  - `renderWithProviders.tsx`: add the `sync` option as described.
  - `index.css`: minimal styles; must be legible at 380 px (code wraps; buttons stack).

- [ ] **Step 4: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format`
Expected: all PASS.

- [ ] **Step 5: Manual check in a browser** (the repo's `run` skill / `pnpm --filter @garden-hq/worker dev` with a `.dev.vars`, `pnpm --filter @garden-hq/web dev`): link a name, assign a plot, press "Save to cloud", note the code, open a second private window, "I already have a code", paste, confirm the plot appears; go offline in devtools, change a plot, go online, confirm it syncs; wrong code shows the unauthorized message. Report what was actually observed. If the browser tools are unavailable, say so rather than claiming it was verified.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): Cloud save section in Settings (new account, join with code, copy, delete)"
```

---

### Task 8: Deploy wiring, docs, free-plan verification

**Files:**
- Modify: `.github/workflows/ci.yml`, `apps/worker/README.md`, `data/VERIFY.md`, `docs/superpowers/specs/2026-10-07-phase-3-planner-sync-alerts-design.md` (status line only)

- [ ] **Step 1: CI migration step.** In the `deploy` job, before "Deploy worker", add:

```yaml
      - name: Apply D1 migrations
        run: pnpm --filter @garden-hq/worker exec wrangler d1 migrations apply DB --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
Owner action (cannot be done from here): the `CLOUDFLARE_API_TOKEN` secret must include **D1 → Edit**. State this in the final report.

- [ ] **Step 2: README** (`apps/worker/README.md`): document the new routes, `DB` and `CODE_LIMITER` bindings, `wrangler d1 migrations apply DB --local|--remote`, that sync codes are stored only as SHA-256, **no recovery**, and update the "Limits" paragraph (sync routes: 30 req/min/IP incl. failures x5; account creation shares the 10/min limiter).

- [ ] **Step 3: `data/VERIFY.md`** entries: D1 batch vs 50-queries-per-invocation counting (and the result of the check done in Task 5); CPU cost of SHA-256 + a 200-op batch against the 10 ms free limit (measure on first deploy via `wrangler tail`; lower `MAX_OPS_PER_REQUEST` if it is exceeded); `CODE_LIMITER` period fixed at 60 s so `retryAfter` is approximate.

- [ ] **Step 4: Spec status line:** change "nothing implemented" to note milestone A merged and B implemented on branch `phase-3b-cloud-save`, and the two deviations from "Decisions" (tables deferred to C; `profiles` + `revision` columns).

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format && pnpm build`
Expected: all PASS. Then `git log --oneline main..HEAD` and confirm one commit per task.

- [ ] **Step 6: Free-plan check against the live account** (read-only, after the owner deploys): `pnpm --filter @garden-hq/worker exec wrangler d1 info garden-hq` shows the row count and size; `wrangler tail` shows no `unhandled` events and CPU time under 10 ms for `POST /api/sync`. If not deployed yet, say so in the report rather than claiming it.

- [ ] **Step 7: Commit**

```bash
git add .github apps/worker data docs
git commit -m "chore: D1 migration step in CI, worker README, VERIFY notes for cloud save"
```

---

## Self-review (spec coverage)

| Spec requirement (B) | Task |
|---|---|
| Sync code, 160-bit base32, groups of 4, SHA-256 only stored | 1 (format), 4 (generate/hash), 5 (store) |
| Bearer header auth, no cookies | 4 |
| Per-IP rate limit on every code lookup, failures weigh more, 429 + Retry-After | 3 (binding), 4 |
| Account creation requires link, rate limited | 5 |
| Settings shows code, mask/reveal, Copy, "save this somewhere" warning | 7 |
| Second device "I already have a code" | 6 (`joinWithCode`), 7 |
| No recovery, `DELETE /api/account` | 5, 7 |
| Schema / migrations via wrangler | 3 (tables deferred to C: decision 1) |
| Ops mirror `GardenStorage`, idempotent, LWW by server time | 1, 5 |
| Validation moved into core and shared | 1, 5 |
| `GET /api/sync` with ETag/304 | 5, 6 |
| Offline-first engine, queue in localStorage, flush triggers, no polling | 6 |
| Server replaces local for keys without pending op | 6 (`applyServer` rebase) |
| Migration: new account seeds all local data; join = union, cloud wins, summary; local kept until success | 6, 7 |
| `clearAll` local only; separate confirmed cloud delete | 6, 7 |
| CORS adds POST/DELETE + Authorization | 4 |
| Webhook routes / `alert_settings` | **Out — milestone C** |
| Free plan: no KV writes, few D1 calls | 3, 5 (batch), 8 |

Type names checked for consistency across tasks: `SyncOp`, `StoredData`, `StoredLink`, `GreenhouseSave`, `SyncStateResponse`, `AccountCreateResponse`, `AccountRow`, `SyncApi`, `SyncEngine`, `SyncSnapshot`, `applyOp`/`applyOps`, `enqueueOp`, `seedOps`, `planJoin`, `replaceAll`, `CODE_LIMITER`, `CODE_FAILURE_COST`.
