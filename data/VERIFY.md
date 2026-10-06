# VERIFY — open game-fact questions

Each entry: what's uncertain, why, and what would resolve it. Update as items get confirmed or add new ones per CLAUDE.md §9.

## Plots

- **Tier unlock levels** (garden level 1 / 3 / 5 / 7 for beginner / intermediate / advanced / expert) — from CLAUDE.md, not checked against a live account. Plot ids, plot numbers, grid cells and cost ladders come from EliteFarmers/Website `plots.ts` (user-supplied); only the id format (`advanced_5`) and the first 8 plots were seen on a real account, so the advanced/expert plot numbers and ladder rungs beyond that are not independently checked.

- **Plot adjacency rule** — a locked plot is shown as buyable only if its tier is unlocked by garden level AND it shares an edge (not a corner) with the Barn or an owned plot (`plotAvailability` in `plots.ts`). Derived from one real account (owned beginner/intermediate + `advanced_5` -> buyable 9-18, 20, 23; unreachable 21, 22, 24), not a wiki page; confirm the in-game purchase rule.

## Crops

- **`apiId`** (Hypixel collection/skill enum name per crop) — no source confirmed these; set to `null` in `data/crops.json` rather than guessed.
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
