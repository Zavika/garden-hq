# VERIFY — open game-fact questions

Each entry: what's uncertain, why, and what would resolve it. Update as items get confirmed or add new ones per CLAUDE.md §9.

## Plots

- **Tier unlock levels** (garden level 1 / 3 / 5 / 7 for beginner / intermediate / advanced / expert) — from CLAUDE.md, not checked against a live account. Plot ids, plot numbers, grid cells and cost ladders come from EliteFarmers/Website `plots.ts` (user-supplied); only the id format (`advanced_5`) and the first 8 plots were seen on a real account, so the advanced/expert plot numbers and ladder rungs beyond that are not independently checked.

- **Plot adjacency rule** — a locked plot is shown as buyable only if its tier is unlocked by garden level AND it shares an edge (not a corner) with the Barn or an owned plot (`plotAvailability` in `plots.ts`). Derived from one real account (owned beginner/intermediate + `advanced_5` -> buyable 9-18, 20, 23; unreachable 21, 22, 24), not a wiki page; confirm the in-game purchase rule.

## Crops

- **`apiId`** — contest crops are mapped (8 observed on a real profile: WHEAT, CARROT_ITEM, POTATO_ITEM, PUMPKIN, SUGAR_CANE, MELON, MUSHROOM_COLLECTION, NETHER_STALK); **CACTUS and INK_SACK:3 (cocoa) are expected but unobserved**; flowers have none; unmapped ids are ignored by quests.
- **`tool`** (farming tool per crop) — same; set to `null`.
- **`contestCrop`** — medium confidence: research says all 10 classic crops (Wheat–Nether Wart) are contest crops and the 3 Garden flowers (Sunflower, Moonflower, Wild Rose) are not. Plausible and internally consistent, but re-verify against the actual Jacob's Contest crop list before relying on it for the contests feature (Phase 2/3).

## Pests

- CLAUDE.md's bait table only lists 5 baits / 10 pests. The wiki's Pest page lists 14 pests and 7 baits — Jelly and Moondew catch the 4 Greenhouse-flower pests (Dragonfly, Firefly, Praying Mantis, Lunar Moth), which CLAUDE.md doesn't mention. `data/pests.json` uses the corrected 7-bait table. **CLAUDE.md §2 should be updated to match** — not done as part of this plan since it's the user's spec file.

## Composter

- Exact tier count for the `fuelCap` and `organicMatterCap` upgrades (`data/composter.json` has `maxTier: null` for both) — the wiki confirms the per-tier effect (+30,000 each) and the final cap (850,000 / 790,000) but not how many tiers it takes to reach it, and the arithmetic doesn't divide evenly, implying a nonzero base cap that isn't documented.
- Per-tier purchase costs beyond tier 1-2 (Copper + rare crop amounts) — the wiki describes an "alternating pattern" through tier 25 for `speed`/`multi_drop` but doesn't spell out the full table. Not encoded in `data/composter.json` at all — only the decay/effect formulas `composter.ts` needs.
- **Composter base cap 40,000** (fuel and organic matter, `baseCap` in `data/composter.json`) is inferred, not stated by any source: the wiki's final caps (850,000 / 790,000) minus 27 / 25 tiers of +30,000 leave exactly 40,000. `composterCapacity(upgrades)` = base + tiers x 30,000, clamped to the wiki maximum. Confirm against a real account's `fuel_cap` / `organic_matter_cap` tiers and the in-game gauge.
- Composter consumption is modelled as continuous (while both fuel and organic matter remain); the game consumes per compost batch, so the forecast can be off by up to one batch.
- Compost bin storage cap (needed to predict "full at…" per CLAUDE.md §2) — not found anywhere. `composter.ts` (Task 5) only predicts fuel/organic-matter depletion for Phase 1, not compost-bin-full.

## Garden API fixture

- `packages/core/fixtures/garden-response.sample.json` (Task 6) is built from a third-party reconstructed OpenAPI spec (`github.com/api-evangelist/hypixel`), not a captured real API response — Hypixel's own interactive docs are a JS-rendered SPA that couldn't be fetched as text. Field _names_ are medium-confidence; nested map key formats (`active_commissions` entry keys, `resources_collected` keys, `crop_upgrade_levels` keys) and all numeric example values are unconfirmed. Swap this fixture for a real captured response once a Hypixel API key + linked account exists (Phase 2).
- The collections/skill XP path inside `/v2/skyblock/profiles` member objects (commonly `members.<uuid>.player_data.experience.SKILL_FARMING` from general knowledge, not fetched this session) — unconfirmed, and not used by any Phase 1 code yet.
- **`active_commissions` key format** — the fixture uses internal ids like `liam` / `farmer_jon`; `normalizeGarden` prettifies them into display names. Real key format and the id → display-name table (`data/visitors.json`, later phase) are unconfirmed.

## Calendar

- Day/night (`isDaytime` in `calendar.ts`) is assumed to be an even 50/50 split within the 20-minute SkyBlock day, aligned to the epoch. Vanilla Minecraft's exact dawn/dusk tick boundaries may differ slightly. Resolve by comparing against in-game day/night transitions (or the wiki's time-of-day page) and adjusting the split if timing drifts.

## Phase 2a Worker API (fixtures reconstructed, not captured)

- `packages/core/fixtures/{profiles-response,election-response,contests-elitebot,contests-strassburger,mojang-profile}.sample.json` are reconstructed from public docs/memory, not captured responses — same caveat as the garden fixture. Swap for real captures once a Hypixel key + linked account exists, and re-run the core + worker suites.
- `/v2/skyblock/garden` response nesting: live responses are believed to be `{ success, garden: {...} }`; the Phase 1 fixture is flat. `unwrapGardenResponse` accepts both.
- Profiles fields (`profiles[].profile_id`, `cute_name`, `selected`) and election fields (`mayor.key|name|perks[]`, `mayor.minister.perk`) — unconfirmed field names.
- EliteBot `/contests/at/now` and Strassburger `/api/jacobcontests`: response shapes (array vs map keyed by timestamp) and timestamp units (assumed epoch seconds) are unconfirmed; `normalizeContests` tolerates both shapes and both units. Contest _duration_ is not modelled.
- Hypixel `RateLimit-Remaining` / `RateLimit-Reset` (seconds until reset) header semantics — per CLAUDE.md §3, unverified against live responses.
- Cloudflare `[[ratelimits]]` binding availability on this account/plan; the KV fixed-window counter is the (approximate under concurrency) fallback.
- Hypixel status codes for "player/profile not found" and "no garden" (assumed `404` or `success:false` / `garden:null`) are unconfirmed.
- `Retry-After` is parsed only as numeric seconds (HTTP-date form unsupported).

## Greenhouse (captured 2026-10-06 from a real account; see docs/superpowers/specs/2026-10-06-greenhouse-design.md)

- **`garden.greenhouse_slots` = LOCKED cells** — owner-confirmed 2026-10-06: the real response lists 88 `{x, z}` cells (0..9) and the 12 centre cells absent from the list are the unlocked soil. Unlocked cells = 10x10 minus this list. Unconfirmed: whether this list describes every Greenhouse when a player owns several (the app applies it to all marked plots), and whether "Expand with Ethereal Vines" is the real cost for unlocking cells (the wiki ties Ethereal Vines to extra Greenhouse _plots_).
- **Greenhouse plots vs the 5x5 plots** — owner-confirmed 2026-10-06: a Greenhouse is a placeable plot on the 24-plot map (owner's is plot 4 = `beginner_3`, cell 2,3). The API does not say which plot is a Greenhouse, so the player marks them in the app (default none, max 3). Unconfirmed: whether the 3-plot limit is exact.
- **`last_growth_stage_time`** — a single epoch-ms value within 36 ms of `composter_data.last_save`; treated as a save timestamp, not a growth/water timer.
- **`player_data.garden_chips`** — real value `{"cropshot":5,"quickdraw":2}`; owner-confirmed these are chip LEVELS. CLAUDE.md §2 previously claimed chip state is not reliably exposed; it now reads that chip levels are exposed by the API, and the app reads them (read-only). Unconfirmed: the full list of chip ids and their maximum level.
- **`garden_player_data.{discovered,analyzed}_greenhouse_crops`** — values are mutation ids (`ashwreath`, `shadevine`, `dustgrain`, `lonelily`) plus `dead_plant`. Id spelling for the other 35 mutations (e.g. `do_not_eat_shroom`, `magic_jellybean`) is unconfirmed.
- **Mutation recipes** (`data/mutations.json`, written and verified on its `lastVerified` date) — the wiki Mutation page gives neighbour counts, not geometry. Geometry is INFERRED: a recipe's neighbours are modelled as the ring around the mutation's footprint (8 / 12 / 16 cells for 1x1 / 2x2 / 3x3) because 27 of the 36 neighbour recipes sum to exactly that ring size and none exceeds it (the 9 below it are 1x1 commons and Soggybud). Unknown: whether extra non-recipe neighbours are allowed, whether the ring is exact for partial recipes, what "2 Fire" means for Ashwreath. Four recipes are non-count (Lonelily, Shellfruit, Godseed, Jerryflower).
- **Unique-crop yield bonus** — wiki: +3% per unique non-mutated crop, 12 unique types, +36% max. The list of the 12 crops is not given; whether the bonus is per Greenhouse plot or global is unclear.
- **Water/decay** — the wiki says only that water level drops 2-3 per growth stage; no durations, no per-mutation `needsWater`. Nothing in the API. Timers are manual and carry no numbers until a source exists.
- **`/v2/skyblock/profile?profile=`** (singular) — existence and response shape unverified; fallback is filtering `profiles?uuid=`.
- **Resolved by the real capture:** `/v2/skyblock/garden` is wrapped as `{ success, garden: {...} }`; plot ids look like `beginner_1` / `advanced_5`; `active_commissions` keys are internal ids such as `gold_forger` and `royal_resident_peasant`. The Phase 1 garden fixture is synthetic and does not include any of the fields above.

## Mutations data verification (2026-10-06, Greenhouse Task 1)

- **Checked:** `data/mutations.json` was compared field-by-field (rarity, footprint, growth stages, growth surface, ingredient ids and counts, effects) against the raw wikitext of `hypixelskyblock.minecraft.wiki/w/Mutations` (Mutation redirects there), and spot-checked against the wiki Shellfruit page and a hypixel.net forum list ("List of Mutations in SkyBlock"). 40 mutations; rarity split 9/6/10/8/7 confirmed. Wiki mutation ids (from staff weight list) match ours. Fixed: growth surface filled from the wiki for every mutation (e.g. Farmland, Sand, Soul Sand, Mycelium, End Stone; Lonelily "Farmland, Dirt"), Fleshtrap stages 14, Jerryflower stages 10, Shellfruit text.
- **Neighbour counts are TOTAL blocks**, per wiki footnotes: e.g. Snoozling "6" in PlantBoy Advance means 6 blocks of Snoozling, which is 2 Snoozlings (wiki notes 2 plants cover it in practice). The JSON stores the wiki's total-block numbers; geometry for multi-cell ingredients is not modelled.
- **Fire** is not a crop (staff: "Fire isn't a crop"). Ashwreath needs 2 Nether Wart and 2 Fire nearby; what places "Fire" (fire block next to the soul sand?) is unconfirmed.
- **Shellfruit:** the Mutations page says "Explode a Turtlellini with a Blastberry"; the Shellfruit page and forum say 2 Blastberries (also "each Blastberry needs 1 growth stage to prime", "blows up all 8 adjacent crops"). Stored as 2 Blastberries; unconfirmed which is current.
- **Godseed:** "all positive crop effects" (3x3 on Farmland); the forum says easiest is 12 different crops with Sunflower or Moonflower. **Jerryflower:** "Grow the Fertilized Jerryseed" (needs Move Jerry items at stage 5 per the wiki Jerryflower page). **Lonelily:** 0 adjacent crops.
- **needsWater:** the older forum post sorts mutations into "no watering required" (commons) and "require watering" (others), but the current wiki table has no such column. Left `null` (no confirmed current per-mutation source).
- **Wiki edits in 2026** (Mar 18 drop reductions, Aug 24 Shellfruit drop change) show the page is still being rebalanced; recipes may drift. Wiki also lists spawn weights (staff Discord quote) that are not stored.

## Planner (Phase 3A, 2026-10-07)

- **Compost shortfall for a plot unlock** — the API exposes Compost sitting in the composter bin, not the player's inventory, so the planner shows "Costs N Compost. Composter holds M ready." and never claims a shortfall. Resolves if the API (or the player, via an input) gives inventory Compost.
- **Visitor copper / Garden XP value** — dropped from the planner. `data/visitors.json` (CLAUDE.md §5) does not exist yet; `planner.ts` has a `TODO(visitors.json)`. "Fastest source" for the next Garden level depends on it, so that row shows only the XP remaining.
- **Planner thresholds** (`data/planner.json`): contest window 60 min, fuel early warning 30 min, Greenhouse lead 30 min, visitor queue 5. These are product choices, not game facts, except the queue size of 5 (CLAUDE.md §2).
- **Greenhouse watering interval** — there is no verified water duration (see "Water/decay" above), so the row only fires when the player sets an interval AND has pressed "I watered it".
- **Composter action ids** — `composter_no_fuel` / `composter_fuel_low` are keyed on `composter.lastSave`. A missing `last_save` (0) is treated as "just saved" for the forecast, but the id would be `...:0`. Flagged for the alert dedupe in milestone C.

## D1 batch query counting (Phase 3B Task 5, checked 2026-10-12)

- **Question:** does `db.batch([...])` count as one query or one per statement against the free plan's 50 queries per Worker invocation?
- **Source:** developers.cloudflare.com/d1/platform/limits/ lists "Queries per Worker invocation: 1000 (Paid) / 50 (Free)" and says the limits for individual queries "apply to each individual statement contained within a batch statement". That sentence concerns per-query limits inside a batch; whether a batch's statements count toward the 50-queries-per-invocation limit is NOT confirmed.
- **Mitigation:** `MAX_OPS_PER_REQUEST` in core is 40, so a POST is one atomic batch of at most 41 statements, plus about 4 other queries (auth lookup, account reload, 2-select state read): at most about 45 queries per POST even if every statement counts. No chunking (it would break atomicity and the revision bump).
- **To verify:** check on first deploy with `wrangler tail` (look for D1 query-limit errors on a 40-op POST).
- **Result of the Task 5 check:** the docs did not settle it, so it stays unconfirmed until the first deploy (see the checklist in `apps/worker/README.md`).

## Free-plan CPU and limiter notes (Phase 3B Task 8, 2026-10-12)

- **CPU vs the 10 ms free limit** — the CPU cost of SHA-256 on the sync code plus a 40-op atomic batch (up to 41 statements) is unmeasured. Measure on first deploy with `wrangler tail`; lower `MAX_OPS_PER_REQUEST` if CPU time exceeds 10 ms.
- **`CODE_LIMITER` period** — the Workers rate-limit binding supports a fixed 60 s period (configured in `wrangler.toml`), so the `Retry-After` the Worker returns is approximate.
- **KV-counter fallback limiter** — used only if the `[[ratelimits]]` binding is missing; it WRITES to KV (free plan: 1,000 writes/day), so it is dev-only and must not be relied on in production.

## Cloud save final-review notes (Phase 3B, 2026-10-12)

- **Two devices marking a 3rd Greenhouse at once** — the server keeps the first `markGreenhouse` (the cap is enforced in SQL); the second device's Greenhouse vanishes on its next rebase. Accepted trade-off of last-write-wins.
- **Write budgets are tunable guesses** — `MAX_OPS_PER_ACCOUNT_PER_DAY = 1000` and `MAX_ACCOUNTS_CREATED_PER_DAY = 50` (`apps/worker/src/limits.ts`) are sized against the free plan's 100k rows written/day, not measured. The creation cap counts rows in `account_creations` (survives account deletion), not live accounts; accounts accumulate across days, so the real daily ceiling is live accounts x 1,000 ops. Revisit with real usage after the first deploy.
- **Query count** — the budget counters ride in the existing final `UPDATE` of the atomic batch, so a POST still costs at most about 45 queries; account creation gains one `SELECT COUNT(*)` (limiter + count + insert).

## Alerts (Phase 3C, 2026-10-29)

- **No `composter_full` / `no_organic_matter` alert** — `forecastComposter` can report `no_organic_matter`, but the spec lists only fuel alerts and the compost bin cap is unconfirmed (see "composter" above). Nothing fires for it.
- **`composter_fuel_out` key with a missing `last_save`** — `lastSave` 0 yields key `0`, so the alert fires once ever for such a composter until a real save appears.
- **Fuel alerts rely on the API's `last_save` being fresh** — `forecastComposter` projects forward from it. Whether `composter_data.last_save` advances while the player is away from SkyBlock is unverified (spec "Open verification items").
- **Contest dedupe key is `startsAt`** (one alert per contest listing my matching crops), not the spec's `startsAt:cropId`.

## Alerts cron (Phase 3C, 2026-10-29)

- **CPU per cron run vs the 10 ms free limit** — parsing up to 10 stored snapshots (~5 KB each), up to 8 garden normalizations and the derive step are unmeasured. Measure on the first deploy with `wrangler tail`; lower `CRON_BATCH` / `MAX_HYPIXEL_CALLS_PER_RUN` if needed.
- **Lead times below 5 min** — can't fire because the cron runs every 5 minutes, so `data/alerts.json` bounds `leadMinutes` to a minimum of 5.
- **Subrequest counting** — the budget counts every D1 statement in a batch individually, every real `fetch`, and 2 for the contests KV read/write. Whether a `db.batch` counts as one query is unconfirmed (see "D1 batch query counting"); counting each statement is the conservative reading.
- **Discord webhook behaviour** — assumed: 2xx (204) on success without `?wait=true`; 404 for a deleted webhook and 401 for a bad token; 429 with a JSON `retry_after` (seconds, may be fractional) and/or a `Retry-After` header. Confirm against Discord's docs / a real webhook on the first deploy.
- **Hypixel `last_save` freshness** — `composter_data.last_save` drives the fuel forecast; whether it advances while the player is offline from SkyBlock is unverified (spec "Open verification items").
- **Snapshot reuse** — a stored garden under 5 minutes old is reused, so in the 5-minute fast mode visitor alerts can lag up to ~10 minutes. Accepted for the free plan's Hypixel call budget.

## Contest entries (Phase 4)

- `member.jacobs_contest.contests` is keyed `"<sbYear>:<month>_<day>:<CROP_ID>"` with `{ collected, ... }`; the key format was seen on one real profile.
- A contest is assumed to last exactly one SkyBlock day, so the key gives its start time.
- Unverified whether an entry appears while the contest is running or only after it ends.

## Gamification (Phase 4A, 2026-11-10)

- **Garden snapshot freshness** - quests are generated, and API quests verified, only from a snapshot fetched within `freshMinutes` (10) of "now". How old a Hypixel garden/profile response can really be is unverified; a stale snapshot could credit a few minutes of earlier play.
- **Balance numbers are guesses** - quest XP and targets (`data/quests.json`), the Player level curve (`data/player-levels.json`) and achievement XP (`data/achievements.json`) are proposals, not game facts.
- **`discovered_greenhouse_crops` may contain non-mutation ids** - this would affect the mutation-count quests and the 40-mutation achievement tier (the 40 comes from `data/mutations.json`).
- **`dayKey` with a non-zero `resetHour`** - the reset shift is a fixed number of hours, so on a DST-change day the rollover would be an hour off. `resetHour` is 0 today, so this is latent.
- **Progress syncs through Cloud save (Phase 4B)** - quests, achievements and the derived archive are stored in D1 (`quest_log`, `achievements`, migration 0004) via first-write-wins ops; the server accepts days in [today - `keepDays`, today + 1] in the account time zone.
- **`contest_crop` timing** - see "Contest entries (Phase 4)": completion depends on when Hypixel writes `jacobs_contest.contests` entries.

## Progress cloud save (Phase 4B, 2026-11-10)

- **Archive is not uploadable** - the server computes `archive` for rows older than `keepDays`; a local archive (only exists after 14+ days of local-only use) is replaced on first pull/join, so that older history is lost.
- **Cross-device quest race** - first `setQuests` for a day wins; a queued `completeQuest` only applies when the stored kind matches, so it cannot complete another device's different quest.
- **D1 statement count** - the sync pull is a 6-statement batch; each op is one statement (setQuests is one multi-row INSERT). Real D1 behaviour for multi-row VALUES with a reused `?1` is only tested on the node:sqlite stand-in.
- **Time zone change in the same POST** - progress ops in that batch are day-checked against the previously stored time zone; a rejected op is retried by the client.

## Streak alert (Phase 4C, 2026-11-10)

- **Guard credits only garden-based quests** - before alerting, the cron re-checks today's quests against a fresh garden; only garden-based quests (visitors served, garden XP, plot unlock) can be confirmed. Member-based quests (mutations, contest crop) and user-logged waterings are not confirmable by the cron, so a rare false alarm is possible.
- **Needs Cloud save progress** - the alert only works for accounts whose quests exist in Cloud save (quests are created when the app opens).
- **Parameters** - `leadHours` is editable (1..12, default 3, off by default); `minStreak` is fixed at 3 in `data/alerts.json`.
- **Streak-only accounts** - when `streak_risk` is the only enabled rule the cron skips the account (no Hypixel call, no quest reads, one `next_sync_at` write) until `reset - leadHours`, then uses the normal 15 min cadence (`streakOnlyWakeAt` in core).
- **Cost** - each cron tick inside the alert window costs about 4 D1 reads per opted-in account; completions written by the cron count toward the account's daily ops counter and `last_seen_at`.
- **CPU/budget unmeasured on real D1** - measure the extra statements with `wrangler tail`.
