# Phase 3 — Planner, cloud save, Discord alerts — Design

**Date:** 2026-10-07 · **Status:** approved by owner with changes (applied 2026-10-07); nothing implemented. Free-plan limits re-verified against Cloudflare docs the same day.
**Parent:** CLAUDE.md §4 Topology, §6 Data model, §7 Planner + Notifications, §8 Phase 3 (web push and PWA install are **out**, see Scope).
**Path:** architectural (new D1 subsystem, new cron job, new notifier). Written without the usual question loop because the owner asked for a spec and then a stop; the owner's review changes are folded in and recorded in "Decisions" at the bottom.

## Goal

1. A "what should I do now" list, ranked, computed by one pure function in `packages/core`.
2. The player's own data (crop assignments, Greenhouse plots and layouts, watering times, time zone, link) saved to Cloudflare D1 so it follows them across devices. `localStorage` stays as the offline cache; existing local data is migrated on first sync.
3. Discord webhook alerts from a Worker cron: contest for one of my crops in 5 minutes, composter out of fuel, visitors waiting, Greenhouse needs water. Every alert is deduplicated.
4. All of it on the Cloudflare **free plan**, with KV writes kept far below the 1,000/day limit.

## Scope

### In
- `packages/core/src/planner.ts`: `planActions` (ranked list) and `deriveAlerts` (alert candidates with dedupe keys), sharing the same detection predicates so the UI and the cron never disagree.
- Worker: D1 binding, migrations, account + sync routes, Discord notifier, `scheduled` handler.
- Web: "Do next" list on Home, Sync and Alerts sections in Settings, an offline-first sync layer under the existing `GardenStorage`.
- Free-plan hardening of the existing KV usage (see "Free-plan budget").

### Out (deferred, each needs its own spec)
Web push / PWA install, notification types `composter_full`, `level_up`, `quest_reset`, `greenhouse_decay` (CLAUDE.md §7; no verified data for them), quests/XP/streaks/achievements (Phase 4), crop milestone in the planner (needs `resources_collected` thresholds), a 48 h snapshot history, Discord OAuth, account recovery.

### Three milestones, each ends deployable
| | Delivers | Needs |
|---|---|---|
| **A. Planner** | **First: move per-player caching out of KV.** Then core `planner.ts` + Home "Do next" list, fully local | nothing new on the backend |
| **B. Cloud save** | D1, accounts, sync, migration | A is independent; B is independent of C |
| **C. Alerts** | Cron, Discord, alert settings | B (server needs the player's data) and A (shared detection) |

Each gets its own plan file. A and B can be built in either order; C is last.

---

## A. Planner

### Interface (`packages/core/src/planner.ts`, no fetch, no DOM, no `any`)

```ts
interface PlannerInput {
  now: number;                       // epoch ms
  garden: GardenState;
  contests: Contest[];
  assignments: Record<string, string>; // plotId -> cropId (user input)
  greenhouses: Record<string, { lastWateredAt: number | null; wateringIntervalHours: number | null }>;
}

type ActionKind =
  | "contest_soon" | "composter_no_fuel" | "composter_fuel_low"
  | "visitors_waiting" | "greenhouse_water" | "plot_unlock" | "garden_level";

interface PlannedAction {
  kind: ActionKind;
  /** Stable id for React keys and the alert dedupe key, e.g. "contest:1790000000000:wheat". */
  id: string;
  title: string;            // "Wheat contest in 12 min"
  detail: string;
  dueAt: number | null;     // when it becomes/became urgent
  rank: number;             // lower = earlier in the list
}

planActions(input: PlannerInput): PlannedAction[]
```

### Ranking
CLAUDE.md §7 gives the order; I keep it as the **tier**, and sort by `dueAt` inside a tier (soonest or most overdue first):

| Tier | Action | Triggers when |
|---|---|---|
| 1 | `contest_soon` | A contest starts within 60 min and at least one of its 3 crops is assigned to an **unlocked** plot. |
| 2 | `composter_no_fuel` / `composter_fuel_low` | `forecastComposter(...).status === "no_fuel"` (always), or `stopsBecause === "fuel"` and `stopsAt` is within the early-warning window (default 30 min, same setting as the alert; stored in `data/`, not code). |
| 3 | `visitors_waiting` | `garden.visitors.length > 0`. Detail lists names only. Copper and Garden XP value are **dropped for now** (see Gaps). |
| 4 | `greenhouse_water` | A marked Greenhouse has a `wateringIntervalHours` and `lastWateredAt + interval <= now + 30 min`. Never fires without an interval (see Decisions, #5). |
| 5 | `plot_unlock` | `cheapestNextPlot` returns a plot. Detail: cost and "composter has N ready". |
| 6 | `garden_level` | Level < 15: XP remaining to next level from `data/garden-levels.json`. |

"My crop" = a crop id present in `assignments` whose plot id is in `garden.unlockedPlotIds`. Stale assignments for locked plots are ignored.

### Gaps found while exploring (flagged, not guessed)
- **Compost still needed for a plot:** the API gives compost in the composter bin only, not the player's inventory. v1 shows "cost X, composter holds Y ready" and does not claim a shortfall. `// VERIFY:` + entry in `data/VERIFY.md`.
- **Visitor copper / Garden XP value: dropped from the planner (owner decision).** `data/visitors.json` is listed in CLAUDE.md but does not exist, and `GardenState.visitors` only has `{ id, name }`. Leave a `// TODO(visitors.json)` at the visitors row in `planner.ts`; revisit when the data file is written from the wiki.
- **"Fastest source" for the next Garden level:** needs visitor values too. v1 shows XP remaining only.
- **Greenhouse water interval:** `mutations.json` has `needsWater: null` for every mutation (unverified). So the player sets a per-Greenhouse "remind me every N hours after watering"; no default.
- Composter "full" is not predicted (existing `VERIFY` in `composter.ts`), which is why it is not an alert.

### KV fix (first task of milestone A)
`/api/garden` and `/api/link` write a 60-second per-player entry to KV on every cache miss (see "Free-plan budget"). Replace with a small in-isolate memory cache (`Map`, 60 s TTL, best effort, bounded size) behind the same `cached()`-style signature, so the routes and their tests change minimally. KV remains only for shared data (election, contests, Mojang names). Done before anything else so the 1,000 writes/day limit is never at risk while the rest is built.

### UI
`apps/web/src/screens/Home` gets a "Do next" card: top 5 actions, tap opens the relevant screen (contests, composter gauge, map plot, Greenhouse tab). Empty state: "Nothing urgent." "Last synced X min ago" shown on the card (CLAUDE.md §3).

### Tests
Vitest with fixed `now` and the existing garden fixture: one test per tier trigger and non-trigger, tier-then-`dueAt` ordering, stale-assignment filtering, empty input, and `deriveAlerts` keys stable across calls with the same input.

---

## B. Cloud save (D1)

### Identity: sync code (no login, no OAuth)
There is no auth today: the link is just username → uuid in `localStorage`. Keying cloud data by uuid alone would let anyone who types a username read or overwrite that player's data and read their Discord webhook. So:

- `POST /api/account` creates an account and returns a **random sync code** once: **160 bits** from `crypto.getRandomValues`, base32 (32 characters, shown in groups of 4). Never less than 128 bits of entropy. The server stores only its **SHA-256 hash**.
- Every other request sends `Authorization: Bearer <code>`. Header auth, no cookies, so no CSRF.
- **Lookups are rate-limited per IP**: every request that presents a code (including failed ones) counts against a stricter limiter than the general one (e.g. 20 per minute, failures weigh more), using the existing `pickLimiter`. Returns 429 with `Retry-After`. At 160 bits brute force is infeasible regardless; the limiter stops cheap abuse and log noise.
- **Settings shows the code** (masked by default, reveal toggle) with a **Copy** button and a plain warning: "Save this somewhere safe. It is the only way to restore your data on another device or after clearing your browser. We cannot recover it."
- A second device chooses "I already have a code" and pastes it. The code is kept in `localStorage`.
- **No recovery.** Lose every device and the code and the cloud copy is unreachable; the player starts over. Acceptable for hobby scope, stated in the UI and the privacy page.
- `DELETE /api/account` removes everything (privacy page requirement).
- Creating an account requires a linked profile (`mc_uuid`, `profile_id`) because the cron needs them. Account creation is rate-limited per IP with the existing limiter.

### Schema (`apps/worker/migrations/0001_init.sql`, via `wrangler d1 migrations`)
Follows CLAUDE.md §6 except where noted.

```sql
accounts(id TEXT PK, code_hash TEXT UNIQUE, mc_uuid TEXT, mc_name TEXT, profile_id TEXT,
         tz TEXT DEFAULT 'Europe/Warsaw', created_at INT, last_seen_at INT)
plot_assignments(account_id, plot_id, crop_id, updated_at, PK(account_id, plot_id))
greenhouses(account_id, plot_id, cells TEXT /*JSON {"x,z": id}*/, last_watered_at INT NULL,
            watering_interval_hours REAL NULL, updated_at, PK(account_id, plot_id))
alert_settings(account_id PK, discord_webhook TEXT NULL, webhook_ok INT DEFAULT 1,
               rules TEXT /*JSON: type -> {enabled, leadMinutes?, threshold?}*/)
garden_snapshot(account_id PK, fetched_at INT, json TEXT, next_sync_at INT)
alert_log(account_id, type, key, sent_at, PK(account_id, type, key))
```

Deviations from §6, on purpose:
- **Greenhouse cells as one JSON blob per Greenhouse**, not one row per cell: ≤100 cells, atomic edit, one row to read. §6's `planted_at` per cell is dropped because the app does not track it.
- **One latest `garden_snapshot` per account**, not 48 h of history. History only matters for diffing, which nothing in this phase needs; it would cost writes and storage for no feature.
- `chips` table not created: chips are read-only from the API.
- `discord_webhook` is a secret: stored server-side, **never returned**; the API only says `hasWebhook` plus the last 4 characters.

### API
| Route | Purpose |
|---|---|
| `POST /api/account` `{ link }` | create, returns `{ syncCode }` |
| `GET /api/sync` | full state: link, assignments, greenhouses, settings, alert rules; `ETag` = revision |
| `POST /api/sync` `{ ops: [...] }` | apply operations, return full state |
| `PUT /api/alerts/webhook` / `DELETE` / `POST /api/alerts/test` | manage and test the webhook |
| `DELETE /api/account` | wipe |

**Operations, not whole-document PUTs.** The ops mirror `GardenStorage` one to one: `setAssignment`, `markGreenhouse`, `unmarkGreenhouse`, `setGreenhouseCell`, `markGreenhouseWatered`, `setWateringInterval`, `setTimeZone`, `setLink`. Each is an idempotent set/delete of one key, so replaying the queue after an offline period is safe. **Conflict rule: last write wins per key**, using server receive time (client clocks are not trusted). Two devices editing different plots never conflict.

### Client sync layer (offline-first)
- `GardenStorage` keeps its current interface and `localStorage` backing. A new `SyncEngine` wraps it: each mutation also appends an op to a `pendingOps` queue (also in `localStorage`).
- Flush on: app start, tab becomes visible, after a mutation (debounced 2 s), `online` event. **No polling timer.** Server state is pulled on the same triggers; `If-None-Match` makes an unchanged pull a 304.
- After a pull, server state replaces local for keys without a pending op.
- Offline or signed out: app behaves exactly as today.

### Migration of existing local data
On first successful sync from a device:
1. **No account yet:** "Save to cloud" creates the account and sends all local data as ops. Done once; flagged by `syncedAt` in storage.
2. **Joining an existing account** from a device that already has local data: **union, server wins on the same key**. A one-line summary is shown ("Added 3 plots from this device; kept cloud version for 1"). Local copy is retained until the merge succeeds.
3. `clearAll` clears local data only. "Delete cloud data" is a separate, confirmed action.

### Tests
Core: none new. Worker: op validation (reuse the `isPlaceableId` / plot-id / cell-key checks already in `storage.ts`, moved into `packages/core` so both sides share them), auth (missing, wrong, deleted), last-write-wins, idempotent replay, webhook never in any response, migration import. Web: queue persists across reload, offline flush, merge summary. D1 tests run against Miniflare's in-memory D1 behind a small `Db` repository interface (decision in the plan; the existing worker tests use plain fakes, no workers pool).

---

## C. Discord alerts (cron)

### Trigger
`wrangler.toml`: `[triggers] crons = ["*/5 * * * *"]` plus `[[d1_databases]]`. `scheduled()` is a thin wrapper over `runSync(env, now)` in `apps/worker/src/cron.ts`, so it is testable without the runtime.

### Per run
1. `SELECT` accounts due (`next_sync_at <= now`) that have a working webhook and at least one enabled rule, **and whose `garden_snapshot.fetched_at` is older than 5 minutes** (a fresh snapshot, e.g. from a dashboard visit, is reused instead of re-fetched), ordered by `next_sync_at`, `LIMIT BATCH` (config, start at 10).
   - **Call caps per run:** at most `MAX_HYPIXEL_CALLS_PER_RUN` (default 8) Hypixel requests, and an overall **subrequest budget of 40** counted in code (Hypixel + Discord + KV + every D1 call). When the budget is spent the run stops cleanly; remaining accounts keep their `next_sync_at` and go first next run. The Hypixel client's existing `RateLimit-*` handling still applies; if remaining quota is low the run stops early.
2. Contests: reuse the existing `cached()` helper (KV, 15 min TTL → at most 96 writes/day, shared by all users).
3. For each account: fetch the garden (`/v2/skyblock/garden`), normalize with `normalizeGarden`, upsert `garden_snapshot`, run `deriveAlerts`.
4. For each candidate: `INSERT OR IGNORE INTO alert_log`; send to Discord **only if the insert changed a row** (claim first, so two overlapping runs cannot double send). If Discord returns 5xx/429, delete the claim so the next run retries; 429 honours `retry_after`; 404/401 means the webhook is dead: set `webhook_ok = 0` and stop for that account (UI shows "webhook broken, re-add").
5. Set `next_sync_at` (never earlier than `fetched_at + 5 min`): 15 min by default, 5 min when a predicted event (contest start, composter `stopsAt`, Greenhouse water time) is within the next 20 min. The composter and Greenhouse events are computed from the stored snapshot, so most runs do not need a fresh API call at all.
6. Prune `alert_log` older than 7 days at most once a day (first run after UTC midnight).

One bad account must not stop the batch: each is in its own try/catch, logged without PII (existing `log.ts` redaction).

### Alerts and dedupe keys
| Type | Fires when | Dedupe key |
|---|---|---|
| `contest_soon` | contest starts within `leadMinutes` (default 5) and one of its crops is "mine" | `startsAt:cropId` (one alert per contest, listing my matching crops) |
| `composter_fuel_out` | forecast `no_fuel` (fires **once** when fuel hits 0). Always available. | `fuel_out:<lastSave>` (new key whenever the composter is refilled/saved, so it re-arms) |
| `composter_fuel_low` | **optional, off by default:** fuel runs out within `leadMinutes` (suggested 30) | `fuel_low:<lastSave>` |
| `visitors_waiting` | queue is **full** (`threshold` default **5**, the max queue, because new visitors stop coming when it is full); editable 1–5 | `visitors:<sorted visitor ids>` ; re-arms when the queue drops below the threshold |
| `greenhouse_water` | `lastWateredAt + interval <= now` | `plotId:lastWateredAt` (pressing "I watered it" creates a new key) |

Message: one embed per alert, title + one line + "last synced X min ago". `allowed_mentions: { parse: [] }` so a message can never ping. Webhook URL must match `^https://(discord|discordapp)\.com/api/webhooks/\d+/[\w-]+$` before it is stored or called (blocks using the Worker as an SSRF proxy).

### Alert settings UI (Settings → Alerts)
Webhook field + "Send test message", per-rule toggle, and **every threshold editable**: contest lead minutes (default 5), fuel early-warning minutes (optional, default off), visitor queue size (default 5), per-Greenhouse watering interval. Rules are stored in `alert_settings.rules`; defaults are on for none until a webhook is verified by a test message.

### Tests
Core `deriveAlerts` (above). Worker `runSync` with fake D1, fake Hypixel client, fake Discord fetch and fixed clock: sends once across two consecutive runs, re-arms after refill, retries after a 5xx, disables on 404, one failing account does not block the others, batch limit respected, disabled rules send nothing, no webhook never appears in logs.

---

## Free-plan budget

Limits **verified against Cloudflare's docs on 2026-10-07** (sources: developers.cloudflare.com `workers/platform/limits`, `kv/platform/limits`, `d1/platform/limits`, `d1/platform/pricing`). Re-check before each milestone's deploy; they change.

| Limit (Free) | Value |
|---|---|
| Workers requests | 100,000 / day |
| CPU per invocation | **10 ms**, for HTTP requests **and** for each Cron Trigger run |
| Subrequests per invocation | **50**; the docs say this covers `fetch()` **and** calls to KV, R2 and D1 (so D1 and KV calls count; my earlier "may not count" was wrong) |
| D1 queries per invocation | 50 |
| Simultaneous open connections | 6 per invocation |
| Cron Triggers | 5 per account |
| KV writes | **1,000 / day** (different keys), 1 / second per key; reads 100,000 / day |
| D1 rows read / written | 5 million / day, **100,000 / day**; an index adds one written row per indexed write |
| D1 size | 500 MB per database, 5 GB per account, 10 databases |

The KV minimum `expirationTtl` was not stated on the page I fetched; the code already uses 60 s, which stays.

| Resource | Estimate | Verdict |
|---|---|---|
| KV writes | election 1 h TTL: ≤ 24/day; contests 15 min: ≤ 96/day; Mojang names: new names only. Per-player caching moves out of KV in milestone A. Cron and sync routes write **none**. | ≪ 1,000 |
| D1 rows written | cron ≤ 288 runs × 10 accounts × ~3 rows (+ index rows) ≈ 10k/day worst case; sync ops are hand-driven | ≪ 100k |
| D1 rows read | cron selects + sync pulls (304 when unchanged) | ≪ 5M |
| Subrequests per cron run | counted in code, budget **40** of 50: 1 contests KV read, 1 `SELECT`, ≤ 8 Hypixel, per account 1 batched D1 write, alert claims and Discord sends | enforced, not assumed |
| CPU per cron run | parsing ~5 KB garden JSON per account, ≤ 8 per run | **Unmeasured. Biggest risk** (10 ms). Mitigation: batch size and call cap are config; measure in the first deploy; lower if needed. |
| Hypixel key | ≤ 8 calls per 5 min against the key's limit, plus dashboard traffic through the same key | capped per run |

**Capacity:** 8 Hypixel calls per 5-minute run and the 5-minute snapshot-age skip mean roughly 24 alerting accounts at a 15-minute baseline (8 calls × 3 runs). Beyond that `next_sync_at` stretches (oldest first, nobody starves). A hard `MAX_CRON_ACCOUNTS` setting stops signups of alerting accounts past the cap, and accounts with no web activity for 60 days stop being synced. The ceiling of the free plan is a few dozen alerting players; going further means the paid plan.

**Existing KV problem, fixed first in milestone A:** `/api/garden` and `/api/link` write a 60-second per-player entry to KV on every cache miss: one write per fresh request. A handful of active users would reach 1,000/day, and CLAUDE.md §3 says never edge-cache per-player data anyway. Replaced by an in-isolate memory cache; KV is then used only for shared data.

---

## Hypixel API key (operations note)

Alerts depend on `HYPIXEL_API_KEY`, which lives only as a Worker secret.
- **Development keys are temporary** (they expire; Hypixel's developer dashboard shows the expiry). When the key expires the cron's Hypixel calls fail (401/403) and alerts silently stop.
- **Rotate:** create a new key at developer.hypixel.net, then `cd apps/worker && npx wrangler secret put HYPIXEL_API_KEY`, paste it, done (no redeploy needed for a secret). Check `GET /api/garden` for a linked profile afterwards.
- The cron must log (no PII) a distinct `hypixel_key_rejected` event and stop the run on 401/403 instead of burning calls on every account. A short README section documents rotation.
- **A production (application) key is required before anyone but the owner uses alerts.** Dev keys are for one person's testing; give other players alerts only after the production key is approved.

---

## Security and privacy notes
- Webhook URL and sync code are secrets: hashed (code) or server-side only (webhook), never logged, never returned.
- CORS today allows `GET, OPTIONS`; it must add `POST, PUT, DELETE` and the `Authorization` header, still limited to `WEB_ORIGIN`.
- Sync code lives in `localStorage` (same exposure as the current link). No third-party scripts on the page.
- Privacy page (Phase 5) must list: Minecraft name/uuid, plot/Greenhouse data, webhook URL, how to delete.
- Alerts only ever go to the webhook the player supplied.

## Open verification items (go to `data/VERIFY.md` when built)
Cron CPU headroom against the 10 ms limit; KV minimum TTL; compost inventory vs composter bin; visitor copper/XP values; Greenhouse watering interval; whether `unlocked_plots_ids`/composter timestamps update while the player is offline-from-Hypixel (affects how stale a forecast can be).

## Decisions (owner-approved 2026-10-07)
1. **Identity = sync code**, no Discord login. Entropy ≥ 128 bits (160 chosen), per-IP rate limit on lookups, Settings shows it with Copy and a save-it warning. No recovery.
2. **Conflicts = last write wins per key**, server clock.
3. **Local data migration = union, server wins on same key.**
4. **Alert defaults:** contest 5 min lead; composter alert once at fuel 0, optional early warning (off by default, 30 min suggested); visitors when the queue is full (5/5); Greenhouse alert only after the player sets an interval. All thresholds editable in Settings.
5. **No default Greenhouse watering interval** (recipe water data unverified).
6. **Deviations from CLAUDE.md §6:** JSON blob for Greenhouse cells, single latest snapshot, no `chips` table, no `player_xp`/`quests` yet.
7. **Cron:** batch 10, plus a cap on Hypixel calls per run (8), a 40-subrequest budget, and skip accounts whose snapshot is under 5 minutes old.
8. **Per-player KV caching removed** from `/api/garden` and `/api/link`, as the first task of milestone A.
9. **Order:** A (planner), B (cloud save), C (alerts).
10. **Visitor copper value dropped** from the planner; TODO for `data/visitors.json`.
11. **Hypixel key:** rotation documented; production key required before others use alerts.
