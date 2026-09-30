# VERIFY — open game-fact questions

Each entry: what's uncertain, why, and what would resolve it. Update as items get confirmed or add new ones per CLAUDE.md §9.

## Plots

- **Grid (x, y) coordinates for all 24 plots** — no wiki page, Fandom mirror, or community repo has this. `data/plots.json` has `x: null, y: null` for every plot. Needs a real linked account + `/v2/skyblock/garden` response cross-referenced against in-game screenshots, or a community datamine. Blocks the PixiJS map (Phase 2).
- **Plot ID string format** (`unlocked_plots_ids` from the API) — CLAUDE.md gives `beginner_1`, `intermediate_3` as examples; tier 3/4 names (`advanced`, `expert` in `data/plots.json`) are this plan's guess, not confirmed by any source.
- **Tier C plot 4 cost, and all of tier D's Compost Bundle costs** (plots 13-24) — the wiki confirms tier D exists and is priced in "Compost Bundles" (a different item from raw Compost), reaching roughly 12,103 Compost-equivalent cumulative by plot 24, but no per-plot breakdown was found. `data/plots.json` has `cost: null` for these.

## Crops

- **`apiId`** (Hypixel collection/skill enum name per crop) — no source confirmed these; set to `null` in `data/crops.json` rather than guessed.
- **`tool`** (farming tool per crop) — same; set to `null`.
- **`contestCrop`** — medium confidence: research says all 10 classic crops (Wheat–Nether Wart) are contest crops and the 3 Garden flowers (Sunflower, Moonflower, Wild Rose) are not. Plausible and internally consistent, but re-verify against the actual Jacob's Contest crop list before relying on it for the contests feature (Phase 2/3).

## Pests

- CLAUDE.md's bait table only lists 5 baits / 10 pests. The wiki's Pest page lists 14 pests and 7 baits — Jelly and Moondew catch the 4 Greenhouse-flower pests (Dragonfly, Firefly, Praying Mantis, Lunar Moth), which CLAUDE.md doesn't mention. `data/pests.json` uses the corrected 7-bait table. **CLAUDE.md §2 should be updated to match** — not done as part of this plan since it's the user's spec file.

## Composter

- Exact tier count for the `fuelCap` and `organicMatterCap` upgrades (`data/composter.json` has `maxTier: null` for both) — the wiki confirms the per-tier effect (+30,000 each) and the final cap (850,000 / 790,000) but not how many tiers it takes to reach it, and the arithmetic doesn't divide evenly, implying a nonzero base cap that isn't documented.
- Per-tier purchase costs beyond tier 1-2 (Copper + rare crop amounts) — the wiki describes an "alternating pattern" through tier 25 for `speed`/`multi_drop` but doesn't spell out the full table. Not encoded in `data/composter.json` at all — only the decay/effect formulas `composter.ts` needs.
- Compost bin storage cap (needed to predict "full at…" per CLAUDE.md §2) — not found anywhere. `composter.ts` (Task 5) only predicts fuel/organic-matter depletion for Phase 1, not compost-bin-full.

## Garden API fixture

- `packages/core/fixtures/garden-response.sample.json` (Task 6) is built from a third-party reconstructed OpenAPI spec (`github.com/api-evangelist/hypixel`), not a captured real API response — Hypixel's own interactive docs are a JS-rendered SPA that couldn't be fetched as text. Field _names_ are medium-confidence; nested map key formats (`active_commissions` entry keys, `resources_collected` keys, `crop_upgrade_levels` keys) and all numeric example values are unconfirmed. Swap this fixture for a real captured response once a Hypixel API key + linked account exists (Phase 2).
- The collections/skill XP path inside `/v2/skyblock/profiles` member objects (commonly `members.<uuid>.player_data.experience.SKILL_FARMING` from general knowledge, not fetched this session) — unconfirmed, and not used by any Phase 1 code yet.

## Calendar

- The 12 SkyBlock month names (Early Spring, Spring, ... Late Winter) are from general knowledge, not independently fetched from the wiki this session. Low risk (widely documented, stable content) but flagged in `calendar.ts` with `// VERIFY:`.
