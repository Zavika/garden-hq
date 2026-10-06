# Greenhouse — Design

**Date:** 2026-10-06 · **Status:** implemented on branch `feat/greenhouse` (unmerged); visual check at 380px done with fixture data, not against the live account
**Parent:** CLAUDE.md §2 "Greenhouse", §7 "Greenhouse planner", §8 Phase 4. Pulled forward as its own feature on top of the Phase 2b dashboard.
**Plan:** `docs/superpowers/plans/2026-10-06-greenhouse.md`

## Goal

A Greenhouse page with a 10x10 grid editor per Greenhouse, a live unique-crop yield bonus, and a mutation guide that shows which crop arrangement a chosen mutation needs. Greenhouses appear on the map as glass tiles. Everything the API does not expose (what is planted, watering) is entered by the player and stored locally.

## Facts confirmed by the owner (2026-10-06)

| Question | Answer | Consequence |
|---|---|---|
| Where is the Greenhouse? | A placeable plot **on the 24-plot map**. Owner's is plot 4 = `beginner_3` at cell (2,3) (matches `data/plots.json`). The API does not say which plot is a Greenhouse. | The player marks Greenhouse plots manually in the app. Default none, max 3. A marked plot **is** the Greenhouse; its grid is stored under that plot id. |
| What is `greenhouse_slots`? | **Locked** cells. 88 listed = 100 − 12; the 12 centre cells missing from the list are the **unlocked** soil. | Unlocked = full 10x10 minus `greenhouse_slots`. Locked cells render greyed with "Expand with Ethereal Vines". |
| What are `garden_chips` numbers? | Chip **levels** (Cropshot 5, Quickdraw 2). | Show read-only as "Cropshot Lv 5". |
| How many Greenhouses? | One. | One marked plot in practice; the model still allows up to 3. |

## What the API exposes (captured 2026-10-06)

Raw captures: `apps/worker/garden.raw.json` (`/v2/skyblock/garden`) and `apps/worker/profiles.json` (member data). Both gitignored; both hold real player data and are never committed. The trimmed, anonymised fixtures in the plan are derived from them.

**`/v2/skyblock/garden` → `garden`** — keys: `uuid, unlocked_plots_ids, commission_data, resources_collected, composter_data, garden_experience, active_commissions, selected_barn_skin, crop_upgrade_levels, garden_upgrades, unlocked_barn_skins, last_growth_stage_time, greenhouse_slots`.

| Field | Real value | Use |
|---|---|---|
| `greenhouse_slots` | 88 `{x, z}` cells, x and z in 0..9 | Locked cells of the Greenhouse grid. |
| `last_growth_stage_time` | one epoch-ms value, 36 ms from `composter_data.last_save` | A save timestamp. Not a water/decay timer. Ignored. |
| `garden_upgrades` | `{}` | Unknown shape. Ignored. |

**Profile member data** (`profiles[].members.<uuid>`):

| Path | Real value | Use |
|---|---|---|
| `garden_player_data.discovered_greenhouse_crops` | `ashwreath, shadevine, dead_plant, dustgrain, lonelily` | Mutation discovery progress. These are mutation ids, not base crops. |
| `garden_player_data.analyzed_greenhouse_crops` | `ashwreath, shadevine, dustgrain` | Mutation analysis progress. |
| `player_data.garden_chips` | `{"cropshot":5,"quickdraw":2}` | Chip levels, read-only. |
| `objectives.place_a_greenhouse` | `{status:"COMPLETE", completed_at}` | "Has built a Greenhouse" signal. |
| `garden_player_data.farming_toolkit`, `copper` | — | Not Greenhouse. Ignored. |

**Not exposed:** which plot is a Greenhouse, planted crops, planting times, water level, decay timers, mutation inventory. Searching both payloads for `green|mutat|chip|water|decay|plant` found nothing else. So Greenhouse plots are marked by the player and water is manual.

## Scope

### In
1. **Data:** `data/mutations.json` (40 mutations), `data/greenhouse-crops.json` (bonus rule + placeable crops), every uncertainty in `data/VERIFY.md`.
2. **Core (`packages/core`, pure):** `greenhouse.ts` (grid model, unlocked cells, unique-crop bonus, recipe check, candidate ranking, footprints); `normalizeGarden` gains `greenhouse.lockedCells`; new `normalizeGardenMember`.
3. **Worker:** `GET /api/member?profile=&uuid=` returns the trimmed member subset.
4. **Greenhouse tab:** one grid editor per marked plot, bonus bar, mutation guide, discovery progress, chip levels, manual "I watered it".
5. **Map:** "Mark as Greenhouse" on unlocked plots (max 3); marked plots draw as glass tiles; tapping one opens the Greenhouse.

### Out
D1 sync, notifications (`greenhouse_water`, `greenhouse_decay`), planner integration, achievements, chip editing, crop-analyzer simulation, auto-detecting planted crops, real sprites beyond one original glass tile.

## Architecture

### Data files
- `data/mutations.json`: `{ lastVerified, source, mutations: [...] }`. Each mutation: `id`, `name`, `rarity`, `recipe`, `effects[]`, `growth: { stages | null, medium | null, footprint: 1|2|3 }`, `needsWater: null`, `notes`. In the file `recipe` is `{ kind: "neighbours", ingredients: { id: count } }` or `{ kind: "special", text }`; the loader turns the record into `[{ id, count, placeable }]`, where `placeable` means the id is a known crop, mutation or `dead_plant`. `placeable: false` marks ingredients that are not crops or mutations a player can put in a cell (Ashwreath's "Fire"); they are shown but not checked. The 4 special recipes (Lonelily, Shellfruit, Godseed, Jerryflower) are text only.
- `data/greenhouse-crops.json`: `{ gridSize: 10, unlockGardenLevel: 7, bonusPercentPerUniqueCrop: 3, maxUniqueCrops: 12, crops: [{ id, name, countsForBonus }] }` (`dead_plant` is placeable but does not count for the bonus). The wiki gives the rule but not the list of the 12; the file holds every non-mutation crop the recipes mention (`verified: false`), and the bonus is capped at 12 by rule.
- Source: the mutation table was read from the wiki through a summarising fetch. The plan's data task re-reads the page directly and cross-checks a second source before setting `lastVerified`; a test fails if `lastVerified` is not a date.

### Core
- `GardenState.greenhouse: { lockedCells: { x: number; z: number }[] }` (empty when missing).
- `normalizeGardenMember(raw)` → `{ discoveredMutations, analyzedMutations, chips: Record<string, number>, hasGreenhouse }`; all optional.
- `greenhouse.ts`: `cellKey(x,z)`; `unlockedCellKeys(lockedCells)`; `uniqueCropBonus(cells, unlocked)`; `recipeStatus(...)`; `rankCandidateCells(...)`; `extraCellsNeeded(mutation, unlocked)` = the minimum number of extra cells that must be unlocked before the mutation can be built (locked cells in its footprint block plus the shortfall of unlocked ring cells, best anchor; 0 = fits). The grid size comes from `data/greenhouse-crops.json` (`GREENHOUSE_GRID_SIZE`, because core's `GRID_SIZE` is already the 5x5 map). Multi-cell mutations are placed as a single cell; the footprint is only used for the fit check. Locked cells hold nothing and never count as neighbours. A recipe's neighbours are the ring of cells around the mutation's footprint (8 / 12 / 16 for 1x1 / 2x2 / 3x3). This is inferred, not stated by the wiki: 27 of the 36 neighbour recipes have ingredient counts summing to exactly the ring size for their footprint and none exceeds it. Logged in VERIFY.

### Worker
`GET /api/member?profile=&uuid=` calls the existing `profiles(uuid)` Hypixel method (the singular `/v2/skyblock/profile` endpoint is unverified, so it is not used), selects the profile whose `profile_id` equals `profile` and the member keyed by `uuid` without dashes, and returns `normalizeGardenMember` of it. Same per-IP limit, same 60 s KV cache pattern as `/api/garden`, `Cache-Control: no-store`. Missing profile or member → `no_garden`.

### Web
- **State:** extend `StoredData` in `apps/web/src/state/storage.ts` (key stays `garden-hq:v1`; the new field defaults to `{}`, so old saves load). `greenhouses: Record<plotId, { cells: Record<"x,z", cropId>; lastWateredAt: number | null }>`. Existence of the key = plot is marked. Max 3.
- **Greenhouse tab** (`/greenhouse`, between Home and Contests). Zero marked plots → empty state pointing at the map. One section per marked plot, labelled with the plot ("Plot 4 (beginner_3)").
  - **Editor:** DOM CSS grid (not Pixi: hundreds of taps, keyboard and screen-reader access), `image-rendering: pixelated`, 32 px cells so the grid is 320 px and fits 380 px. Locked cells are disabled and greyed with the label "Expand with Ethereal Vines". A palette (crops, plus mutations for placing results) sits underneath: tap a palette entry, then tap cells.
  - **Bonus bar:** "6/12 unique crops: +18%", from core.
  - **Mutation guide:** pick a mutation, see its recipe as ingredient chips with counts; candidate empty cells are highlighted (green = recipe satisfied, amber = missing N). Special recipes show text. A fixed note says the adjacency rule is unverified. If the unlocked area is too small for a recipe the guide shows "Needs N more unlocked cells" (N from `extraCellsNeeded`), which doubles as an expansion goal; on the owner's 12 cells Coalroot needs 1, Noctilume 4, Snoozling 13.
  - **Progress and chips:** each mutation shows discovered/analysed from the API; chip levels shown read-only.
  - **Water:** a per-Greenhouse "I watered it" button stores `lastWateredAt` and shows "watered X ago". No countdown or decay prediction, because no source gives numbers.
- **Map:** `AssignCropSheet` gains a "Mark as Greenhouse" toggle for unlocked plots; unmarking asks a second tap ("Remove Greenhouse — clears its grid"). `buildMapViewModel` gets `greenhouses: Set<string>`; `PlotTile.greenhouse: boolean`; `MapScene.plotGraphic` draws a glass tile. Tapping a marked plot offers "Open Greenhouse".

## Build slices
1. Data + core + fixtures (no UI).
2. Worker route, API client, query hook.
3. Storage + Greenhouse tab: grid editor and bonus.
4. Mutation guide, progress, chips.
5. Map marks and glass tiles.
6. Manual watered button.

## Risks
- **Recipe geometry:** wiki gives neighbour *counts* only. The 8-neighbour, extra-neighbours-allowed assumption may be wrong, so the guide ships labelled "unverified".
- With 12 unlocked cells many recipes cannot fit yet; the guide shows how many more cells to unlock rather than implying a layout works.
- Mutation table drift since 2026-08-20; `lastVerified` is the only safeguard.
- A second Hypixel call per sync spends the shared 10 req/min budget; the `/api/member` query refetches every 5 minutes, not every minute.

## Still unverified (in `data/VERIFY.md`)
Adjacency rule; special recipes; the list of the 12 unique crops and whether the bonus is per Greenhouse; whether the locked-cell list applies to every Greenhouse when a player owns several (it is applied to all marked plots); mutation id spelling beyond the five seen; `needsWater`; whether "Expand with Ethereal Vines" is the right unlock cost for cells (wiki ties Ethereal Vines to extra Greenhouse plots).
