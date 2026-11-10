# Phase 4 — Gamification (quests, XP, streaks, achievements) — Design

**Date:** 2026-11-10 · **Status:** approved by owner 2026-11-10 with changes (applied): `contest_crop` is API-verified from `jacobs_contest.contests`; backfilled achievements give full XP
**Parent:** CLAUDE.md §6 (`quests`, `player_xp`), §7 Gamification layer, §8 Phase 4. The Greenhouse half of Phase 4 already shipped in `2026-10-06-greenhouse-design.md`.
**Path:** architectural (new core module, new synced data, new D1 tables, new UI). Written without the question loop because the owner asked for a spec and then a stop. Every choice I made is listed under "Decisions" at the bottom.

## Goal

Give the player a small daily loop that is **honest**: 3 quests a day, each completed only by something the Hypixel API shows changed (or an explicit user-logged action), feeding a Player XP level, a streak and a list of achievements. Opening the app never rewards anything.

## Scope

### In
- `packages/core`: quest generation, verification, Player XP/levels, streak, achievements. Pure functions, data-driven from `/data`.
- Progress stored in `StoredData` (localStorage) and, when Cloud save is on, in D1 through the existing op-based sync.
- Web: quest card under "Do next", level/XP bar + streak flame in the HUD, Achievements screen.
- Optional milestone C: "streak about to break" Discord alert (off by default).

### Out
Pest-trap quests (not verifiable, see Gaps), quest rerolls, streak freezes, leaderboards, rewards with real-game value, web push, XP multipliers, time-limited events, sound.

### Three milestones, each ends deployable
| | Delivers | Needs |
|---|---|---|
| **A. Core + local UI** | Quests, XP, streak, achievements working with localStorage only (also the Cloud-save-off path); Home card, HUD, Achievements screen | nothing on the backend |
| **B. Cloud save** | Migration `0004`, new ops, progress in the sync response | A |
| **C. Streak alert** | Discord message when a streak is about to break | B (server must know today's quests) and the Phase 3C cron |

---

## 1. Concepts

**Day key.** A string `YYYY-MM-DD` for the local date in the player's `timeZone` setting. Quests reset at **00:00 local** (`resetHour: 0` in `data/quests.json`, so it is a data change to move it). Strings, not epoch days, so DST never makes a 23 h or 25 h day miscount. "Consecutive days" is calendar arithmetic on the strings. Changing the time zone mid-day just changes today's key; the old day's records stay as they were.

**Quest record** (one row per slot per day, immutable except `doneAt`):
```ts
interface QuestRecord {
  day: string;            // "2026-11-10"
  slot: 0 | 1 | 2;
  kind: QuestKind;
  params: Record<string, string | number>; // e.g. { target: 5 } or { plotId: "intermediate_3" }
  baseline: number | null; // the API value when the quest was created (null for user-logged)
  createdAt: number;       // epoch ms
  expiresAt: number;       // epoch ms of the next reset after creation (implementation addition)
  doneAt: number | null;
  xp: number;              // frozen at creation from data/quests.json
}
```

**Everything derived is derived.** Player XP, level, streak and achievement status are computed from the records by pure functions (`progressSummary`). There are no stored counters, so two devices can never disagree about a total or double-count.

## 2. Quest kinds (`data/quests.json`, versioned, `lastVerified`)

| Kind | Title example | Eligible when | Completes when | Source |
|---|---|---|---|---|
| `serve_visitors` | Serve 4 visitors | always | `visitorsServedTotal >= baseline + target` | API (`commission_data.total_completed`) |
| `gain_garden_xp` | Earn 300 Garden XP | level < 15 | `experience >= baseline + target` | API (`garden_experience`) |
| `unlock_plot` | Unlock plot `intermediate_3` | `cheapestNextPlot` exists and its cost ≤ composter ready compost + `unlockMaxShortfall` (data) | plot id is in `unlockedPlotIds` | API (`unlocked_plots_ids`) |
| `discover_mutation` | Discover a new mutation | player has a Greenhouse and `discoveredMutations.length` < total | `discoveredMutations.length > baseline` | API (profile member) |
| `analyze_mutation` | Analyze a mutation | at least one discovered but not analyzed | `analyzedMutations.length > baseline` | API (profile member) |
| `water_greenhouse` | Water the Greenhouse | at least one marked Greenhouse | player presses "I watered it" with `createdAt <= at <= now` and same day | **user-logged** (existing `markGreenhouseWatered`) |
| `contest_crop` | Farm in a Jacob's Contest | a contest (any crop) starts later today per the schedule | the profile member's `jacobs_contest.contests` has a key for a contest that **started after quest creation, on this quest's day**, with `collected > 0` | API (profile member), see below |

Target sizes scale with level so the quests are neither trivial nor impossible (`serve_visitors`: 3–5; `gain_garden_xp`: 5 % of the XP to the next garden level, clamped to a min/max). Numbers live in the JSON.

XP: API-verified quests 25 (plot unlock 40, mutation discovery 40); the one user-logged quest (`water_greenhouse`) 10. The gap is deliberate: honor-system actions earn little.

**`contest_crop` data (owner-confirmed on a real profile, 58 entries).** `member.jacobs_contest.contests` is keyed `"<sbYear>:<month>_<day>:<CROP_ID>"` with `{ collected, claimed_rewards?, ... }`, e.g. `"516:3_3:MELON": { collected: 8000 }`. A contest occupies exactly one SkyBlock day (20 real minutes), so the key gives its start: `startsAt = SKYBLOCK_EPOCH_MS + ((year-1)*372 + (month-1)*31 + (day-1)) * 20 min` (`contestStartMs` in `calendar.ts`). The quest completes when any key has `startsAt >= quest.createdAt`, `startsAt` inside the quest's day, and `collected > 0`. Hypixel's crop ids are mapped through `apiId` in `data/crops.json`: observed on the real profile `WHEAT`, `CARROT_ITEM`, `POTATO_ITEM`, `PUMPKIN`, `SUGAR_CANE`, `MELON`, `MUSHROOM_COLLECTION`, `NETHER_STALK`; **`CACTUS` and `INK_SACK:3` (cocoa) are the expected ids but were not seen, so they are `// VERIFY:` entries**. An unmapped crop id is ignored by the quest (never completes it, never errors) and is listed in `data/VERIFY.md`. A trimmed, anonymized fixture from the real profile lives in `packages/core/fixtures/`.

### Generation (`generateQuests`)
Input: day key, `GardenState`, member state, assignments, greenhouses, contests, an account seed (`mc_uuid`). Output: up to 3 records.
1. Build the eligible kinds from the table above.
2. Deterministic seeded shuffle (`hash(seed + day)`), so re-running on the same state gives the same quests; take the first 3 distinct kinds (`water_greenhouse` is the only user-logged kind, so at most one per day by construction).
3. If fewer than 3 are eligible, return fewer. Never invent a filler the player cannot complete.
4. `baseline` is read from the same `GardenState` the quest was generated against.

**When:** the first time the app has a *fresh* garden (synced within the last 10 minutes) on a new day key and no records exist for that day. If the garden fails to load, no quests are made (the card says "Quests appear once your garden loads"). Quests count progress **from the moment they are created**, not from midnight: something done before the first open of the day does not count. This is stated on the card ("Counts from when quests appear today").

**Two devices, same day:** the first `setQuests` for a day wins on the server; the second device adopts the winner's records on its next pull (see ops). Different devices therefore never show different quests for the same day.

### Verification (`evaluateQuests`)
`evaluateQuests(records, ctx) -> { completions: {day, slot, at}[] }`, pure. Runs on every garden refresh and after every local user-logged action. Rules:
- Only records whose `day` equals today's key and `doneAt === null` are evaluated. **Yesterday's unfinished quests expire at the reset.** A sync that first arrives after midnight cannot prove the action happened before midnight, so it is not counted. (User-logged actions carry their own `at` and are checked against the day window.)
- `at` for API-verified completions is the snapshot's `fetchedAt`, not the client clock.
- Counters are monotonic (`>=`), so API quirks that re-order or repeat a response cannot un-complete anything; `doneAt` is written once and never cleared.
- Missing or unparsable API fields mean "not completed", never "completed".

## 3. Player XP, levels, streak, achievements

**Player XP** = Σ `xp` of done quest records + Σ `xp` of unlocked achievements (+ the archive total, §5). **Level**: `data/player-levels.json` lists XP-to-next for levels 1–30 (proposed `60 + 20 * level`; ~150 days to max at 3 quests a day). Level is computed, never stored. The UI calls it "Player level" and the existing garden level "Garden level" so they cannot be confused.

**Streak.** A day counts when at least one quest of that day is done. `streak` = length of the run of consecutive day keys ending today, or ending yesterday if today has none yet (the streak is still alive, "at risk" until a quest is done). No freezes.

**Achievements** (`data/achievements.json`: id, title, description, `check` kind + threshold, `xp`). Tiered achievements are separate entries.
| Check | Tiers |
|---|---|
| `first_greenhouse` — `hasGreenhouse` (API objective) or ≥ 1 marked Greenhouse | 1 |
| `plots_unlocked` — `unlockedPlotIds.length` | 6, 12, 18, 24 ("all plots") |
| `crops_assigned` — distinct crop ids in `assignments` | 5, 13 ("all crops") |
| `mutations_discovered` — `discoveredMutations.length` | 1, 10, 20, 40 |
| `garden_level` | 5, 10, 15 |
| `visitors_served` — `visitorsServedTotal` | 50, 250, 1000 |
| `streak` — best streak reached | 3, 7, 30 |
| `quests_done` — lifetime done quests | 10, 50, 250 |

Evaluated whenever state changes. Unlocking is monotonic: once unlocked it stays unlocked even if, for example, an assignment is later removed. **Backfill:** achievements already true on the first evaluation are unlocked immediately with their **full XP, once** (owner decision: they are API-verified progress and make a fun start). Backfilled unlocks show as one "N achievements already earned (+X XP)" notice, not N toasts.

## 4. Data model

### `StoredData` (localStorage) gains
```ts
progress: {
  quests: QuestRecord[];                       // today + last 14 days
  achievements: Record<string, { at: number; xp: number }>;
  archive: { xp: number; doneQuests: number; doneDays: string[] }; // folded-in older history (doneQuests is an implementation addition, needed for the "quests done" achievement)
}
```
The existing sanitizer treats a missing `progress` as empty, so there is no storage version bump and old saves load unchanged. `compactProgress` folds records older than 14 days into `archive` (`xp` summed; `doneDays` keeps the distinct done day keys, newest 400) so localStorage stays small.

### New sync ops (idempotent, like the existing ones)
| Op | Effect | Conflict rule |
|---|---|---|
| `setQuests {day, quests[]}` | insert records for slots not yet present for that day | **first write wins** (INSERT OR IGNORE) |
| `completeQuest {day, slot, at}` | set `doneAt` if null | first write wins (earliest recorded) |
| `unlockAchievement {id, at, xp}` | insert if absent | first write wins |

These deliberately differ from the "last write wins" rule used for plots, because a completion or unlock is a one-way fact. All three are monotone, so replaying a queue after an offline period is safe. Client `applyOp` implements the same rules, so the existing rebase-on-pull in `sync.ts` (`applyServer`) works unchanged.

**Trust model:** the server cannot re-check game state (the cron only has snapshots for alerting accounts), so progress is self-attested like plot assignments. The server still validates: known `kind`, `xp` equal to the value in `data/quests.json`/`achievements.json` (a client cannot choose its own reward), `day` within ±1 day of the server's day in the account time zone, slot 0–2, at most 3 records per day, `at` not in the future beyond 5 min of skew. Cheating only inflates the cheater's own level, which is the same exposure as everything else in this app.

### D1 migration `0004_progress.sql`
```sql
CREATE TABLE quest_log (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  params     TEXT NOT NULL,
  baseline   REAL,
  created_at INTEGER NOT NULL,
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
No extra indexes (each index adds a written row). Deviation from CLAUDE.md §6: `quests` is renamed `quest_log` with the shape above, and `player_xp` is **not created**: XP, level and streak are derived, which removes the multi-device counter-conflict problem entirely.

`GET /api/sync` returns `progress` in the same shape as above: rows of the last 14 days, all achievements, and `archive` computed by two queries (`SUM(xp)` of done rows older than 14 days; `DISTINCT day` of done rows, newest 400). Two more queries per pull, well inside the 50-query budget. `account` deletion cascades.

## 5. Free-plan budget (D1 writes)

Per active player per day: 3 `quest_log` inserts (one batched op) + up to 3 completions + 0–2 achievement unlocks ≈ **≤ 8 rows**, plus the revision bump the existing batch already does. Counting against the existing 1,000 ops/account/day cap: ≤ ~10 ops. With 50 accounts ≈ 400 rows/day against the 100k/day limit. Reads: +2 queries on a changed pull only (a 304 costs none). **The client never writes on open**: nothing is sent unless a quest is created, completed, or an achievement unlocks. No cron cost in A/B. `quest_log` grows ~1,100 rows per player per year; no pruning needed for this phase (500 MB limit is far away); revisit at 100+ players.

## 6. UI

Same pixel style as the rest; **all numbers use the existing `.num` class (body font)**, headings and titles keep the pixel font.

- **Home → `QuestCard`**, directly under `DoNextCard`. Three rows: pixel checkbox, title, progress as `3/5` (`.num`) from the live garden value, reward `+25 XP`. User-logged quests show a small button ("I watered it", "I did it"). Done rows are ticked. Footer: "Resets in 5h 12m" (existing `Countdown`) and "Counts from when quests appear today". States: loading, garden failed ("Quests appear once your garden loads"), not linked, fewer than 3 eligible, all done ("All done — see you tomorrow").
- **HUD**: a new group at the end — `Lv 4` badge, a segmented XP bar with `120/200` in `.num`, and a flame with the streak (`5`). The flame is dimmed with "at risk" in its title/`sr-only` text when the streak is alive but today has no completed quest. Wraps to a second line at 380 px like the other HUD items. The badge links to the Achievements screen.
- **Achievements screen** (`/achievements`, not added to the tab bar, which is already four tabs at 380 px; reached from the HUD badge and a link on the quest card). Grid of cards: locked ones greyed with progress (`7/13 crops`), unlocked with date; header shows level, XP to next and best streak. One screen-reader-friendly list, no canvas.
- **Toasts:** a quest completing or an achievement unlocking shows a small non-blocking line in the card (no modal, no sound in this phase). Backfill is one line.
- **Settings:** the existing Alerts section gains the optional streak toggle in milestone C. Quests need no setting except the existing time zone.

## 7. Milestone C — streak alert (optional, off by default)

New alert type `streak_risk` in `data/alerts.json`, reusing the webhook, dedupe (`alert_log`), `deriveAlerts` and cron from Phase 3C.
- Fires when: the streak is ≥ `minStreak` (default 3, editable), no quest of today is done, and local time is within `leadHours` (default 3, editable) of the reset.
- **False-alarm guard:** a player may have completed quests in game without opening the app. So in the at-risk window the cron fetches a fresh garden for that account (counted in the existing Hypixel call cap), runs `evaluateQuests` on today's `quest_log` rows, writes any completions, and only then decides. User-logged quests (watering) cannot be confirmed by the cron, so they are never counted by it.
- Dedupe key `streak:<day>`; one message per day at most. Message: "Your 6-day streak ends in 3 h. One quest keeps it alive." Same `allowed_mentions: none` and webhook validation as other alerts.
- Capacity: only accounts that opted in and are inside the window are fetched, so it fits the existing `MAX_ALERTING_ACCOUNTS`/call budget; it needs a measurement on first deploy (CPU limit 10 ms, see `data/VERIFY.md`).

## 8. Gaps: data the API does not give us

| Missing | Effect | How it is handled |
|---|---|---|
| **Per-day or per-quest history** (only the running totals `total_completed`, `garden_experience`, collections) | Cannot know what happened earlier in the day | Baseline-at-creation: quests count from when they are generated. Stated in the UI. |
| **Snapshot freshness** — the garden is a snapshot, possibly minutes old | A stale baseline could credit a few minutes of earlier play | Generate only from a snapshot fetched ≤ 10 min ago; `at` uses the snapshot time. Residual error is bounded and only in the player's favour by minutes. `// VERIFY:` how old a Hypixel garden response can be. |
| **Pest traps placed / pests killed** | The CLAUDE.md example "Place 3 pest traps" cannot be verified | Dropped from v1. Not offered as a user-logged quest either, to keep honor-system quests to one kind. |
| **Crop collection deltas** ("collect 5,000 wheat") | Collections API is often disabled per player; never captured | Not offered. |
| **Greenhouse watering** | No API field | The only user-logged quest (existing "I watered it" button), low XP, `at` checked against the quest's day window. |
| **Contest crop ids for cactus and cocoa** | Not seen on the one real profile | Expected ids mapped with `// VERIFY:`; unmapped ids never complete a quest. |
| **Visitor identity/value** | Only a running total, no per-visitor reward | Quests use the count only. Nothing says "serve a rare visitor". |
| **Compost the player holds** | Cannot tell whether a plot is affordable | `unlock_plot` eligibility uses composter-ready compost plus a margin from data; failure to complete is harmless. Existing `// VERIFY:`. |
| **Whether a quest finished before midnight when the app is closed** | Late confirmation unprovable | Quests expire at reset (see §2). Milestone C's cron check narrows this for opted-in accounts only. |

## 9. Testing

Core (vitest, fixed `now`, fixture gardens; no network): `dayKey` across DST and time-zone changes; `generateQuests` determinism, eligibility per kind, never more than 3 and never filler; `evaluateQuests` per kind (done, not done, stale day, missing fields, monotonic, `at` from snapshot); `progressSummary` (XP, level boundaries, level cap); streak (gap, alive-but-at-risk, long run, tz change); achievements (each check, tier boundaries, monotonic, backfill with full XP); `contest_crop` (start derived from the key, started-before-creation ignored, `collected` 0 ignored, unmapped crop id ignored, other day ignored); `compactProgress` preserves XP and streak. Op semantics: first-write-wins and idempotent replay, shared by `applyOp` and the worker. Data integrity: every quest/achievement id and xp is valid, `lastVerified` present.

Worker: `0004` migration; the three ops (validation rejects unknown kind, wrong xp, day out of range, 4th slot); pull returns the archive correctly; budget counters; deleting the account removes progress. Web: `QuestCard` states, HUD wrapping at 380 px, Achievements locked/unlocked, nothing is written on open (no op enqueued by merely mounting), local-only mode works with Cloud save off. Milestone C: cron fixture runs for fire, no-fire after in-game completion, dedupe, opt-out.

## 10. Verification items for `data/VERIFY.md` when built
Garden response freshness; whether `jacobs_contest.contests` entries appear while a contest is still running or only after it ends (affects how soon `contest_crop` completes); the `apiId` for cactus and cocoa; whether `discovered_greenhouse_crops` can include non-mutation ids (affects the mutation-count quests/achievements and the "40" total); cron CPU headroom for the streak check; the proposed XP/level numbers are balance guesses, not game facts.

---

## Decisions (please confirm or change)

1. **Progress is derived, not counted.** No `player_xp` table; XP/level/streak computed from quest rows + achievements. Deviation from CLAUDE.md §6, made to avoid multi-device counter conflicts.
2. **Reset at 00:00 in the player's time zone setting**, as a data value (`resetHour`). Day keys are `YYYY-MM-DD` strings.
3. **Quests count from creation**, generated on the first open of the day with a garden ≤ 10 min old. Playing before the first open does not count.
4. **Unfinished quests expire at reset** and are not credited by a late sync.
5. **Seven quest kinds**; only `water_greenhouse` is user-logged (10 XP), the rest API-verified at 25–40 XP (`contest_crop` 25). Fewer than 3 quests if fewer are eligible; never filler.
6. **Pest-trap quests dropped** (unverifiable). `contest_crop` is API-verified via `jacobs_contest.contests` (owner-confirmed on a real profile).
7. **First-write-wins for the three new ops** (quest creation, completion, achievement unlock), unlike the last-write-wins ops for plots; server validates `xp` against the data files, so progress is self-attested but not self-priced.
8. **Streak:** day counts with ≥ 1 done quest; alive-but-at-risk until then; no freezes. Streak milestones are achievements, not XP multipliers.
9. **XP numbers** (quest 25/40/10, level cost `60 + 20 * level`, cap 30) are balance proposals in data files.
10. **Backfilled achievements give full XP, once** (owner decision).
11. **Achievements screen is a route linked from the HUD badge and the quest card**, not a fifth tab.
12. **Storage:** `progress` inside `StoredData`, no version bump; D1 tables `quest_log` and `achievements`, no indexes; ≤ ~8 rows written per active player per day.
13. **Milestone C (streak alert)** is optional, off by default, fetches a fresh garden for opted-in accounts inside the at-risk window so it does not warn about quests already done in game.
14. **Order:** A (works locally), B (cloud), C (alert). Each gets its own plan file.
