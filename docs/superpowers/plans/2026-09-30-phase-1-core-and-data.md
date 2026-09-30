# Phase 1 — Core + Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the curated game-data files (`data/crops.json`, `data/pests.json`, `data/garden-levels.json`, `data/plots.json`, `data/composter.json`) and the four Phase 1 `packages/core` modules (`calendar.ts`, `garden.ts`, `plots.ts`, `composter.ts`) with vitest coverage, per CLAUDE.md §8 "Phase 1 — core + data."

**Architecture:** Same as Phase 0 — pure TypeScript in `packages/core`, no fetch/DOM, consumed as source by both apps (not exercised by either app in this phase; Phase 2 wires them in). Data lives in versioned JSON under `data/`, imported directly by the `core` modules that need it (`resolveJsonModule` is already on in `tsconfig.base.json`). `garden.ts` gets a sample API response fixture in `packages/core/fixtures/` instead of a live call, per CLAUDE.md §9 ("never a live API call in tests").

**Tech Stack:** Same as Phase 0 (TypeScript strict, Vitest, pnpm workspaces) — no new tooling.

**Spec:** `CLAUDE.md` (§2 "Game facts," §5 "Repo layout," §8 "Phase 1," §9 "Conventions") plus two rounds of wiki/API-schema research done this session (findings folded into `data/VERIFY.md`, Task 1).

## Global Constraints

- TypeScript strict everywhere; **no `any`** in `packages/core` (already enforced by `eslint.config.js` from Phase 0).
- Game numbers come from `/data`, never magic numbers in code (CLAUDE.md §9).
- Every `packages/core` function gets a vitest test; never a live API call in tests (CLAUDE.md §9).
- Every API field `garden.ts` reads is optional — handle missing data defensively (CLAUDE.md §9).
- **Do not guess silently.** Where a game fact is genuinely unconfirmed, encode it as `null` (JSON) or add a `// VERIFY:` comment (TypeScript) and list it in `data/VERIFY.md` (CLAUDE.md §9). Task 1 seeds this file with everything this session's research couldn't pin down — do not remove entries from it without a source.

## What this session's research already confirmed (safe to hardcode, no `// VERIFY:` needed)

- SkyBlock epoch `1560275700000`ms, 20-real-minute day, 372-day/124-real-hour year — confirmed word-for-word against `hypixelskyblock.minecraft.wiki/wiki/Time_Systems`.
- Garden XP table, crop unlock levels, plot tier-A/B cost ladder, composter base rate (10 min/Compost, 4000 Organic Matter + 2000 Fuel) — already precise in CLAUDE.md §2, not re-litigated.
- Composter `speed` (+20%/tier, cap +500%) and `multi_drop` (+3%/tier, cap 75%) formulas, and `cost_reduction` (-1%/tier, cap 25%) — confirmed against the Composter wiki page. Cross-checked: at max `speed`+`multi_drop`, throughput comes out to exactly the wiki's stated "~63 Compost/hour" (6 base/hr × 6x speed × 1.75x multi-drop = 63) — this is asserted as a test case in Task 5.
- **Correction to CLAUDE.md's pest/bait table**: it lists 5 baits → 10 pests. The wiki's Pest page has **14 pests and 7 baits** — Jelly and Moondew catch the 4 Greenhouse-flower pests (Dragonfly, Firefly, Praying Mantis, Lunar Moth) that CLAUDE.md omits entirely. `data/pests.json` (Task 3) uses the corrected 7-bait table; CLAUDE.md §2 itself is left for the user to update.

## What's still unconfirmed (goes into `data/VERIFY.md` as `null` / flagged, not guessed)

- The 24-plot (x, y) grid layout — no source anywhere has it. Deferred to Phase 2 (needs a real API response or screenshots).
- Plot ID strings for tiers 3/4 (`advanced_*`, `expert_*` are this plan's guess at naming, following CLAUDE.md's `beginner_1`/`intermediate_3` pattern) and the exact per-plot costs for tier-C plot 4 and all of tier D ("Compost Bundles").
- Crop `apiId` and `tool` fields — no source found; left `null`.
- `fuel_cap`/`organic_matter_cap` upgrade tier counts, and per-tier purchase costs for every upgrade beyond tier 1-2.
- The `garden.ts` fixture's exact field names (built from a third-party reconstructed OpenAPI spec, not a captured real response, and not Hypixel's own docs which are a JS-rendered SPA).

---

### Task 1: `data/VERIFY.md` and `data/garden-levels.json`

**Files:**
- Create: `data/VERIFY.md`
- Create: `data/garden-levels.json`
- Test: `packages/core/src/data-integrity.test.ts`

**Interfaces:**
- Produces: `data/garden-levels.json` — a 15-entry array `{ level: number; xpRequired: number; cumulativeXp: number }[]`, consumed by `garden.ts` (Task 6). `data-integrity.test.ts` will grow across Tasks 1, 3, 4, 5 as each data file lands — this task creates it.

- [x] **Step 1: Write `data/VERIFY.md`**

```markdown
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

- `packages/core/fixtures/garden-response.sample.json` (Task 6) is built from a third-party reconstructed OpenAPI spec (`github.com/api-evangelist/hypixel`), not a captured real API response — Hypixel's own interactive docs are a JS-rendered SPA that couldn't be fetched as text. Field *names* are medium-confidence; nested map key formats (`active_commissions` entry keys, `resources_collected` keys, `crop_upgrade_levels` keys) and all numeric example values are unconfirmed. Swap this fixture for a real captured response once a Hypixel API key + linked account exists (Phase 2).
- The collections/skill XP path inside `/v2/skyblock/profiles` member objects (commonly `members.<uuid>.player_data.experience.SKILL_FARMING` from general knowledge, not fetched this session) — unconfirmed, and not used by any Phase 1 code yet.

## Calendar

- The 12 SkyBlock month names (Early Spring, Spring, ... Late Winter) are from general knowledge, not independently fetched from the wiki this session. Low risk (widely documented, stable content) but flagged in `calendar.ts` with `// VERIFY:`.
```

- [x] **Step 2: Write `data/garden-levels.json`**

```json
[
  { "level": 1, "xpRequired": 0, "cumulativeXp": 0 },
  { "level": 2, "xpRequired": 70, "cumulativeXp": 70 },
  { "level": 3, "xpRequired": 70, "cumulativeXp": 140 },
  { "level": 4, "xpRequired": 140, "cumulativeXp": 280 },
  { "level": 5, "xpRequired": 240, "cumulativeXp": 520 },
  { "level": 6, "xpRequired": 600, "cumulativeXp": 1120 },
  { "level": 7, "xpRequired": 1500, "cumulativeXp": 2620 },
  { "level": 8, "xpRequired": 2000, "cumulativeXp": 4620 },
  { "level": 9, "xpRequired": 2500, "cumulativeXp": 7120 },
  { "level": 10, "xpRequired": 3000, "cumulativeXp": 10120 },
  { "level": 11, "xpRequired": 10000, "cumulativeXp": 20120 },
  { "level": 12, "xpRequired": 10000, "cumulativeXp": 30120 },
  { "level": 13, "xpRequired": 10000, "cumulativeXp": 40120 },
  { "level": 14, "xpRequired": 10000, "cumulativeXp": 50120 },
  { "level": 15, "xpRequired": 10000, "cumulativeXp": 60120 }
]
```

- [x] **Step 3: Write the failing test — `packages/core/src/data-integrity.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import gardenLevels from "../../../data/garden-levels.json";

describe("data/garden-levels.json", () => {
  it("has 15 levels with correct cumulative XP", () => {
    expect(gardenLevels).toHaveLength(15);

    let running = 0;
    for (const entry of gardenLevels) {
      running += entry.xpRequired;
      expect(entry.cumulativeXp).toBe(running);
    }
    expect(gardenLevels.at(-1)?.cumulativeXp).toBe(60120);
  });
});
```

- [x] **Step 4: Confirm it passes (there's nothing to fail here — the data and test are written together; this step just proves the JSON parses and the math checks out)**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 1 test.

- [x] **Step 5: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [x] **Step 6: Commit**

```bash
git add data/VERIFY.md data/garden-levels.json packages/core/src/data-integrity.test.ts
git commit -m "chore(data): seed VERIFY.md and add garden-levels.json"
```

---

### Task 2: `types.ts` and `calendar.ts`

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/calendar.test.ts`
- Create: `packages/core/src/calendar.ts`

**Interfaces:**
- Produces: `GardenState`, `ComposterState`, `ComposterUpgrades` (from `types.ts`, consumed by `garden.ts` and `composter.ts` in later tasks); `skyblockDate(date: Date): SkyblockDate` and `isDaytime(date: Date): boolean` (from `calendar.ts`).

- [x] **Step 1: Write `packages/core/src/types.ts`**

```ts
export interface ComposterUpgrades {
  speed: number;
  multiDrop: number;
  fuelCap: number;
  organicMatterCap: number;
  costReduction: number;
}

export interface ComposterState {
  organicMatter: number;
  fuel: number;
  compostUnits: number;
  lastSave: number;
  upgrades: ComposterUpgrades;
}

export interface GardenState {
  level: number;
  experience: number;
  unlockedPlotIds: string[];
  composter: ComposterState;
  visitorsServedTotal: number;
}
```

- [x] **Step 2: Write the failing test — `packages/core/src/calendar.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { SKYBLOCK_EPOCH_MS, isDaytime, skyblockDate } from "./calendar";

describe("skyblockDate", () => {
  it("is year 1, month 1 (Early Spring), day 1 at the epoch", () => {
    expect(skyblockDate(new Date(SKYBLOCK_EPOCH_MS))).toEqual({
      year: 1,
      month: 1,
      monthName: "Early Spring",
      day: 1,
    });
  });

  it("advances month/day 35 SkyBlock days later", () => {
    const msPerDay = 20 * 60 * 1000;
    const date = new Date(SKYBLOCK_EPOCH_MS + 35 * msPerDay);
    expect(skyblockDate(date)).toEqual({
      year: 1,
      month: 2,
      monthName: "Spring",
      day: 5,
    });
  });
});

describe("isDaytime", () => {
  it("is daytime at the start of a SkyBlock day", () => {
    expect(isDaytime(new Date(SKYBLOCK_EPOCH_MS))).toBe(true);
  });

  it("is nighttime at the halfway point of a SkyBlock day", () => {
    const msPerDay = 20 * 60 * 1000;
    expect(isDaytime(new Date(SKYBLOCK_EPOCH_MS + msPerDay / 2))).toBe(false);
  });
});
```

- [x] **Step 3: Run it and confirm it fails**

```bash
pnpm --filter @garden-hq/core test
```

Expected: FAIL — `./calendar` cannot be resolved.

- [x] **Step 4: Write `packages/core/src/calendar.ts`**

```ts
export const SKYBLOCK_EPOCH_MS = 1560275700000;
export const MS_PER_SKYBLOCK_DAY = 20 * 60 * 1000;
export const DAYS_PER_MONTH = 31;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

// VERIFY: month names are from general SkyBlock knowledge, not independently
// fetched from the wiki this session -- re-check against
// hypixelskyblock.minecraft.wiki before relying on this list for anything
// player-facing (see data/VERIFY.md).
export const MONTH_NAMES = [
  "Early Spring",
  "Spring",
  "Late Spring",
  "Early Summer",
  "Summer",
  "Late Summer",
  "Early Autumn",
  "Autumn",
  "Late Autumn",
  "Early Winter",
  "Winter",
  "Late Winter",
] as const;

export interface SkyblockDate {
  year: number;
  month: number;
  monthName: string;
  day: number;
}

export function skyblockDate(date: Date): SkyblockDate {
  const elapsedMs = date.getTime() - SKYBLOCK_EPOCH_MS;
  const elapsedDays = Math.floor(elapsedMs / MS_PER_SKYBLOCK_DAY);
  const year = Math.floor(elapsedDays / DAYS_PER_YEAR) + 1;
  const dayOfYear =
    ((elapsedDays % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
  const day = (dayOfYear % DAYS_PER_MONTH) + 1;

  return {
    year,
    month,
    monthName: MONTH_NAMES[month - 1] ?? "Unknown",
    day,
  };
}

// VERIFY: day/night is assumed to be an even 50/50 split within the
// 20-minute SkyBlock day, aligned to the epoch. Vanilla Minecraft's exact
// dawn/dusk tick boundaries may differ slightly -- re-check if in-game
// timing drifts from this (see data/VERIFY.md).
export function isDaytime(date: Date): boolean {
  const elapsedMs = date.getTime() - SKYBLOCK_EPOCH_MS;
  const msIntoDay =
    ((elapsedMs % MS_PER_SKYBLOCK_DAY) + MS_PER_SKYBLOCK_DAY) %
    MS_PER_SKYBLOCK_DAY;
  return msIntoDay < MS_PER_SKYBLOCK_DAY / 2;
}
```

- [x] **Step 5: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 5 tests (1 from Task 1 + 4 here).

- [x] **Step 6: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [x] **Step 7: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/calendar.ts packages/core/src/calendar.test.ts
git commit -m "feat(core): add types.ts and calendar.ts"
```

---

### Task 3: `data/crops.json` and `data/pests.json`

**Files:**
- Create: `data/pests.json`
- Create: `data/crops.json`
- Modify: `packages/core/src/data-integrity.test.ts`

**Interfaces:**
- Produces: `data/crops.json` (13 entries) and `data/pests.json` (14 entries) — not consumed by any Phase 1 `core` module yet (no `crops.ts`/`pests.ts` in this phase's build order), but validated for internal consistency by `data-integrity.test.ts`. Later phases (planner, pest warnings) will import these directly.

- [x] **Step 1: Write `data/pests.json`**

```json
[
  { "id": "fly", "name": "Fly", "bait": "dung" },
  { "id": "cricket", "name": "Cricket", "bait": "honey_jar" },
  { "id": "locust", "name": "Locust", "bait": "plant_matter" },
  { "id": "rat", "name": "Rat", "bait": "tasty_cheese" },
  { "id": "mosquito", "name": "Mosquito", "bait": "compost" },
  { "id": "earthworm", "name": "Earthworm", "bait": "compost" },
  { "id": "mite", "name": "Mite", "bait": "tasty_cheese" },
  { "id": "moth", "name": "Moth", "bait": "honey_jar" },
  { "id": "slug", "name": "Slug", "bait": "plant_matter" },
  { "id": "beetle", "name": "Beetle", "bait": "dung" },
  { "id": "dragonfly", "name": "Dragonfly", "bait": "jelly" },
  { "id": "firefly", "name": "Firefly", "bait": "jelly" },
  { "id": "praying_mantis", "name": "Praying Mantis", "bait": "jelly" },
  { "id": "lunar_moth", "name": "Lunar Moth", "bait": "moondew" }
]
```

- [x] **Step 2: Write `data/crops.json`**

```json
[
  { "id": "wheat", "name": "Wheat", "unlockLevel": 1, "baseDrop": "wheat", "pest": "fly", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "carrot", "name": "Carrot", "unlockLevel": 2, "baseDrop": "carrot", "pest": "cricket", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "potato", "name": "Potato", "unlockLevel": 3, "baseDrop": "potato", "pest": "locust", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "pumpkin", "name": "Pumpkin", "unlockLevel": 4, "baseDrop": "pumpkin", "pest": "rat", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "sugar_cane", "name": "Sugar Cane", "unlockLevel": 5, "baseDrop": "sugar_cane", "pest": "mosquito", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "melon", "name": "Melon", "unlockLevel": 6, "baseDrop": "melon", "pest": "earthworm", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "cactus", "name": "Cactus", "unlockLevel": 7, "baseDrop": "cactus", "pest": "mite", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "cocoa_beans", "name": "Cocoa Beans", "unlockLevel": 8, "baseDrop": "cocoa_beans", "pest": "moth", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "mushroom", "name": "Mushroom", "unlockLevel": 9, "baseDrop": "mushroom", "pest": "slug", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "nether_wart", "name": "Nether Wart", "unlockLevel": 10, "baseDrop": "nether_wart", "pest": "beetle", "tool": null, "apiId": null, "contestCrop": true },
  { "id": "sunflower", "name": "Sunflower", "unlockLevel": 11, "baseDrop": "sunflower", "pest": "dragonfly", "tool": null, "apiId": null, "contestCrop": false },
  { "id": "moonflower", "name": "Moonflower", "unlockLevel": 11, "baseDrop": "moonflower", "pest": "firefly", "tool": null, "apiId": null, "contestCrop": false },
  { "id": "wild_rose", "name": "Wild Rose", "unlockLevel": 12, "baseDrop": "wild_rose", "pest": "praying_mantis", "tool": null, "apiId": null, "contestCrop": false }
]
```

- [x] **Step 3: Write the failing test — extend `packages/core/src/data-integrity.test.ts`**

Add to the existing file (do not remove the `garden-levels.json` describe block from Task 1):

```ts
import crops from "../../../data/crops.json";
import pests from "../../../data/pests.json";

describe("data/pests.json", () => {
  it("has 14 pests across 7 distinct baits", () => {
    expect(pests).toHaveLength(14);
    const baits = new Set(pests.map((pest) => pest.bait));
    expect(baits.size).toBe(7);
  });
});

describe("data/crops.json", () => {
  it("has 13 crops, each referencing a real pest id", () => {
    expect(crops).toHaveLength(13);

    const pestIds = new Set(pests.map((pest) => pest.id));
    for (const crop of crops) {
      expect(pestIds.has(crop.pest)).toBe(true);
    }
  });
});
```

- [x] **Step 4: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 7 tests (5 from Task 2 + 2 here).

- [x] **Step 5: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [x] **Step 6: Commit**

```bash
git add data/crops.json data/pests.json packages/core/src/data-integrity.test.ts
git commit -m "chore(data): add crops.json and pests.json (corrected 7-bait pest table)"
```

---

### Task 4: `data/plots.json` and `plots.ts`

**Files:**
- Create: `data/plots.json`
- Create: `packages/core/src/plots.test.ts`
- Create: `packages/core/src/plots.ts`
- Modify: `packages/core/src/data-integrity.test.ts`

**Interfaces:**
- Produces: `PlotDefinition` interface, `ALL_PLOTS: PlotDefinition[]`, `getPlot(id: string): PlotDefinition | undefined`, `cheapestNextPlot(unlockedIds: string[], gardenLevel: number): PlotDefinition | undefined` — consumed by later phases' planner (`cheapest next plot unlock`, CLAUDE.md §7).

- [x] **Step 1: Write `data/plots.json`**

```json
{
  "tiers": [
    {
      "id": "beginner",
      "unlockLevel": 1,
      "plots": [
        { "id": "beginner_1", "cost": 1, "x": null, "y": null },
        { "id": "beginner_2", "cost": 2, "x": null, "y": null },
        { "id": "beginner_3", "cost": 4, "x": null, "y": null },
        { "id": "beginner_4", "cost": 8, "x": null, "y": null }
      ]
    },
    {
      "id": "intermediate",
      "unlockLevel": 3,
      "plots": [
        { "id": "intermediate_1", "cost": 16, "x": null, "y": null },
        { "id": "intermediate_2", "cost": 24, "x": null, "y": null },
        { "id": "intermediate_3", "cost": 32, "x": null, "y": null },
        { "id": "intermediate_4", "cost": 48, "x": null, "y": null }
      ]
    },
    {
      "id": "advanced",
      "unlockLevel": 5,
      "plots": [
        { "id": "advanced_1", "cost": 64, "x": null, "y": null },
        { "id": "advanced_2", "cost": 96, "x": null, "y": null },
        { "id": "advanced_3", "cost": 128, "x": null, "y": null },
        { "id": "advanced_4", "cost": null, "x": null, "y": null }
      ]
    },
    {
      "id": "expert",
      "unlockLevel": 7,
      "plots": [
        { "id": "expert_1", "cost": null, "x": null, "y": null },
        { "id": "expert_2", "cost": null, "x": null, "y": null },
        { "id": "expert_3", "cost": null, "x": null, "y": null },
        { "id": "expert_4", "cost": null, "x": null, "y": null },
        { "id": "expert_5", "cost": null, "x": null, "y": null },
        { "id": "expert_6", "cost": null, "x": null, "y": null },
        { "id": "expert_7", "cost": null, "x": null, "y": null },
        { "id": "expert_8", "cost": null, "x": null, "y": null },
        { "id": "expert_9", "cost": null, "x": null, "y": null },
        { "id": "expert_10", "cost": null, "x": null, "y": null },
        { "id": "expert_11", "cost": null, "x": null, "y": null },
        { "id": "expert_12", "cost": null, "x": null, "y": null }
      ]
    }
  ]
}
```

- [x] **Step 2: Write the failing test — `packages/core/src/plots.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ALL_PLOTS, cheapestNextPlot, getPlot } from "./plots";

describe("ALL_PLOTS", () => {
  it("has 24 plots", () => {
    expect(ALL_PLOTS).toHaveLength(24);
  });
});

describe("getPlot", () => {
  it("finds a plot by id", () => {
    expect(getPlot("beginner_1")?.cost).toBe(1);
  });

  it("returns undefined for an unknown id", () => {
    expect(getPlot("nonexistent")).toBeUndefined();
  });
});

describe("cheapestNextPlot", () => {
  it("picks the cheapest unlocked-tier plot when nothing is owned", () => {
    expect(cheapestNextPlot([], 1)?.id).toBe("beginner_1");
  });

  it("skips already-unlocked plots", () => {
    expect(cheapestNextPlot(["beginner_1"], 1)?.id).toBe("beginner_2");
  });

  it("crosses into a higher tier once the cheaper tier is fully unlocked", () => {
    const owned = ["beginner_1", "beginner_2", "beginner_3", "beginner_4"];
    expect(cheapestNextPlot(owned, 5)?.id).toBe("intermediate_1");
  });

  it("ignores plots with an unknown (null) cost", () => {
    const owned = [
      "beginner_1",
      "beginner_2",
      "beginner_3",
      "beginner_4",
      "intermediate_1",
      "intermediate_2",
      "intermediate_3",
      "intermediate_4",
      "advanced_1",
      "advanced_2",
      "advanced_3",
    ];
    // advanced_4's cost is null; only expert plots (also null) remain --
    // nothing with a known cost is left to recommend.
    expect(cheapestNextPlot(owned, 7)).toBeUndefined();
  });

  it("returns undefined when the garden level is too low for any tier", () => {
    expect(cheapestNextPlot([], 0)).toBeUndefined();
  });
});
```

- [x] **Step 3: Run it and confirm it fails**

```bash
pnpm --filter @garden-hq/core test
```

Expected: FAIL — `./plots` cannot be resolved.

- [x] **Step 4: Write `packages/core/src/plots.ts`**

```ts
import plotsData from "../../../data/plots.json";

export interface PlotDefinition {
  id: string;
  tierId: string;
  unlockLevel: number;
  cost: number | null;
  x: number | null;
  y: number | null;
}

interface PlotsJsonPlot {
  id: string;
  cost: number | null;
  x: number | null;
  y: number | null;
}

interface PlotsJsonTier {
  id: string;
  unlockLevel: number;
  plots: PlotsJsonPlot[];
}

const TIERS = (plotsData as { tiers: PlotsJsonTier[] }).tiers;

export const ALL_PLOTS: PlotDefinition[] = TIERS.flatMap((tier) =>
  tier.plots.map((plot) => ({
    id: plot.id,
    tierId: tier.id,
    unlockLevel: tier.unlockLevel,
    cost: plot.cost,
    x: plot.x,
    y: plot.y,
  })),
);

export function getPlot(id: string): PlotDefinition | undefined {
  return ALL_PLOTS.find((plot) => plot.id === id);
}

export function cheapestNextPlot(
  unlockedIds: string[],
  gardenLevel: number,
): PlotDefinition | undefined {
  const unlocked = new Set(unlockedIds);

  const candidates = ALL_PLOTS.filter(
    (plot) =>
      !unlocked.has(plot.id) &&
      plot.unlockLevel <= gardenLevel &&
      plot.cost !== null,
  );

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((cheapest, plot) =>
    (plot.cost as number) < (cheapest.cost as number) ? plot : cheapest,
  );
}
```

- [x] **Step 5: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 15 tests (7 from Task 3 + 8 here).

- [x] **Step 6: Extend `data-integrity.test.ts` with a plots check**

Add to the existing file:

```ts
import plots from "../../../data/plots.json";

describe("data/plots.json", () => {
  it("has 4 tiers totaling 24 plots", () => {
    expect(plots.tiers).toHaveLength(4);
    const total = plots.tiers.reduce((sum, tier) => sum + tier.plots.length, 0);
    expect(total).toBe(24);
  });
});
```

- [x] **Step 7: Run it and confirm it still passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 16 tests.

- [x] **Step 8: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [x] **Step 9: Commit**

```bash
git add data/plots.json packages/core/src/plots.ts packages/core/src/plots.test.ts packages/core/src/data-integrity.test.ts
git commit -m "feat(core): add plots.json and plots.ts"
```

---

### Task 5: `data/composter.json` and `composter.ts`

**Files:**
- Create: `data/composter.json`
- Create: `packages/core/src/composter.test.ts`
- Create: `packages/core/src/composter.ts`
- Modify: `packages/core/src/data-integrity.test.ts`

**Interfaces:**
- Consumes: `ComposterState`, `ComposterUpgrades` from `types.ts` (Task 2).
- Produces: `compostPerHour(upgrades)`, `organicMatterPerHour(upgrades)`, `fuelPerHour(upgrades)`, `forecastComposter(state, nowMs): ComposterForecast` — consumed by the planner in a later phase ("composter out of fuel / full," CLAUDE.md §7) and the map's composter gauge.

- [x] **Step 1: Write `data/composter.json`**

```json
{
  "baseRate": {
    "minutesPerCompost": 10,
    "organicMatterPerCompost": 4000,
    "fuelPerCompost": 2000
  },
  "upgrades": {
    "speed": { "effectPerTier": 0.2, "maxEffect": 5.0, "maxTier": 25 },
    "multiDrop": { "effectPerTier": 0.03, "maxEffect": 0.75, "maxTier": 25 },
    "fuelCap": { "effectPerTier": 30000, "maxEffect": 850000, "maxTier": null },
    "organicMatterCap": { "effectPerTier": 30000, "maxEffect": 790000, "maxTier": null },
    "costReduction": { "effectPerTier": 0.01, "maxEffect": 0.25, "maxTier": 25 }
  }
}
```

- [x] **Step 2: Write the failing test — `packages/core/src/composter.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compostPerHour, forecastComposter } from "./composter";
import type { ComposterState } from "./types";

const NO_UPGRADES = {
  speed: 0,
  multiDrop: 0,
  fuelCap: 0,
  organicMatterCap: 0,
  costReduction: 0,
};

describe("compostPerHour", () => {
  it("produces 6/hour at the base rate (1 per 10 minutes)", () => {
    expect(compostPerHour(NO_UPGRADES)).toBe(6);
  });

  it("produces 63/hour at max speed and multi-drop tiers", () => {
    const maxed = { ...NO_UPGRADES, speed: 25, multiDrop: 25 };
    expect(compostPerHour(maxed)).toBeCloseTo(63, 5);
  });

  it("caps the effect beyond the max tier", () => {
    const overMaxed = { ...NO_UPGRADES, speed: 999, multiDrop: 999 };
    const maxed = { ...NO_UPGRADES, speed: 25, multiDrop: 25 };
    expect(compostPerHour(overMaxed)).toBeCloseTo(compostPerHour(maxed), 5);
  });
});

describe("forecastComposter", () => {
  it("depletes fuel after exactly 10 minutes at the base rate with 2000 fuel", () => {
    const state: ComposterState = {
      organicMatter: 1_000_000,
      fuel: 2000,
      compostUnits: 0,
      lastSave: 0,
      upgrades: NO_UPGRADES,
    };

    const tenMinutesMs = 10 * 60 * 1000;
    expect(state.fuel > 0).toBe(true);
    expect(forecastComposter(state, tenMinutesMs).fuel).toBeCloseTo(0, 5);
    expect(forecastComposter(state, 0).fuelDepletesAt).toBe(tenMinutesMs);
  });

  it("never goes negative once fuel is fully depleted", () => {
    const state: ComposterState = {
      organicMatter: 1_000_000,
      fuel: 2000,
      compostUnits: 0,
      lastSave: 0,
      upgrades: NO_UPGRADES,
    };

    const oneHourMs = 60 * 60 * 1000;
    expect(forecastComposter(state, oneHourMs).fuel).toBe(0);
  });
});
```

- [x] **Step 3: Run it and confirm it fails**

```bash
pnpm --filter @garden-hq/core test
```

Expected: FAIL — `./composter` cannot be resolved.

- [x] **Step 4: Write `packages/core/src/composter.ts`**

```ts
import composterData from "../../../data/composter.json";
import type { ComposterState, ComposterUpgrades } from "./types";

interface UpgradeCurve {
  effectPerTier: number;
  maxEffect: number;
  maxTier: number | null;
}

interface ComposterData {
  baseRate: {
    minutesPerCompost: number;
    organicMatterPerCompost: number;
    fuelPerCompost: number;
  };
  upgrades: {
    speed: UpgradeCurve;
    multiDrop: UpgradeCurve;
    fuelCap: UpgradeCurve;
    organicMatterCap: UpgradeCurve;
    costReduction: UpgradeCurve;
  };
}

const DATA = composterData as ComposterData;

function effectAtTier(curve: UpgradeCurve, tier: number): number {
  return Math.min(tier * curve.effectPerTier, curve.maxEffect);
}

export function compostPerHour(upgrades: ComposterUpgrades): number {
  const baseline = 60 / DATA.baseRate.minutesPerCompost;
  const speedMultiplier = 1 + effectAtTier(DATA.upgrades.speed, upgrades.speed);
  const multiDropBonus =
    1 + effectAtTier(DATA.upgrades.multiDrop, upgrades.multiDrop);

  return baseline * speedMultiplier * multiDropBonus;
}

export function organicMatterPerHour(upgrades: ComposterUpgrades): number {
  return compostPerHour(upgrades) * DATA.baseRate.organicMatterPerCompost;
}

export function fuelPerHour(upgrades: ComposterUpgrades): number {
  return compostPerHour(upgrades) * DATA.baseRate.fuelPerCompost;
}

export interface ComposterForecast {
  organicMatter: number;
  fuel: number;
  fuelDepletesAt: number | null;
  organicMatterDepletesAt: number | null;
}

// VERIFY: this only forecasts fuel/organic-matter depletion, not the
// compost bin filling up -- the storage cap needed for a "full at" style
// prediction isn't confirmed anywhere (see data/VERIFY.md).
export function forecastComposter(
  state: ComposterState,
  nowMs: number,
): ComposterForecast {
  const elapsedHours = Math.max(0, nowMs - state.lastSave) / (60 * 60 * 1000);
  const fuelUsedPerHour = fuelPerHour(state.upgrades);
  const organicMatterUsedPerHour = organicMatterPerHour(state.upgrades);

  const fuel = Math.max(0, state.fuel - fuelUsedPerHour * elapsedHours);
  const organicMatter = Math.max(
    0,
    state.organicMatter - organicMatterUsedPerHour * elapsedHours,
  );

  const fuelDepletesAt =
    fuelUsedPerHour > 0
      ? state.lastSave + (state.fuel / fuelUsedPerHour) * 60 * 60 * 1000
      : null;

  const organicMatterDepletesAt =
    organicMatterUsedPerHour > 0
      ? state.lastSave +
        (state.organicMatter / organicMatterUsedPerHour) * 60 * 60 * 1000
      : null;

  return { organicMatter, fuel, fuelDepletesAt, organicMatterDepletesAt };
}
```

- [x] **Step 5: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 21 tests (16 from Task 4 + 5 here).

- [x] **Step 6: Extend `data-integrity.test.ts` with a composter check**

Add to the existing file:

```ts
import composter from "../../../data/composter.json";

describe("data/composter.json", () => {
  it("defines all 5 upgrade curves", () => {
    expect(Object.keys(composter.upgrades).sort()).toEqual(
      [
        "costReduction",
        "fuelCap",
        "multiDrop",
        "organicMatterCap",
        "speed",
      ].sort(),
    );
  });
});
```

- [x] **Step 7: Run it and confirm it still passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 22 tests.

- [x] **Step 8: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [x] **Step 9: Commit**

```bash
git add data/composter.json packages/core/src/composter.ts packages/core/src/composter.test.ts packages/core/src/data-integrity.test.ts
git commit -m "feat(core): add composter.json and composter.ts"
```

---

### Task 6: `garden.ts` and its API fixture

**Files:**
- Create: `packages/core/fixtures/garden-response.sample.json`
- Create: `packages/core/src/garden.test.ts`
- Create: `packages/core/src/garden.ts`

**Interfaces:**
- Consumes: `data/garden-levels.json` (Task 1), `GardenState`/`ComposterState` from `types.ts` (Task 2).
- Produces: `levelForExperience(experience: number): number`, `normalizeGarden(raw: unknown): GardenState` — the boundary function CLAUDE.md §9 requires ("Normalize API responses at the boundary... the rest of the app uses `GardenState`, not raw JSON").

- [x] **Step 1: Write `packages/core/fixtures/garden-response.sample.json`**

```json
{
  "success": true,
  "uuid": "11111111-1111-1111-1111-111111111111",
  "garden_experience": 195487,
  "unlocked_plots_ids": [
    "beginner_1",
    "beginner_2",
    "beginner_3",
    "beginner_4",
    "intermediate_1"
  ],
  "composter_data": {
    "organic_matter": 3200.5,
    "fuel_units": 1800,
    "compost_units": 4,
    "last_save": 1730000000000,
    "upgrades": {
      "speed": 3,
      "multi_drop": 1,
      "fuel_cap": 2,
      "organic_matter_cap": 2,
      "cost_reduction": 0
    }
  },
  "active_commissions": {},
  "commission_data": {
    "total_completed": 42,
    "unique_npcs_served": 7
  },
  "resources_collected": {},
  "crop_upgrade_levels": {},
  "unlocked_barn_skins": [],
  "selected_barn_skin": null
}
```

- [x] **Step 2: Write the failing test — `packages/core/src/garden.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { levelForExperience, normalizeGarden } from "./garden";
import sampleResponse from "../fixtures/garden-response.sample.json";

describe("levelForExperience", () => {
  it("is level 1 at 0 XP", () => {
    expect(levelForExperience(0)).toBe(1);
  });

  it("is level 2 at exactly the level-2 threshold", () => {
    expect(levelForExperience(70)).toBe(2);
  });

  it("caps at level 15", () => {
    expect(levelForExperience(999_999)).toBe(15);
  });
});

describe("normalizeGarden", () => {
  it("normalizes a full API response", () => {
    expect(normalizeGarden(sampleResponse)).toEqual({
      level: 15,
      experience: 195487,
      unlockedPlotIds: [
        "beginner_1",
        "beginner_2",
        "beginner_3",
        "beginner_4",
        "intermediate_1",
      ],
      composter: {
        organicMatter: 3200.5,
        fuel: 1800,
        compostUnits: 4,
        lastSave: 1730000000000,
        upgrades: {
          speed: 3,
          multiDrop: 1,
          fuelCap: 2,
          organicMatterCap: 2,
          costReduction: 0,
        },
      },
      visitorsServedTotal: 42,
    });
  });

  it("falls back to safe defaults when every field is missing", () => {
    expect(normalizeGarden({})).toEqual({
      level: 1,
      experience: 0,
      unlockedPlotIds: [],
      composter: {
        organicMatter: 0,
        fuel: 0,
        compostUnits: 0,
        lastSave: 0,
        upgrades: {
          speed: 0,
          multiDrop: 0,
          fuelCap: 0,
          organicMatterCap: 0,
          costReduction: 0,
        },
      },
      visitorsServedTotal: 0,
    });
  });
});
```

- [x] **Step 3: Run it and confirm it fails**

```bash
pnpm --filter @garden-hq/core test
```

Expected: FAIL — `./garden` cannot be resolved.

- [x] **Step 4: Write `packages/core/src/garden.ts`**

```ts
import gardenLevels from "../../../data/garden-levels.json";
import type { ComposterState, ComposterUpgrades, GardenState } from "./types";

interface GardenLevelEntry {
  level: number;
  xpRequired: number;
  cumulativeXp: number;
}

const LEVELS = gardenLevels as GardenLevelEntry[];

export function levelForExperience(experience: number): number {
  let level = 1;
  for (const entry of LEVELS) {
    if (experience >= entry.cumulativeXp) {
      level = entry.level;
    }
  }
  return level;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeUpgrades(raw: unknown): ComposterUpgrades {
  const data = (raw ?? {}) as Record<string, unknown>;

  return {
    speed: asNumber(data.speed, 0),
    multiDrop: asNumber(data.multi_drop, 0),
    fuelCap: asNumber(data.fuel_cap, 0),
    organicMatterCap: asNumber(data.organic_matter_cap, 0),
    costReduction: asNumber(data.cost_reduction, 0),
  };
}

function normalizeComposter(raw: unknown): ComposterState {
  const data = (raw ?? {}) as Record<string, unknown>;

  return {
    organicMatter: asNumber(data.organic_matter, 0),
    fuel: asNumber(data.fuel_units, 0),
    compostUnits: asNumber(data.compost_units, 0),
    lastSave: asNumber(data.last_save, 0),
    upgrades: normalizeUpgrades(data.upgrades),
  };
}

function countCompletedVisitors(raw: unknown): number {
  const data = (raw ?? {}) as Record<string, unknown>;
  return asNumber(data.total_completed, 0);
}

export function normalizeGarden(raw: unknown): GardenState {
  const data = (raw ?? {}) as Record<string, unknown>;
  const experience = asNumber(data.garden_experience, 0);

  return {
    level: levelForExperience(experience),
    experience,
    unlockedPlotIds: asStringArray(data.unlocked_plots_ids),
    composter: normalizeComposter(data.composter_data),
    visitorsServedTotal: countCompletedVisitors(data.commission_data),
  };
}
```

- [x] **Step 5: Run it and confirm it passes**

```bash
pnpm --filter @garden-hq/core test
```

Expected: PASS, 28 tests (actual count as executed; this plan's intermediate per-task counts drifted slightly from the arithmetic sketched in earlier tasks -- trust the real `vitest run` output at each step over these comments).

- [x] **Step 6: Typecheck and lint**

```bash
pnpm --filter @garden-hq/core typecheck
pnpm run lint
```

Expected: both exit 0.

- [x] **Step 7: Commit**

```bash
git add packages/core/fixtures packages/core/src/garden.ts packages/core/src/garden.test.ts
git commit -m "feat(core): add garden.ts with a sample-fixture-driven normalizer"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [x] **Step 1: Clean install and run every workspace script from the root**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all exit 0. `pnpm test` shows 28 passing tests in `@garden-hq/core` (plus the existing `@garden-hq/worker` test from Phase 0).

- [x] **Step 2: Confirm the Phase 1 file set matches CLAUDE.md §5**

```bash
ls data
ls packages/core/src
ls packages/core/fixtures
```

Expected: `data/` has `crops.json`, `pests.json`, `garden-levels.json`, `plots.json`, `composter.json`, `VERIFY.md`; `packages/core/src` has `types.ts`, `calendar.ts`, `garden.ts`, `plots.ts`, `composter.ts`, `data-integrity.test.ts`, and each module's `.test.ts`; `packages/core/fixtures` has `garden-response.sample.json`.

- [x] **Step 3: Commit anything left over (e.g. a refreshed lockfile)**

```bash
git status
```

If clean, skip. Otherwise:

```bash
git add -A
git commit -m "chore: verify phase 1 core+data end-to-end"
```

---

## Self-Review

**Spec coverage:**
- `data/*.json` for crops, plots, pests, levels → Tasks 1, 3, 4. ✅ (composter.json added too, Task 5 — needed by `composter.ts` which the build order explicitly requires, even though the phase description's parenthetical list didn't name it.)
- `calendar.ts`, `garden.ts`, `plots.ts`, `composter.ts` with unit tests → Tasks 2, 4, 5, 6. ✅
- Sample API response fixture in `packages/core/fixtures/` → Task 6. ✅
- No live API calls in tests → all tests use fixtures/fixed data, none call `fetch`. ✅
- No `any` in `packages/core`, strict TS → every module uses concrete interfaces and `unknown` + narrowing, not `any`. ✅
- Uncertain mechanics get `// VERIFY:` + `data/VERIFY.md` entries, not silent guesses → Task 1 seeds the file; `calendar.ts`, `composter.ts` reference it inline. ✅

**Placeholder scan:** no TBDs; every step has literal file contents or literal commands.

**Type consistency:** `GardenState`/`ComposterState`/`ComposterUpgrades` are defined once in `types.ts` (Task 2) and used with identical field names throughout `garden.ts` (Task 6) and `composter.ts` (Task 5) — cross-checked the `upgrades` field names (`speed`, `multiDrop`, `fuelCap`, `organicMatterCap`, `costReduction`) match exactly across both files' code blocks above.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-30-phase-1-core-and-data.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
