# Greenhouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Greenhouse feature: player-marked Greenhouse plots on the map, a 10x10 grid editor per Greenhouse with a live unique-crop bonus, a mutation guide, API-sourced mutation progress and chip levels, and a manual "I watered it" timestamp.

**Architecture:** Game logic lives in `packages/core` as pure functions over data in `/data` (`mutations.json`, `greenhouse-crops.json`). A new Worker route `/api/member` returns the trimmed profile-member subset (mutation progress, chip levels). The web app stores Greenhouse state locally in the existing `garden-hq:v1` storage, keyed by the marked plot id, and adds a Greenhouse tab (DOM grid editor) plus a "Mark as Greenhouse" action and glass tile on the PixiJS map.

**Tech Stack:** TypeScript strict, pnpm workspaces, vitest, Hono on Cloudflare Workers, React 19 + react-router + TanStack Query + zustand, PixiJS 8, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-06-greenhouse-design.md` (read it first; it records the owner-confirmed facts below).

## Global Constraints

- TypeScript `strict` and `noUncheckedIndexedAccess` are on (`tsconfig.base.json`); web also has `verbatimModuleSyntax` and `erasableSyntaxOnly` (no enums, no constructor parameter properties). No `any` anywhere in `packages/core` (ESLint error).
- Game numbers come from `/data`, never magic numbers in code. Every `core` function gets a vitest test. Tests use fixtures, never live API calls.
- Every API field is optional: normalizers must handle missing and malformed data. Normalize at the boundary (`garden.ts`, `member.ts`); the rest of the app uses `GardenState` / `GardenMemberState`.
- When a mechanic is uncertain, add a `// VERIFY:` comment and an entry in `data/VERIFY.md` instead of guessing silently.
- Mobile-first: the Greenhouse grid must fit a 380 px viewport (10 cells x 32 px = 320 px). Pixel art: `image-rendering: pixelated`, integer sizes only. Original sprites only, no Hypixel/Minecraft textures. Footer "Not affiliated with Hypixel or Mojang." already exists; keep it.
- Owner-confirmed facts: a Greenhouse is a placeable plot on the 24-plot map (owner's is plot 4 = `beginner_3`); `garden.greenhouse_slots` lists **locked** cells (unlocked = 10x10 minus the list; the owner's 12 unlocked cells are `3,4 3,5 4,3 4,4 4,5 4,6 5,3 5,4 5,5 5,6 6,4 6,5`); `player_data.garden_chips` values are chip **levels**; player marks Greenhouse plots manually, default none, max 3. Cell coordinates are `x` (column) and `z` (row), 0..9.
- The working tree has ~36 unrelated modified files. **Stage only the files each task lists** (`git add <paths>`), never `git add -A` or `git commit -a`.
- Commit trailers (use exactly this form in every commit):
  `git commit -m "<subject>" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'`
- Line endings: the repo has `.gitattributes` (`* text=auto eol=lf`) since commit `chore: normalize line endings`. Write LF; do not reformat files you are not changing.
- Recipe geometry (inferred, in `data/VERIFY.md`): a mutation's neighbours are the ring of cells around its footprint (8 / 12 / 16 for 1x1 / 2x2 / 3x3), not always the 8 surrounding cells. The guide shows "Needs N more unlocked cells" (`extraCellsNeeded`) for mutations that do not fit the player's unlocked cells.
- Never commit `apps/worker/garden.raw.json` or `apps/worker/profiles.json` (gitignored, real player data). Fixtures committed here must have the player uuid replaced.
- Commands run from the repo root. Package tests: `pnpm --filter @garden-hq/core test`, `pnpm --filter @garden-hq/worker test`, `pnpm --filter @garden-hq/web test`. Single file: append `-- <path>`.

## Execution roles

Subagent-driven: for each task dispatch a **Sonnet** implementer subagent with the full task text and this plan's Global Constraints; when it reports DONE, dispatch an **Opus** reviewer subagent (spec compliance first, then code quality) against that task's commit; fix review findings before starting the next task. Tasks run sequentially (later tasks consume earlier tasks' exports).

---

## File Structure

| File | Responsibility |
|---|---|
| `data/mutations.json` (new) | 40 mutations: rarity, neighbour recipe or special text, effects, growth, `lastVerified` |
| `data/greenhouse-crops.json` (new) | grid size, unlock level, bonus rule, placeable crops |
| `packages/core/src/greenhouse-data.ts` (new) | typed loaders for the two files; `isPlaceableId`, `placeableName` |
| `packages/core/src/greenhouse.ts` (new) | pure grid logic: cell keys, unlocked cells, bonus, recipe status, ranking, fit |
| `packages/core/src/member.ts` (new) | `normalizeGardenMember`, `findProfileMember` |
| `packages/core/src/types.ts`, `garden.ts`, `api.ts`, `text.ts`, `index.ts` | add types, `greenhouse.lockedCells`, `MemberResponse`, `prettifyId`, exports |
| `packages/core/fixtures/garden-response.real.sample.json`, `member-greenhouse.real.sample.json` (new) | anonymised real captures |
| `apps/worker/src/routes/member.ts` (new), `app.ts`, `README.md` | `GET /api/member` |
| `apps/web/src/api/client.ts`, `state/queries.ts` | `api.member`, `useMember` |
| `apps/web/src/state/storage.ts` | `greenhouses` in `StoredData` + mark/unmark/cell/watered methods |
| `apps/web/src/viewmodels/greenhouse.ts` (new) | grid view model, highlights, swatch colour, `formatAge` |
| `apps/web/src/greenhouse/*.tsx` (new) | `GreenhouseGrid`, `GreenhousePalette`, `BonusBar`, `MutationGuide`, `ChipLevels`, `GreenhousePanel` |
| `apps/web/src/screens/GreenhouseScreen.tsx` (new), `App.tsx`, `components/TabBar.tsx` | the tab and route |
| `apps/web/src/viewmodels/map.ts`, `map/AssignCropSheet.tsx`, `map/MapSection.tsx`, `map/MapScene.ts`, `map/palette.ts`, `map/PlotList.tsx`, `screens/HomeScreen.tsx` | mark action + glass tile |
| `apps/web/src/index.css` | Greenhouse styles |
| `apps/web/src/test/greenhouseFixtures.ts` (new) | shared test constants (the owner's 12 unlocked cells) |

---

### Task 1: Mutation and Greenhouse-crop data

**Files:**
- Create: `data/mutations.json`, `data/greenhouse-crops.json`, `packages/core/src/greenhouse-data.ts`
- Test: `packages/core/src/greenhouse-data.test.ts`
- Modify: `packages/core/src/index.ts`, `data/VERIFY.md`

**Interfaces:**
- Produces (from `greenhouse-data.ts`, all re-exported by the core index):
  - `type MutationRarity = "common" | "uncommon" | "rare" | "epic" | "legendary"`
  - `interface RecipeIngredient { id: string; count: number; placeable: boolean }`
  - `type MutationRecipe = { kind: "neighbours"; ingredients: RecipeIngredient[] } | { kind: "special"; text: string }`
  - `interface MutationDefinition { id: string; name: string; rarity: MutationRarity; recipe: MutationRecipe; effects: string[]; growth: { stages: number | null; medium: string | null; footprint: 1 | 2 | 3 }; needsWater: boolean | null; notes: string }`
  - `interface GreenhouseCrop { id: string; name: string; countsForBonus: boolean }`
  - `const ALL_MUTATIONS: MutationDefinition[]`, `const GREENHOUSE_CROPS: GreenhouseCrop[]`
  - `const GREENHOUSE_GRID_SIZE: number` (10), `GREENHOUSE_UNLOCK_LEVEL` (7), `BONUS_PERCENT_PER_UNIQUE_CROP` (3), `MAX_UNIQUE_CROPS` (12)
  - `const MUTATIONS_LAST_VERIFIED: string | null`
  - `getMutation(id: string): MutationDefinition | undefined`, `isPlaceableId(id: string): boolean`, `placeableName(id: string): string` (display name; falls back to the id)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/greenhouse-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ALL_MUTATIONS,
  BONUS_PERCENT_PER_UNIQUE_CROP,
  GREENHOUSE_CROPS,
  GREENHOUSE_GRID_SIZE,
  GREENHOUSE_UNLOCK_LEVEL,
  MAX_UNIQUE_CROPS,
  MUTATIONS_LAST_VERIFIED,
  getMutation,
  isPlaceableId,
  placeableName,
} from "./greenhouse-data";

describe("data/mutations.json", () => {
  it("has 40 mutations with unique ids", () => {
    expect(ALL_MUTATIONS).toHaveLength(40);
    expect(new Set(ALL_MUTATIONS.map((m) => m.id)).size).toBe(40);
  });

  it("has the wiki's rarity split of 9/6/10/8/7", () => {
    const count = (rarity: string) =>
      ALL_MUTATIONS.filter((m) => m.rarity === rarity).length;
    expect([
      count("common"),
      count("uncommon"),
      count("rare"),
      count("epic"),
      count("legendary"),
    ]).toEqual([9, 6, 10, 8, 7]);
  });

  it("records a lastVerified date", () => {
    expect(MUTATIONS_LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives every neighbour recipe positive integer counts", () => {
    for (const m of ALL_MUTATIONS) {
      if (m.recipe.kind !== "neighbours") continue;
      expect(m.recipe.ingredients.length).toBeGreaterThan(0);
      for (const ing of m.recipe.ingredients) {
        expect(Number.isInteger(ing.count) && ing.count > 0).toBe(true);
      }
    }
  });

  it("only leaves 'fire' as a non-placeable ingredient", () => {
    const nonPlaceable = ALL_MUTATIONS.flatMap((m) =>
      m.recipe.kind === "neighbours"
        ? m.recipe.ingredients.filter((i) => !i.placeable).map((i) => i.id)
        : [],
    );
    expect([...new Set(nonPlaceable)]).toEqual(["fire"]);
  });

  it("has text-only recipes for exactly lonelily, shellfruit, godseed, jerryflower", () => {
    const special = ALL_MUTATIONS.filter((m) => m.recipe.kind === "special")
      .map((m) => m.id)
      .sort();
    expect(special).toEqual(["godseed", "jerryflower", "lonelily", "shellfruit"]);
  });

  it("resolves the mutation ids the real API returned", () => {
    for (const id of ["ashwreath", "shadevine", "dustgrain", "lonelily"]) {
      expect(getMutation(id)?.id).toBe(id);
    }
    expect(getMutation("dead_plant")).toBeUndefined();
  });

  it("uses footprints of 1, 2 or 3 and never claims needsWater without a source", () => {
    for (const m of ALL_MUTATIONS) {
      expect([1, 2, 3]).toContain(m.growth.footprint);
      expect(m.needsWater).toBeNull();
    }
  });
});

describe("data/greenhouse-crops.json", () => {
  it("carries the confirmed rule values", () => {
    expect(GREENHOUSE_GRID_SIZE).toBe(10);
    expect(GREENHOUSE_UNLOCK_LEVEL).toBe(7);
    expect(BONUS_PERCENT_PER_UNIQUE_CROP).toBe(3);
    expect(MAX_UNIQUE_CROPS).toBe(12);
  });

  it("has unique ids and counts only real crops towards the bonus", () => {
    expect(new Set(GREENHOUSE_CROPS.map((c) => c.id)).size).toBe(
      GREENHOUSE_CROPS.length,
    );
    expect(GREENHOUSE_CROPS.find((c) => c.id === "dead_plant")).toMatchObject({
      countsForBonus: false,
    });
    expect(GREENHOUSE_CROPS.find((c) => c.id === "wheat")).toMatchObject({
      countsForBonus: true,
    });
  });

  it("treats crops, dead_plant and mutations as placeable, not fire", () => {
    expect(isPlaceableId("wheat")).toBe(true);
    expect(isPlaceableId("dead_plant")).toBe(true);
    expect(isPlaceableId("dustgrain")).toBe(true);
    expect(isPlaceableId("fire")).toBe(false);
    expect(placeableName("sugar_cane")).toBe("Sugar Cane");
    expect(placeableName("do_not_eat_shroom")).toBe("Do-not-eat-shroom");
    expect(placeableName("unknown_thing")).toBe("unknown_thing");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @garden-hq/core test -- src/greenhouse-data.test.ts`
Expected: FAIL (cannot resolve `./greenhouse-data`).

- [ ] **Step 3: Create `data/greenhouse-crops.json`**

```json
{
  "gridSize": 10,
  "unlockGardenLevel": 7,
  "bonusPercentPerUniqueCrop": 3,
  "maxUniqueCrops": 12,
  "crops": [
    { "id": "wheat", "name": "Wheat", "countsForBonus": true },
    { "id": "carrot", "name": "Carrot", "countsForBonus": true },
    { "id": "potato", "name": "Potato", "countsForBonus": true },
    { "id": "pumpkin", "name": "Pumpkin", "countsForBonus": true },
    { "id": "melon", "name": "Melon", "countsForBonus": true },
    { "id": "cactus", "name": "Cactus", "countsForBonus": true },
    { "id": "sugar_cane", "name": "Sugar Cane", "countsForBonus": true },
    { "id": "cocoa_beans", "name": "Cocoa Beans", "countsForBonus": true },
    { "id": "red_mushroom", "name": "Red Mushroom", "countsForBonus": true },
    { "id": "brown_mushroom", "name": "Brown Mushroom", "countsForBonus": true },
    { "id": "nether_wart", "name": "Nether Wart", "countsForBonus": true },
    { "id": "sunflower", "name": "Sunflower", "countsForBonus": true },
    { "id": "moonflower", "name": "Moonflower", "countsForBonus": true },
    { "id": "wild_rose", "name": "Wild Rose", "countsForBonus": true },
    { "id": "fermento", "name": "Fermento", "countsForBonus": true },
    { "id": "dead_plant", "name": "Dead Plant", "countsForBonus": false }
  ]
}
```

- [ ] **Step 4: Create `data/mutations.json`**

`recipe.ingredients` is an `id -> count` record in the file; the loader turns it into `RecipeIngredient[]`. `lastVerified` stays `null` until Step 8.

```json
{
  "lastVerified": null,
  "source": "https://hypixelskyblock.minecraft.wiki/w/Mutation",
  "mutations": [
    { "id": "ashwreath", "name": "Ashwreath", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "nether_wart": 2, "fire": 2 } }, "effects": ["Improved Harvest Boost", "XP Loss"], "growth": { "stages": null, "medium": "Soul Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "choconut", "name": "Choconut", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "cocoa_beans": 2 } }, "effects": ["Immunity"], "growth": { "stages": null, "medium": "Farmland", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "dustgrain", "name": "Dustgrain", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "wheat": 2 } }, "effects": ["Harvest Boost"], "growth": { "stages": null, "medium": "Farmland", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "gloomgourd", "name": "Gloomgourd", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "pumpkin": 1, "melon": 1 } }, "effects": ["Water Retain", "Bonus Drops"], "growth": { "stages": null, "medium": "Farmland", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "lonelily", "name": "Lonelily", "rarity": "common", "recipe": { "kind": "special", "text": "Grows only with no adjacent crops." }, "effects": ["Bonus Drops"], "growth": { "stages": null, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "A delicate flower that only blooms when left alone." },
    { "id": "scourroot", "name": "Scourroot", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "potato": 1, "carrot": 1 } }, "effects": ["Immunity", "XP Boost"], "growth": { "stages": null, "medium": "Farmland", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "shadevine", "name": "Shadevine", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "cactus": 1, "sugar_cane": 1 } }, "effects": ["Improved Water Retain", "Improved XP Boost", "Harvest Loss"], "growth": { "stages": null, "medium": "Farmland", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "veilshroom", "name": "Veilshroom", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "red_mushroom": 1, "brown_mushroom": 1 } }, "effects": ["Improved Harvest Boost", "Water Drain"], "growth": { "stages": null, "medium": "Mycelium", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "witherbloom", "name": "Witherbloom", "rarity": "common", "recipe": { "kind": "neighbours", "ingredients": { "dead_plant": 4 } }, "effects": ["Effect Spread"], "growth": { "stages": null, "medium": "Soul Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "chocoberry", "name": "Chocoberry", "rarity": "uncommon", "recipe": { "kind": "neighbours", "ingredients": { "choconut": 6, "gloomgourd": 2 } }, "effects": ["Water Retain"], "growth": { "stages": 6, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "cindershade", "name": "Cindershade", "rarity": "uncommon", "recipe": { "kind": "neighbours", "ingredients": { "ashwreath": 4, "witherbloom": 4 } }, "effects": ["Effect Spread", "Improved Harvest Boost", "XP Loss"], "growth": { "stages": 8, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "coalroot", "name": "Coalroot", "rarity": "uncommon", "recipe": { "kind": "neighbours", "ingredients": { "ashwreath": 5, "scourroot": 3 } }, "effects": ["XP Boost"], "growth": { "stages": 8, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "creambloom", "name": "Creambloom", "rarity": "uncommon", "recipe": { "kind": "neighbours", "ingredients": { "choconut": 8 } }, "effects": ["Immunity"], "growth": { "stages": 6, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "duskbloom", "name": "Duskbloom", "rarity": "uncommon", "recipe": { "kind": "neighbours", "ingredients": { "moonflower": 2, "shadevine": 2, "sunflower": 2, "dustgrain": 2 } }, "effects": ["Bonus Drops"], "growth": { "stages": 8, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "thornshade", "name": "Thornshade", "rarity": "uncommon", "recipe": { "kind": "neighbours", "ingredients": { "wild_rose": 4, "veilshroom": 4 } }, "effects": ["Effect Spread"], "growth": { "stages": 8, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "blastberry", "name": "Blastberry", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "chocoberry": 5, "ashwreath": 3 } }, "effects": ["Immunity", "Improved Harvest Boost", "XP Loss"], "growth": { "stages": 6, "medium": "Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "cheesebite", "name": "Cheesebite", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "creambloom": 4, "fermento": 4 } }, "effects": ["Improved Water Retain"], "growth": { "stages": 10, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "chloronite", "name": "Chloronite", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "coalroot": 6, "thornshade": 2 } }, "effects": ["Immunity"], "growth": { "stages": 10, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "do_not_eat_shroom", "name": "Do-not-eat-shroom", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "veilshroom": 4, "scourroot": 4 } }, "effects": ["Improved Harvest Boost", "Water Drain"], "growth": { "stages": 8, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "fleshtrap", "name": "Fleshtrap", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "cindershade": 4, "lonelily": 4 } }, "effects": ["Bonus Drops"], "growth": { "stages": null, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "Requires regular offerings to stay alive." },
    { "id": "magic_jellybean", "name": "Magic Jellybean", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "sugar_cane": 5, "duskbloom": 3 } }, "effects": ["Improved XP Boost", "Harvest Loss"], "growth": { "stages": 120, "medium": "Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "noctilume", "name": "Noctilume", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "duskbloom": 6, "lonelily": 6 } }, "effects": ["Effect Spread", "Improved Water Retain", "Harvest Loss"], "growth": { "stages": 4, "medium": null, "footprint": 2 }, "needsWater": null, "notes": "" },
    { "id": "snoozling", "name": "Snoozling", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "creambloom": 4, "dustgrain": 3, "witherbloom": 3, "duskbloom": 3, "thornshade": 3 } }, "effects": ["Bonus Drops"], "growth": { "stages": 20, "medium": null, "footprint": 3 }, "needsWater": null, "notes": "" },
    { "id": "soggybud", "name": "Soggybud", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "melon": 2, "gloomgourd": 2 } }, "effects": ["Water Retain"], "growth": { "stages": 10, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "turtlellini", "name": "Turtlellini", "rarity": "rare", "recipe": { "kind": "neighbours", "ingredients": { "soggybud": 4, "choconut": 4 } }, "effects": ["Water Retain", "Immunity"], "growth": { "stages": null, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "No growth stages." },
    { "id": "chorus_fruit", "name": "Chorus Fruit", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "chloronite": 5, "magic_jellybean": 3 } }, "effects": ["Improved XP Boost", "Harvest Loss"], "growth": { "stages": 12, "medium": "End Stone", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "plantboy_advance", "name": "PlantBoy Advance", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "snoozling": 6, "thunderling": 6 } }, "effects": ["Harvest Boost"], "growth": { "stages": 12, "medium": null, "footprint": 2 }, "needsWater": null, "notes": "" },
    { "id": "puffercloud", "name": "Puffercloud", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "snoozling": 2, "do_not_eat_shroom": 6 } }, "effects": ["Improved Harvest Boost", "Water Drain"], "growth": { "stages": 14, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "shellfruit", "name": "Shellfruit", "rarity": "epic", "recipe": { "kind": "special", "text": "Explode a Turtlellini with a Blastberry." }, "effects": ["Water Retain", "Immunity"], "growth": { "stages": null, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "No growth stages listed." },
    { "id": "startlevine", "name": "Startlevine", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "blastberry": 4, "cheesebite": 4 } }, "effects": ["Improved Water Retain", "Improved XP Boost", "Harvest Loss"], "growth": { "stages": 12, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "stoplight_petal", "name": "Stoplight Petal", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "snoozling": 4, "noctilume": 4 } }, "effects": ["Effect Spread", "Improved Water Retain", "Harvest Loss"], "growth": { "stages": 12, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "thunderling", "name": "Thunderling", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "soggybud": 5, "noctilume": 3 } }, "effects": ["Effect Spread"], "growth": { "stages": 16, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "zombud", "name": "Zombud", "rarity": "epic", "recipe": { "kind": "neighbours", "ingredients": { "dead_plant": 4, "cindershade": 2, "fleshtrap": 2 } }, "effects": ["Effect Spread", "Bonus Drops"], "growth": { "stages": 16, "medium": "Soul Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "all_in_aloe", "name": "All-in Aloe", "rarity": "legendary", "recipe": { "kind": "neighbours", "ingredients": { "magic_jellybean": 6, "plantboy_advance": 2 } }, "effects": ["Harvest Boost"], "growth": { "stages": 27, "medium": "Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "devourer", "name": "Devourer", "rarity": "legendary", "recipe": { "kind": "neighbours", "ingredients": { "puffercloud": 4, "zombud": 4 } }, "effects": ["Bonus Drops", "Improved Harvest Boost", "Water Drain"], "growth": { "stages": 16, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "glasscorn", "name": "Glasscorn", "rarity": "legendary", "recipe": { "kind": "neighbours", "ingredients": { "startlevine": 6, "chloronite": 6 } }, "effects": ["Immunity", "Improved Water Retain", "Harvest Loss"], "growth": { "stages": 9, "medium": null, "footprint": 2 }, "needsWater": null, "notes": "" },
    { "id": "godseed", "name": "Godseed", "rarity": "legendary", "recipe": { "kind": "special", "text": "Needs all positive crop effects." }, "effects": ["Improved Harvest Boost", "Improved Water Retain", "Improved XP Boost", "Immunity", "Bonus Drops", "Effect Spread"], "growth": { "stages": 40, "medium": null, "footprint": 3 }, "needsWater": null, "notes": "" },
    { "id": "jerryflower", "name": "Jerryflower", "rarity": "legendary", "recipe": { "kind": "special", "text": "Grow a Jerryseed." }, "effects": [], "growth": { "stages": null, "medium": null, "footprint": 1 }, "needsWater": null, "notes": "Jerryflower never sleeps, Jerryflower never stops." },
    { "id": "phantomleaf", "name": "Phantomleaf", "rarity": "legendary", "recipe": { "kind": "neighbours", "ingredients": { "chorus_fruit": 4, "shellfruit": 4 } }, "effects": ["XP Boost", "Immunity"], "growth": { "stages": 15, "medium": "Soul Sand", "footprint": 1 }, "needsWater": null, "notes": "" },
    { "id": "timestalk", "name": "Timestalk", "rarity": "legendary", "recipe": { "kind": "neighbours", "ingredients": { "stoplight_petal": 4, "chorus_fruit": 2, "shellfruit": 2 } }, "effects": ["Improved Water Retain", "Improved XP Boost", "Harvest Loss"], "growth": { "stages": 14, "medium": "End Stone", "footprint": 1 }, "needsWater": null, "notes": "" }
  ]
}
```

- [ ] **Step 5: Create `packages/core/src/greenhouse-data.ts`**

```ts
import greenhouseCropData from "../../../data/greenhouse-crops.json";
import mutationData from "../../../data/mutations.json";

export type MutationRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary";

export interface RecipeIngredient {
  id: string;
  count: number;
  /** false for ingredients a player cannot put in a cell (e.g. "fire"). */
  placeable: boolean;
}

export type MutationRecipe =
  | { kind: "neighbours"; ingredients: RecipeIngredient[] }
  | { kind: "special"; text: string };

export interface MutationDefinition {
  id: string;
  name: string;
  rarity: MutationRarity;
  recipe: MutationRecipe;
  effects: string[];
  growth: {
    stages: number | null;
    medium: string | null;
    footprint: 1 | 2 | 3;
  };
  /** null = unknown; see data/VERIFY.md. */
  needsWater: boolean | null;
  notes: string;
}

export interface GreenhouseCrop {
  id: string;
  name: string;
  countsForBonus: boolean;
}

interface RawMutation extends Omit<MutationDefinition, "recipe"> {
  recipe:
    | { kind: "neighbours"; ingredients: Record<string, number> }
    | { kind: "special"; text: string };
}

interface RawMutationFile {
  lastVerified: string | null;
  source: string;
  mutations: RawMutation[];
}

interface RawGreenhouseCropFile {
  gridSize: number;
  unlockGardenLevel: number;
  bonusPercentPerUniqueCrop: number;
  maxUniqueCrops: number;
  crops: GreenhouseCrop[];
}

const mutationFile = mutationData as unknown as RawMutationFile;
const cropFile = greenhouseCropData as unknown as RawGreenhouseCropFile;

export const GREENHOUSE_GRID_SIZE: number = cropFile.gridSize;
export const GREENHOUSE_UNLOCK_LEVEL: number = cropFile.unlockGardenLevel;
export const BONUS_PERCENT_PER_UNIQUE_CROP: number =
  cropFile.bonusPercentPerUniqueCrop;
export const MAX_UNIQUE_CROPS: number = cropFile.maxUniqueCrops;
export const GREENHOUSE_CROPS: GreenhouseCrop[] = cropFile.crops;
export const MUTATIONS_LAST_VERIFIED: string | null = mutationFile.lastVerified;

const PLACEABLE_NAMES = new Map<string, string>([
  ...cropFile.crops.map((c): [string, string] => [c.id, c.name]),
  ...mutationFile.mutations.map((m): [string, string] => [m.id, m.name]),
]);

export function isPlaceableId(id: string): boolean {
  return PLACEABLE_NAMES.has(id);
}

export function placeableName(id: string): string {
  return PLACEABLE_NAMES.get(id) ?? id;
}

export const ALL_MUTATIONS: MutationDefinition[] = mutationFile.mutations.map(
  (m) => ({
    ...m,
    recipe:
      m.recipe.kind === "special"
        ? m.recipe
        : {
            kind: "neighbours" as const,
            ingredients: Object.entries(m.recipe.ingredients).map(
              ([id, count]) => ({ id, count, placeable: isPlaceableId(id) }),
            ),
          },
  }),
);

export function getMutation(id: string): MutationDefinition | undefined {
  return ALL_MUTATIONS.find((m) => m.id === id);
}
```

Append to `packages/core/src/index.ts`: `export * from "./greenhouse-data";`

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @garden-hq/core test -- src/greenhouse-data.test.ts`
Expected: all pass **except** "records a lastVerified date" (still `null`). Every other test must pass.

- [ ] **Step 7: Re-read the wiki directly and cross-check**

The table above came through a summarising fetch. Verify it:
1. `WebFetch` `https://hypixelskyblock.minecraft.wiki/w/Mutation` with the prompt "Copy the full mutation table verbatim as rows: name, rarity, required pattern, effects, notes. Do not summarise." Compare every row against `data/mutations.json` (counts, ingredient ids, rarity, footprint, stages, medium).
2. `WebSearch` for a second source (e.g. the SkyHanni or NotEnoughUpdates repo's Greenhouse/mutation data, or another current wiki page) and spot-check at least ten recipes, including all four special ones and "2 Fire" for Ashwreath.
3. Fix any mismatch in `data/mutations.json`. For every unresolved discrepancy or ambiguity (adjacency rule, what "Fire" means, the special recipes, `needsWater`), make sure `data/VERIFY.md` has an entry; if the count of mutations differs from 40, update the Step 1 expectations and tell the owner.

- [ ] **Step 8: Set `lastVerified` and format**

In `data/mutations.json` set `"lastVerified"` to the date you actually completed Step 7 (`YYYY-MM-DD`). Then:

Run: `pnpm exec prettier --write data/mutations.json data/greenhouse-crops.json packages/core/src/greenhouse-data.ts packages/core/src/greenhouse-data.test.ts`
Run: `pnpm --filter @garden-hq/core test && pnpm --filter @garden-hq/core typecheck`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add data/mutations.json data/greenhouse-crops.json data/VERIFY.md packages/core/src/greenhouse-data.ts packages/core/src/greenhouse-data.test.ts packages/core/src/index.ts
git commit -m "feat(core): mutation and greenhouse-crop data with loaders" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

---

### Task 2: Real fixtures and API normalizers

**Files:**
- Create: `packages/core/fixtures/garden-response.real.sample.json`, `packages/core/fixtures/member-greenhouse.real.sample.json`, `packages/core/src/member.ts`
- Modify: `packages/core/src/types.ts`, `packages/core/src/garden.ts`, `packages/core/src/api.ts`, `packages/core/src/text.ts`, `packages/core/src/index.ts`, `packages/core/src/garden.test.ts`, `packages/core/src/text.test.ts`
- Test: `packages/core/src/member.test.ts`, additions to `garden.test.ts`

**Interfaces:**
- Consumes: `asArray`, `asRecord`, `asString`, `asNumber` from `./coerce`; `GREENHOUSE_GRID_SIZE` from `./greenhouse-data`.
- Produces:
  - `interface GreenhouseCellRef { x: number; z: number }`, `interface GreenhouseState { lockedCells: GreenhouseCellRef[] }`
  - `GardenState.greenhouse: GreenhouseState`
  - `interface GardenMemberState { discoveredMutations: string[]; analyzedMutations: string[]; chips: Record<string, number>; hasGreenhouse: boolean }`
  - `normalizeGardenMember(raw: unknown): GardenMemberState`
  - `findProfileMember(raw: unknown, profileId: string, uuid: string): Record<string, unknown> | null`
  - `interface MemberResponse { member: GardenMemberState; fetchedAt: string }` (in `api.ts`)
  - `prettifyId(id: string): string` ("cropshot" -> "Cropshot", "sugar_cane" -> "Sugar Cane")

- [ ] **Step 1: Generate the anonymised fixtures**

Run from the repo root (reads the two gitignored captures, writes committed fixtures; the player uuid is replaced):

```bash
node -e '
const fs=require("fs");
const g=JSON.parse(fs.readFileSync("apps/worker/garden.raw.json","utf8"));
g.garden.uuid="00000000000000000000000000000000";
fs.writeFileSync("packages/core/fixtures/garden-response.real.sample.json",JSON.stringify(g,null,2)+"\n");
const p=JSON.parse(fs.readFileSync("apps/worker/profiles.json","utf8"));
const prof=p.profiles.find(x=>x.selected);
const m=prof.members[Object.keys(prof.members)[0]];
const out={garden_player_data:{copper:m.garden_player_data.copper,analyzed_greenhouse_crops:m.garden_player_data.analyzed_greenhouse_crops,discovered_greenhouse_crops:m.garden_player_data.discovered_greenhouse_crops},player_data:{garden_chips:m.player_data.garden_chips},objectives:{place_a_greenhouse:m.objectives.place_a_greenhouse}};
fs.writeFileSync("packages/core/fixtures/member-greenhouse.real.sample.json",JSON.stringify(out,null,2)+"\n");
'
grep -c "<profile-id-fragment>" packages/core/fixtures/garden-response.real.sample.json packages/core/fixtures/member-greenhouse.real.sample.json
```
Expected: both counts `0`. If either is non-zero, remove the uuid before continuing.

- [ ] **Step 2: Write the failing tests**

Create `packages/core/src/member.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import member from "../fixtures/member-greenhouse.real.sample.json";
import { findProfileMember, normalizeGardenMember } from "./member";

describe("normalizeGardenMember", () => {
  it("reads mutation progress, chip levels and the greenhouse flag from the real capture", () => {
    expect(normalizeGardenMember(member)).toEqual({
      discoveredMutations: [
        "ashwreath",
        "shadevine",
        "dead_plant",
        "dustgrain",
        "lonelily",
      ],
      analyzedMutations: ["ashwreath", "shadevine", "dustgrain"],
      chips: { cropshot: 5, quickdraw: 2 },
      hasGreenhouse: true,
    });
  });

  it("returns empty values for missing or malformed data", () => {
    const empty = {
      discoveredMutations: [],
      analyzedMutations: [],
      chips: {},
      hasGreenhouse: false,
    };
    expect(normalizeGardenMember(undefined)).toEqual(empty);
    expect(normalizeGardenMember({})).toEqual(empty);
    expect(
      normalizeGardenMember({
        garden_player_data: { discovered_greenhouse_crops: "x" },
        player_data: { garden_chips: { cropshot: "five", quickdraw: 2 } },
        objectives: { place_a_greenhouse: { status: "ACTIVE" } },
      }),
    ).toEqual({ ...empty, chips: { quickdraw: 2 } });
  });
});

describe("findProfileMember", () => {
  const UUID_PLAIN = "0123456789abcdef0123456789abcdef";
  const UUID_DASHED = "01234567-89ab-cdef-0123-456789abcdef";
  const profiles = {
    profiles: [
      {
        profile_id: "aaaaaaaa-1111-4111-8111-111111111111",
        members: { [UUID_PLAIN]: { marker: "a" } },
      },
      {
        profile_id: "22222222-2222-4222-8222-222222222222",
        members: { [UUID_PLAIN]: { marker: "b" } },
      },
    ],
  };

  it("finds the member of the requested profile for a plain or dashed uuid", () => {
    expect(
      findProfileMember(profiles, "22222222-2222-4222-8222-222222222222", UUID_PLAIN),
    ).toEqual({ marker: "b" });
    expect(
      findProfileMember(profiles, "AAAAAAAA-1111-4111-8111-111111111111", UUID_DASHED),
    ).toEqual({ marker: "a" });
  });

  it("returns null for an unknown profile, a missing member or garbage input", () => {
    expect(findProfileMember(profiles, "nope", UUID_PLAIN)).toBeNull();
    expect(
      findProfileMember(profiles, "22222222-2222-4222-8222-222222222222", "f".repeat(32)),
    ).toBeNull();
    expect(findProfileMember(null, "p", "u")).toBeNull();
    expect(findProfileMember({ profiles: "x" }, "p", "u")).toBeNull();
  });
});
```

(`UUID_DASHED` is the dashed form of `UUID_PLAIN`: `01234567-89ab-cdef-0123-456789abcdef` has the same 32 hex digits `0123456789abcdef0123456789abcdef`.)

Add to `packages/core/src/garden.test.ts` (new imports at the top: `import realGarden from "../fixtures/garden-response.real.sample.json";` and `unwrapGardenResponse` from `./garden`):

```ts
describe("normalizeGarden greenhouse", () => {
  it("reads the locked cells from the real capture", () => {
    const state = normalizeGarden(unwrapGardenResponse(realGarden));
    expect(state.greenhouse.lockedCells).toHaveLength(88);
    expect(state.greenhouse.lockedCells).toContainEqual({ x: 0, z: 0 });
    expect(state.greenhouse.lockedCells).not.toContainEqual({ x: 4, z: 4 });
  });

  it("defaults to no locked cells and drops malformed entries", () => {
    expect(normalizeGarden({}).greenhouse.lockedCells).toEqual([]);
    const state = normalizeGarden({
      greenhouse_slots: [
        { x: 1, z: 2 },
        { x: 1, z: 2 },
        { x: "1", z: 2 },
        { x: 10, z: 0 },
        { x: -1, z: 0 },
        { x: 1.5, z: 0 },
        null,
        { x: 9, z: 9 },
      ],
    });
    expect(state.greenhouse.lockedCells).toEqual([
      { x: 1, z: 2 },
      { x: 9, z: 9 },
    ]);
  });
});
```

Add to `packages/core/src/text.test.ts` (inside the file, with `prettifyId` added to its import from `./text`):

```ts
describe("prettifyId", () => {
  it("title-cases snake_case ids", () => {
    expect(prettifyId("cropshot")).toBe("Cropshot");
    expect(prettifyId("sugar_cane")).toBe("Sugar Cane");
    expect(prettifyId("")).toBe("");
  });
});
```

In the two existing `toEqual` blocks of `garden.test.ts` that end with `visitors: [...]` / `visitors: []` (around lines 48-52 and 74-75), add `greenhouse: { lockedCells: [] },` after the `visitors` line.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @garden-hq/core test -- src/member.test.ts src/garden.test.ts src/text.test.ts`
Expected: FAIL (`./member` missing, `greenhouse` undefined, `prettifyId` not exported).

- [ ] **Step 4: Implement**

In `packages/core/src/types.ts` add above `GardenState`, and add the `greenhouse` field to `GardenState`:

```ts
export interface GreenhouseCellRef {
  x: number;
  z: number;
}

export interface GreenhouseState {
  /** Locked cells of the 10x10 Greenhouse grid (`garden.greenhouse_slots`). */
  lockedCells: GreenhouseCellRef[];
}

export interface GardenMemberState {
  discoveredMutations: string[];
  analyzedMutations: string[];
  /** Chip id -> chip level. */
  chips: Record<string, number>;
  hasGreenhouse: boolean;
}
```

and in `GardenState`, after `visitors`:

```ts
  greenhouse: GreenhouseState;
```

In `packages/core/src/garden.ts` add imports `import { asArray } from "./coerce";` (extend the existing coerce import to `{ asArray, asRecord }`), `import { GREENHOUSE_GRID_SIZE } from "./greenhouse-data";`, add `GreenhouseCellRef, GreenhouseState` to the type import, then add before `normalizeGarden`:

```ts
// VERIFY: `greenhouse_slots` lists LOCKED cells (owner-confirmed 2026-10-06);
// whether it applies to every Greenhouse a player owns is unconfirmed.
function normalizeGreenhouse(raw: unknown): GreenhouseState {
  const lockedCells: GreenhouseCellRef[] = [];
  const seen = new Set<string>();

  for (const entry of asArray(raw)) {
    const cell = asRecord(entry);
    const { x, z } = cell;
    if (
      typeof x !== "number" ||
      typeof z !== "number" ||
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      x < 0 ||
      z < 0 ||
      x >= GREENHOUSE_GRID_SIZE ||
      z >= GREENHOUSE_GRID_SIZE
    ) {
      continue;
    }
    const key = `${x},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lockedCells.push({ x, z });
  }

  return { lockedCells };
}
```

and in the object returned by `normalizeGarden`, after `visitors: normalizeVisitors(data.active_commissions),` add:

```ts
    greenhouse: normalizeGreenhouse(data.greenhouse_slots),
```

Append to `packages/core/src/text.ts`:

```ts
/** "sugar_cane" -> "Sugar Cane". */
export function prettifyId(id: string): string {
  return id
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
```

Create `packages/core/src/member.ts`:

```ts
import { asArray, asNumber, asRecord, asString } from "./coerce";
import type { GardenMemberState } from "./types";

function asStringArray(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string",
  );
}

function normalizeChips(raw: unknown): Record<string, number> {
  const chips: Record<string, number> = {};
  for (const [id, level] of Object.entries(asRecord(raw))) {
    if (typeof level === "number" && Number.isFinite(level)) {
      chips[id] = asNumber(level, 0);
    }
  }
  return chips;
}

/**
 * Greenhouse-related slice of a profile member. Field paths come from a real
 * capture (2026-10-06): `garden_player_data.{discovered,analyzed}_greenhouse_crops`
 * hold mutation ids, `player_data.garden_chips` holds chip levels.
 */
export function normalizeGardenMember(raw: unknown): GardenMemberState {
  const member = asRecord(raw);
  const gardenPlayer = asRecord(member.garden_player_data);
  const objectives = asRecord(member.objectives);

  return {
    discoveredMutations: asStringArray(gardenPlayer.discovered_greenhouse_crops),
    analyzedMutations: asStringArray(gardenPlayer.analyzed_greenhouse_crops),
    chips: normalizeChips(asRecord(member.player_data).garden_chips),
    hasGreenhouse:
      asString(asRecord(objectives.place_a_greenhouse).status) === "COMPLETE",
  };
}

function plainUuid(value: string): string {
  return value.replace(/-/g, "").toLowerCase();
}

// VERIFY: filters `/v2/skyblock/profiles` because the singular
// `/v2/skyblock/profile` endpoint is unverified (data/VERIFY.md).
export function findProfileMember(
  raw: unknown,
  profileId: string,
  uuid: string,
): Record<string, unknown> | null {
  const wanted = plainUuid(profileId);
  const memberKey = plainUuid(uuid);

  for (const entry of asArray(asRecord(raw).profiles)) {
    const profile = asRecord(entry);
    if (plainUuid(asString(profile.profile_id)) !== wanted) continue;
    const member = asRecord(profile.members)[memberKey];
    return typeof member === "object" && member !== null
      ? asRecord(member)
      : null;
  }
  return null;
}
```

Append to `packages/core/src/api.ts` (add `GardenMemberState` to the type import):

```ts
export interface MemberResponse {
  member: GardenMemberState;
  fetchedAt: string;
}
```

Append to `packages/core/src/index.ts`: `export * from "./member";`

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @garden-hq/core test && pnpm --filter @garden-hq/core typecheck`
Expected: PASS. The Worker and web packages will now fail typecheck where they build `GardenState` literals; the only such literals are the ones fixed in later tasks, so only run `core` here.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/core/src/member.ts packages/core/src/member.test.ts packages/core/src/garden.ts packages/core/src/garden.test.ts packages/core/src/text.ts packages/core/src/text.test.ts packages/core/src/types.ts packages/core/src/api.ts
git add packages/core/fixtures/garden-response.real.sample.json packages/core/fixtures/member-greenhouse.real.sample.json packages/core/src/member.ts packages/core/src/member.test.ts packages/core/src/garden.ts packages/core/src/garden.test.ts packages/core/src/text.ts packages/core/src/text.test.ts packages/core/src/types.ts packages/core/src/api.ts packages/core/src/index.ts
git commit -m "feat(core): normalize greenhouse locked cells and member mutation/chip data" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

---

### Task 3: Greenhouse grid logic

**Files:**
- Create: `packages/core/src/greenhouse.ts`
- Test: `packages/core/src/greenhouse.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `GREENHOUSE_CROPS`, `GREENHOUSE_GRID_SIZE`, `BONUS_PERCENT_PER_UNIQUE_CROP`, `MAX_UNIQUE_CROPS`, `MutationDefinition` from `./greenhouse-data`; `GreenhouseCellRef` from `./types`.
- Produces (all re-exported from the core index):
  - `type CellKey = string` (`"x,z"`), `type GreenhouseCells = Readonly<Record<CellKey, string>>` (cell key -> placed crop/mutation id)
  - `cellKey(x: number, z: number): CellKey`, `parseCellKey(key: string): GreenhouseCellRef | null`
  - `unlockedCellKeys(lockedCells: readonly GreenhouseCellRef[]): Set<CellKey>`
  - `blockCells(x, z, size): GreenhouseCellRef[]` (the size x size block whose top-left cell is `(x, z)`; may extend past the grid) and `ringCells(x, z, size): GreenhouseCellRef[]` (the in-grid cells in the one-cell ring around that block: 8 for size 1, 12 for size 2, 16 for size 3; fewer at grid edges)
  - `interface BonusResult { unique: number; counted: number; max: number; percent: number }`, `uniqueCropBonus(cells, unlocked): BonusResult`
  - `neighbourCounts(cells, unlocked, x, z, size?: number /* default 1 */): Map<string, number>` (counts of placed ids on unlocked ring cells)
  - `interface IngredientStatus { id: string; need: number; have: number; placeable: boolean }`
  - `interface RecipeStatus { satisfied: boolean; missing: number; required: number; ingredients: IngredientStatus[] }`
  - `recipeStatus(mutation, cells, unlocked, x, z): RecipeStatus | null` (uses the mutation's own footprint; `null` for special recipes)
  - `interface Candidate { x: number; z: number; status: RecipeStatus }`, `rankCandidateCells(mutation, cells, unlocked): Candidate[]` (anchors are the top-left cell of a free footprint-sized block of unlocked, empty cells)
  - `extraCellsNeeded(mutation, unlocked): number | null` (the minimum number of additional cells that must be unlocked before the mutation can be built anywhere: the locked cells in its footprint block plus any shortfall of unlocked ring cells against the recipe's placeable ingredient total, minimised over every anchor; `0` means it already fits; `null` means it cannot fit anywhere in the grid)

**Model note (inferred, logged in `data/VERIFY.md`):** a recipe's neighbours are the ring of cells around the mutation's footprint block. 27 of the 36 neighbour recipes in `data/mutations.json` have ingredient counts that sum to exactly the ring size for their footprint (8 for 1x1, 12 for 2x2, 16 for 3x3) and none exceeds it, which is why the ring model is used instead of "8 surrounding cells". Special recipes need only their footprint block.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/greenhouse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import realGarden from "../fixtures/garden-response.real.sample.json";
import { normalizeGarden, unwrapGardenResponse } from "./garden";
import {
  blockCells,
  cellKey,
  extraCellsNeeded,
  neighbourCounts,
  parseCellKey,
  rankCandidateCells,
  recipeStatus,
  ringCells,
  uniqueCropBonus,
  unlockedCellKeys,
} from "./greenhouse";
import { ALL_MUTATIONS, getMutation } from "./greenhouse-data";

const OWNER_UNLOCKED = [
  "3,4", "3,5", "4,3", "4,4", "4,5", "4,6",
  "5,3", "5,4", "5,5", "5,6", "6,4", "6,5",
];

const ownerUnlocked = unlockedCellKeys(
  normalizeGarden(unwrapGardenResponse(realGarden)).greenhouse.lockedCells,
);
const allUnlocked = unlockedCellKeys([]);

function mutation(id: string) {
  const found = getMutation(id);
  if (found === undefined) throw new Error(`missing mutation ${id}`);
  return found;
}

describe("cell keys", () => {
  it("round-trips and rejects bad keys", () => {
    expect(cellKey(3, 4)).toBe("3,4");
    expect(parseCellKey("3,4")).toEqual({ x: 3, z: 4 });
    expect(parseCellKey("10,0")).toBeNull();
    expect(parseCellKey("a,b")).toBeNull();
    expect(parseCellKey("3,4,5")).toBeNull();
  });
});

describe("unlockedCellKeys", () => {
  it("is the full 10x10 grid when nothing is locked", () => {
    expect(allUnlocked.size).toBe(100);
  });

  it("is the owner's 12 centre cells for the real capture", () => {
    expect([...ownerUnlocked].sort()).toEqual([...OWNER_UNLOCKED].sort());
  });
});

describe("blockCells and ringCells", () => {
  it("returns the footprint block from its top-left cell", () => {
    expect(blockCells(4, 4, 2)).toEqual([
      { x: 4, z: 4 },
      { x: 5, z: 4 },
      { x: 4, z: 5 },
      { x: 5, z: 5 },
    ]);
  });

  it("returns an 8/12/16-cell ring in the middle of the grid", () => {
    expect(ringCells(4, 4, 1)).toHaveLength(8);
    expect(ringCells(4, 4, 2)).toHaveLength(12);
    expect(ringCells(4, 4, 3)).toHaveLength(16);
  });

  it("never includes block cells and clips to the grid", () => {
    const ring = ringCells(4, 4, 2).map((c) => cellKey(c.x, c.z));
    for (const block of blockCells(4, 4, 2)) {
      expect(ring).not.toContain(cellKey(block.x, block.z));
    }
    expect(ringCells(0, 0, 1)).toHaveLength(3);
    expect(ringCells(9, 9, 1)).toHaveLength(3);
    expect(ringCells(0, 4, 1)).toHaveLength(5);
  });
});

describe("uniqueCropBonus", () => {
  it("counts distinct crops at 3% each", () => {
    expect(
      uniqueCropBonus({ "4,4": "wheat", "4,5": "carrot", "5,4": "wheat" }, ownerUnlocked),
    ).toEqual({ unique: 2, counted: 2, max: 12, percent: 6 });
  });

  it("ignores locked cells, dead plants and mutations", () => {
    expect(
      uniqueCropBonus(
        { "0,0": "wheat", "4,4": "dead_plant", "4,5": "dustgrain", "5,4": "potato" },
        ownerUnlocked,
      ),
    ).toEqual({ unique: 1, counted: 1, max: 12, percent: 3 });
  });

  it("caps at 12 unique crops (36%)", () => {
    const ids = [
      "wheat", "carrot", "potato", "pumpkin", "melon", "cactus", "sugar_cane",
      "cocoa_beans", "red_mushroom", "brown_mushroom", "nether_wart",
      "sunflower", "moonflower", "wild_rose", "fermento",
    ];
    const cells = Object.fromEntries(ids.map((id, i) => [cellKey(i % 10, Math.floor(i / 10)), id]));
    expect(uniqueCropBonus(cells, allUnlocked)).toEqual({
      unique: 15,
      counted: 12,
      max: 12,
      percent: 36,
    });
  });
});

describe("neighbourCounts", () => {
  it("counts the surrounding unlocked cells only", () => {
    const cells = { "4,3": "wheat", "5,3": "wheat", "3,3": "wheat", "5,5": "carrot" };
    // (3,3) is locked for the owner, so it does not count.
    const counts = neighbourCounts(cells, ownerUnlocked, 4, 4);
    expect(counts.get("wheat")).toBe(2);
    expect(counts.get("carrot")).toBe(1);
  });

  it("uses the ring around a larger footprint and ignores the block itself", () => {
    const counts = neighbourCounts({ "4,4": "wheat", "6,6": "carrot" }, allUnlocked, 4, 4, 2);
    expect(counts.get("carrot")).toBe(1);
    expect(counts.has("wheat")).toBe(false);
  });
});

describe("recipeStatus and rankCandidateCells", () => {
  const dustgrain = mutation("dustgrain");

  it("reports have/need per ingredient and satisfaction", () => {
    const cells = { "4,3": "wheat", "5,3": "wheat" };
    expect(recipeStatus(dustgrain, cells, ownerUnlocked, 4, 4)).toEqual({
      satisfied: true,
      missing: 0,
      required: 2,
      ingredients: [{ id: "wheat", need: 2, have: 2, placeable: true }],
    });
    expect(recipeStatus(dustgrain, { "4,3": "wheat" }, ownerUnlocked, 4, 4)).toMatchObject({
      satisfied: false,
      missing: 1,
    });
  });

  it("excludes non-placeable ingredients (fire) from satisfaction", () => {
    const status = recipeStatus(
      mutation("ashwreath"),
      { "4,3": "nether_wart", "5,3": "nether_wart" },
      ownerUnlocked,
      4,
      4,
    );
    expect(status?.satisfied).toBe(true);
    expect(status?.required).toBe(2);
    expect(status?.ingredients.find((i) => i.id === "fire")?.placeable).toBe(false);
  });

  it("checks a 2x2 mutation against the 12-cell ring", () => {
    const noctilume = mutation("noctilume");
    const ring = ringCells(4, 4, 2);
    const cells: Record<string, string> = {};
    ring.forEach((c, i) => {
      cells[cellKey(c.x, c.z)] = i < 6 ? "duskbloom" : "lonelily";
    });
    expect(recipeStatus(noctilume, cells, allUnlocked, 4, 4)).toMatchObject({
      satisfied: true,
      missing: 0,
      required: 12,
    });
  });

  it("returns null for special recipes and no candidates", () => {
    const lonelily = mutation("lonelily");
    expect(recipeStatus(lonelily, {}, ownerUnlocked, 4, 4)).toBeNull();
    expect(rankCandidateCells(lonelily, {}, ownerUnlocked)).toEqual([]);
  });

  it("ranks empty unlocked cells by missing ingredients, then row, then column", () => {
    const cells = { "4,3": "wheat", "5,3": "wheat" };
    const ranked = rankCandidateCells(dustgrain, cells, ownerUnlocked);
    expect(ranked.some((c) => cellKey(c.x, c.z) === "4,3")).toBe(false);
    expect(ranked).toHaveLength(10);
    expect(ranked[0]?.status.satisfied).toBe(true);
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1];
      const b = ranked[i];
      if (a === undefined || b === undefined) throw new Error("hole");
      expect(a.status.missing).toBeLessThanOrEqual(b.status.missing);
    }
  });

  it("only offers anchors whose whole footprint block is unlocked and empty", () => {
    const noctilume = mutation("noctilume");
    // The owner's unlocked area holds five 2x2 blocks.
    const owner = rankCandidateCells(noctilume, {}, ownerUnlocked);
    expect(owner.map((c) => cellKey(c.x, c.z)).sort()).toEqual(
      ["3,4", "4,3", "4,4", "4,5", "5,4"].sort(),
    );
    const open = rankCandidateCells(noctilume, {}, allUnlocked);
    expect(open).toHaveLength(81);
    expect(open.every((c) => c.x <= 8 && c.z <= 8)).toBe(true);
    // An occupied cell removes every block that contains it; (4,5) and (5,4) do not contain (4,4).
    const blocked = rankCandidateCells(noctilume, { "4,4": "wheat" }, ownerUnlocked);
    expect(blocked.map((c) => cellKey(c.x, c.z)).sort()).toEqual(["4,5", "5,4"]);
  });
});

describe("extraCellsNeeded on the owner's 12 unlocked cells", () => {
  const needs = (id: string, unlocked = ownerUnlocked) =>
    extraCellsNeeded(mutation(id), unlocked);

  it("is 0 for recipes that already fit", () => {
    for (const id of ["dustgrain", "ashwreath", "witherbloom", "soggybud", "lonelily", "shellfruit", "jerryflower"]) {
      expect(needs(id)).toBe(0);
    }
  });

  it("is 1 for full-ring 1x1 recipes (the best cell has 7 of 8 ring cells unlocked)", () => {
    for (const id of ["coalroot", "thornshade", "chorus_fruit", "timestalk"]) {
      expect(needs(id)).toBe(1);
    }
  });

  it("counts footprint cells and ring shortfall for bigger mutations", () => {
    expect(needs("godseed")).toBe(1); // a 3x3 block with 8 of 9 cells unlocked
    expect(needs("noctilume")).toBe(4);
    expect(needs("plantboy_advance")).toBe(4);
    expect(needs("snoozling")).toBe(13);
  });

  it("is 0 for every mutation once the whole grid is unlocked", () => {
    for (const m of ALL_MUTATIONS) {
      expect(extraCellsNeeded(m, allUnlocked)).toBe(0);
    }
  });

  it("is never negative", () => {
    for (const m of ALL_MUTATIONS) {
      expect(extraCellsNeeded(m, ownerUnlocked) ?? 0).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @garden-hq/core test -- src/greenhouse.test.ts`
Expected: FAIL (cannot resolve `./greenhouse`).

- [ ] **Step 3: Implement `packages/core/src/greenhouse.ts`**

```ts
import {
  BONUS_PERCENT_PER_UNIQUE_CROP,
  GREENHOUSE_CROPS,
  GREENHOUSE_GRID_SIZE,
  MAX_UNIQUE_CROPS,
  type MutationDefinition,
} from "./greenhouse-data";
import type { GreenhouseCellRef } from "./types";

/** `"x,z"` with x the column and z the row, both 0..9. */
export type CellKey = string;
/** Cell key -> placed crop or mutation id. Absent key = empty cell. */
export type GreenhouseCells = Readonly<Record<CellKey, string>>;

export function cellKey(x: number, z: number): CellKey {
  return `${x},${z}`;
}

export function parseCellKey(key: string): GreenhouseCellRef | null {
  const match = /^(\d+),(\d+)$/.exec(key);
  if (match === null) return null;
  const x = Number(match[1]);
  const z = Number(match[2]);
  return x < GREENHOUSE_GRID_SIZE && z < GREENHOUSE_GRID_SIZE ? { x, z } : null;
}

function inGrid(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < GREENHOUSE_GRID_SIZE && z < GREENHOUSE_GRID_SIZE;
}

/** Unlocked cells = the full grid minus the API's locked list. */
export function unlockedCellKeys(
  lockedCells: readonly GreenhouseCellRef[],
): Set<CellKey> {
  const locked = new Set(lockedCells.map((cell) => cellKey(cell.x, cell.z)));
  const unlocked = new Set<CellKey>();
  for (let z = 0; z < GREENHOUSE_GRID_SIZE; z++) {
    for (let x = 0; x < GREENHOUSE_GRID_SIZE; x++) {
      const key = cellKey(x, z);
      if (!locked.has(key)) unlocked.add(key);
    }
  }
  return unlocked;
}

/** The size x size block with top-left cell (x, z). May extend past the grid. */
export function blockCells(
  x: number,
  z: number,
  size: number,
): GreenhouseCellRef[] {
  const cells: GreenhouseCellRef[] = [];
  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) cells.push({ x: x + dx, z: z + dz });
  }
  return cells;
}

// VERIFY: a recipe's neighbours are the ring around the mutation's footprint
// (8 / 12 / 16 cells for 1x1 / 2x2 / 3x3). Inferred: 27 of 36 recipes sum to
// exactly the ring size for their footprint and none exceeds it. Whether extra
// non-recipe neighbours are allowed is unconfirmed (data/VERIFY.md).
/** In-grid cells in the one-cell ring around the block with top-left (x, z). */
export function ringCells(
  x: number,
  z: number,
  size: number,
): GreenhouseCellRef[] {
  const cells: GreenhouseCellRef[] = [];
  for (let dz = -1; dz <= size; dz++) {
    for (let dx = -1; dx <= size; dx++) {
      const inBlock = dx >= 0 && dx < size && dz >= 0 && dz < size;
      if (!inBlock && inGrid(x + dx, z + dz)) cells.push({ x: x + dx, z: z + dz });
    }
  }
  return cells;
}

const BONUS_CROP_IDS = new Set(
  GREENHOUSE_CROPS.filter((crop) => crop.countsForBonus).map((crop) => crop.id),
);

export interface BonusResult {
  /** Distinct bonus-eligible crops placed on unlocked cells. */
  unique: number;
  /** `unique` capped at the maximum. */
  counted: number;
  max: number;
  percent: number;
}

// VERIFY: whether the bonus is per Greenhouse or global, and which crops count,
// is unconfirmed (data/VERIFY.md). Computed per Greenhouse here.
export function uniqueCropBonus(
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
): BonusResult {
  const seen = new Set<string>();
  for (const [key, id] of Object.entries(cells)) {
    if (unlocked.has(key) && BONUS_CROP_IDS.has(id)) seen.add(id);
  }
  const counted = Math.min(seen.size, MAX_UNIQUE_CROPS);
  return {
    unique: seen.size,
    counted,
    max: MAX_UNIQUE_CROPS,
    percent: counted * BONUS_PERCENT_PER_UNIQUE_CROP,
  };
}

export function neighbourCounts(
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
  x: number,
  z: number,
  size = 1,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ring of ringCells(x, z, size)) {
    const key = cellKey(ring.x, ring.z);
    if (!unlocked.has(key)) continue;
    const id = cells[key];
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface IngredientStatus {
  id: string;
  need: number;
  have: number;
  placeable: boolean;
}

export interface RecipeStatus {
  satisfied: boolean;
  /** Missing placeable ingredient units. */
  missing: number;
  /** Total placeable ingredient units the recipe needs. */
  required: number;
  ingredients: IngredientStatus[];
}

/** Null for special (text-only) recipes, which are not checked. */
export function recipeStatus(
  mutation: MutationDefinition,
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
  x: number,
  z: number,
): RecipeStatus | null {
  if (mutation.recipe.kind !== "neighbours") return null;

  const counts = neighbourCounts(cells, unlocked, x, z, mutation.growth.footprint);
  let missing = 0;
  let required = 0;
  const ingredients = mutation.recipe.ingredients.map((ingredient) => {
    const have = counts.get(ingredient.id) ?? 0;
    if (ingredient.placeable) {
      required += ingredient.count;
      missing += Math.max(0, ingredient.count - have);
    }
    return {
      id: ingredient.id,
      need: ingredient.count,
      have,
      placeable: ingredient.placeable,
    };
  });

  return { satisfied: missing === 0, missing, required, ingredients };
}

export interface Candidate {
  x: number;
  z: number;
  status: RecipeStatus;
}

/** Anchors (top-left cells) of free, fully unlocked footprint blocks, closest to the recipe first. */
export function rankCandidateCells(
  mutation: MutationDefinition,
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
): Candidate[] {
  const size = mutation.growth.footprint;
  const candidates: Candidate[] = [];
  for (const key of unlocked) {
    const ref = parseCellKey(key);
    if (ref === null) continue;
    const free = blockCells(ref.x, ref.z, size).every((cell) => {
      const cellKeyValue = cellKey(cell.x, cell.z);
      return inGrid(cell.x, cell.z) && unlocked.has(cellKeyValue) && !(cellKeyValue in cells);
    });
    if (!free) continue;
    const status = recipeStatus(mutation, cells, unlocked, ref.x, ref.z);
    if (status === null) return [];
    candidates.push({ ...ref, status });
  }
  return candidates.sort(
    (a, b) => a.status.missing - b.status.missing || a.z - b.z || a.x - b.x,
  );
}

/**
 * Minimum number of extra cells that must be unlocked before the mutation can
 * be built anywhere: locked cells in its footprint block plus the shortfall of
 * unlocked ring cells against the recipe's placeable ingredient total, taken at
 * the best anchor. 0 = already fits; null = cannot fit anywhere in the grid.
 * Special recipes need only their footprint block.
 */
export function extraCellsNeeded(
  mutation: MutationDefinition,
  unlocked: ReadonlySet<CellKey>,
): number | null {
  const size = mutation.growth.footprint;
  const required =
    mutation.recipe.kind === "special"
      ? 0
      : mutation.recipe.ingredients
          .filter((ingredient) => ingredient.placeable)
          .reduce((sum, ingredient) => sum + ingredient.count, 0);

  let best: number | null = null;
  for (let z = 0; z + size <= GREENHOUSE_GRID_SIZE; z++) {
    for (let x = 0; x + size <= GREENHOUSE_GRID_SIZE; x++) {
      const ring = ringCells(x, z, size);
      if (ring.length < required) continue;
      const lockedInBlock = blockCells(x, z, size).filter(
        (cell) => !unlocked.has(cellKey(cell.x, cell.z)),
      ).length;
      const unlockedInRing = ring.filter((cell) =>
        unlocked.has(cellKey(cell.x, cell.z)),
      ).length;
      const extra = lockedInBlock + Math.max(0, required - unlockedInRing);
      if (best === null || extra < best) best = extra;
    }
  }
  return best;
}
```

Append to `packages/core/src/index.ts`: `export * from "./greenhouse";`

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm exec prettier --write packages/core/src/greenhouse.ts packages/core/src/greenhouse.test.ts && pnpm --filter @garden-hq/core test && pnpm --filter @garden-hq/core typecheck && pnpm exec eslint packages/core`
Expected: PASS. The `extraCellsNeeded` expectations (0 / 1 / 1 for Godseed / 4 / 4 / 13) were computed by brute force over the owner's real unlocked cells; if one fails, recheck the ring/block code rather than the number, and report the discrepancy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/greenhouse.ts packages/core/src/greenhouse.test.ts packages/core/src/index.ts
git commit -m "feat(core): greenhouse grid logic (unlocked cells, bonus, ring recipes, extra cells needed)" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

---

### Task 4: Worker `/api/member` route

**Files:**
- Create: `apps/worker/src/routes/member.ts`
- Test: `apps/worker/src/routes/member.test.ts`
- Modify: `apps/worker/src/app.ts`, `apps/worker/README.md`, `apps/worker/test/helpers.ts` (only if a `GardenState` literal there fails typecheck; see Step 5)

**Interfaces:**
- Consumes: `normalizeGardenMember`, `findProfileMember` from `@garden-hq/core`; `cached`, `enforceRateLimit`, `parseUuid`, `AppError`, `ClientFactory` (`clientFor(env).profiles(uuid)`), `AppDeps`.
- Produces: `memberRoute(deps: AppDeps, clientFor: ClientFactory): Hono<{ Bindings: Env }>` mounted at `GET /api/member?profile=<profileId>&uuid=<mcUuid>` returning `{ member: GardenMemberState, fetchedAt: string }` with `Cache-Control: no-store`; errors `bad_request` (400, invalid uuid) and `no_garden` (404, profile or member not found).

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/routes/member.test.ts`:

```ts
import { normalizeGardenMember } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import member from "../../../../packages/core/fixtures/member-greenhouse.real.sample.json";
import {
  PROFILES_ROUTE,
  START_ISO,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

const PROFILE = "33333333-3333-3333-3333-333333333333";
const UUID = "11111111-1111-1111-1111-111111111111";
const UUID_PLAIN = UUID.replace(/-/g, "");

function routes(profiles: unknown) {
  return happyRoutes({
    [PROFILES_ROUTE]: () => json({ success: true, profiles }),
  });
}

function harness(profiles: unknown = [
  { profile_id: PROFILE, members: { [UUID_PLAIN]: member } },
]) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes(profiles));
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("GET /api/member", () => {
  it("returns the normalized member subset with fetchedAt", async () => {
    const { get } = harness();

    const res = await get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      member: normalizeGardenMember(member),
      fetchedAt: START_ISO,
    });
  });

  it("accepts a plain (undashed) uuid", async () => {
    const { get } = harness();
    const res = await get(`/api/member?profile=${PROFILE}&uuid=${UUID_PLAIN}`);
    expect(res.status).toBe(200);
  });

  it("rejects a malformed profile or uuid with bad_request", async () => {
    const { get } = harness();
    const badProfile = await get(`/api/member?profile=nope&uuid=${UUID}`);
    expect(badProfile.status).toBe(400);
    expect(await code(badProfile)).toBe("bad_request");
    const badUuid = await get(`/api/member?profile=${PROFILE}`);
    expect(badUuid.status).toBe(400);
  });

  it("returns no_garden when the profile or member is absent", async () => {
    const other = "44444444-4444-4444-4444-444444444444";
    const noProfile = await harness([
      { profile_id: other, members: { [UUID_PLAIN]: member } },
    ]).get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    expect(noProfile.status).toBe(404);
    expect(await code(noProfile)).toBe("no_garden");

    const noMember = await harness([
      { profile_id: PROFILE, members: { [other.replace(/-/g, "")]: member } },
    ]).get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    expect(await code(noMember)).toBe("no_garden");
  });

  it("serves the second request from the KV cache", async () => {
    const { get, net } = harness();
    await get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    await get(`/api/member?profile=${PROFILE}&uuid=${UUID}`);
    expect(net.calls.filter((c) => c === PROFILES_ROUTE)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- src/routes/member.test.ts`
Expected: FAIL (404 from the app's `not_found`, since the route does not exist).

- [ ] **Step 3: Implement the route**

Create `apps/worker/src/routes/member.ts`:

```ts
import { findProfileMember, normalizeGardenMember } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";
import { enforceRateLimit } from "../ratelimit";
import { parseUuid } from "../validate";

const CACHE_TTL_SECONDS = 60;

export function memberRoute(
  deps: AppDeps,
  clientFor: ClientFactory,
): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/member", async (c) => {
    const profileId = parseUuid(c.req.query("profile"));
    const uuid = parseUuid(c.req.query("uuid"));
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);

    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `member:${profileId}:${uuid}`,
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        const member = findProfileMember(
          await clientFor(c.env).profiles(uuid),
          profileId,
          uuid,
        );
        if (member === null) {
          throw new AppError(
            "no_garden",
            "No member data found for that profile",
          );
        }
        return normalizeGardenMember(member);
      },
    );

    c.header("Cache-Control", "no-store");
    return c.json({
      member: value,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  });

  return route;
}
```

In `apps/worker/src/app.ts` add `import { memberRoute } from "./routes/member";` (keep imports sorted: after `mayor`'s import is not required, but place it after `linkRoute`'s import) and mount it after the garden route:

```ts
  app.route("/api", memberRoute(deps, clientFor));
```

In `apps/worker/README.md` change the routes line to:
`Hono API on Cloudflare Workers. Routes: \`GET /api/link?name=\`, \`/api/garden?profile=\`, \`/api/member?profile=&uuid=\`, \`/api/contests\`, \`/api/mayor\`, \`/health\`.`
and the Limits line to `Per-IP 10 req/min (shared by link + garden + member); ...`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm exec prettier --write apps/worker/src/routes/member.ts apps/worker/src/routes/member.test.ts && pnpm --filter @garden-hq/worker test && pnpm --filter @garden-hq/worker typecheck`
Expected: PASS. If typecheck fails in an existing worker test because it builds a `GardenState` literal missing `greenhouse`, add `greenhouse: { lockedCells: [] }` to that literal (the earlier search found no such literals in `apps/worker`, so this is only a safeguard).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/member.ts apps/worker/src/routes/member.test.ts apps/worker/src/app.ts apps/worker/README.md
git commit -m "feat(worker): GET /api/member returns greenhouse mutation progress and chip levels" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

Note: `apps/worker/src/app.ts` already has uncommitted changes in the working tree from earlier work. `git add apps/worker/src/app.ts` will stage those too. Run `git diff apps/worker/src/app.ts` first; if it contains changes unrelated to this task, stage only this task's hunk with `git add -p apps/worker/src/app.ts`.

---

### Task 5: Web API client, query hook and storage

**Files:**
- Modify: `apps/web/src/api/client.ts`, `apps/web/src/api/client.test.ts`, `apps/web/src/state/queries.ts`, `apps/web/src/state/storage.ts`, `apps/web/src/state/storage.test.ts`

**Interfaces:**
- Consumes: `MemberResponse`, `getPlot`, `isPlaceableId` from `@garden-hq/core`.
- Produces:
  - `api.member(profileId: string, uuid: string): Promise<MemberResponse>`
  - `useMember(profileId: string | null, uuid: string | null)` (TanStack query, refetch every 5 min, disabled until both are set)
  - From `storage.ts`: `const MAX_GREENHOUSES = 3`; `interface GreenhouseSave { cells: Record<string, string>; lastWateredAt: number | null }`; `StoredData.greenhouses: Record<string, GreenhouseSave>` (key present = plot is marked as Greenhouse); on `GardenStorage`: `markGreenhouse(plotId: string): boolean` (false when at max, or unknown plot), `unmarkGreenhouse(plotId: string): void`, `setGreenhouseCell(plotId: string, cellKey: string, contentId: string | null): void`, `markGreenhouseWatered(plotId: string, at: number): void`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/api/client.test.ts`, inside the `describe("api client", ...)` block:

```ts
  it("GETs /api/member with profile and uuid", async () => {
    const body = {
      member: {
        discoveredMutations: ["dustgrain"],
        analyzedMutations: [],
        chips: { cropshot: 5 },
        hasGreenhouse: true,
      },
      fetchedAt: "2026-10-06T10:00:00.000Z",
    };
    const { client, fetchFn } = clientWith(jsonResponse(body));
    await expect(client.member("p1", "u1")).resolves.toEqual(body);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://api.test/api/member?profile=p1&uuid=u1",
    );
  });
```

In `apps/web/src/state/storage.test.ts`: in the two existing `toEqual` blocks that list `link: null, assignments: {}, timeZone: DEFAULT_TIME_ZONE` (the "starts empty" test and the "ignores corrupt or wrongly-shaped stored JSON" test), add `greenhouses: {},` after `assignments: {},`. Then add a new `describe` at the end of the file:

```ts
describe("greenhouse storage", () => {
  it("marks a plot, defaulting to an empty unwatered grid, and is idempotent", () => {
    const s = createGardenStorage(null);
    expect(s.getSnapshot().greenhouses).toEqual({});
    expect(s.markGreenhouse("beginner_3")).toBe(true);
    expect(s.getSnapshot().greenhouses).toEqual({
      beginner_3: { cells: {}, lastWateredAt: null },
    });
    s.setGreenhouseCell("beginner_3", "4,4", "wheat");
    expect(s.markGreenhouse("beginner_3")).toBe(true);
    expect(s.getSnapshot().greenhouses.beginner_3?.cells).toEqual({ "4,4": "wheat" });
  });

  it("allows at most 3 Greenhouses and rejects unknown plots", () => {
    const s = createGardenStorage(null);
    expect(s.markGreenhouse("beginner_1")).toBe(true);
    expect(s.markGreenhouse("beginner_2")).toBe(true);
    expect(s.markGreenhouse("beginner_3")).toBe(true);
    expect(s.markGreenhouse("beginner_4")).toBe(false);
    expect(s.markGreenhouse("not_a_plot")).toBe(false);
    expect(Object.keys(s.getSnapshot().greenhouses)).toHaveLength(3);
  });

  it("sets and clears cells, ignoring unmarked plots, bad keys and unknown ids", () => {
    const s = createGardenStorage(null);
    s.setGreenhouseCell("beginner_3", "4,4", "wheat"); // not marked
    expect(s.getSnapshot().greenhouses).toEqual({});
    s.markGreenhouse("beginner_3");
    s.setGreenhouseCell("beginner_3", "4,4", "wheat");
    s.setGreenhouseCell("beginner_3", "bad", "wheat");
    s.setGreenhouseCell("beginner_3", "4,5", "not_a_crop");
    expect(s.getSnapshot().greenhouses.beginner_3?.cells).toEqual({ "4,4": "wheat" });
    s.setGreenhouseCell("beginner_3", "4,4", null);
    expect(s.getSnapshot().greenhouses.beginner_3?.cells).toEqual({});
  });

  it("records the watered time and unmarking removes the Greenhouse", () => {
    const s = createGardenStorage(null);
    s.markGreenhouse("beginner_3");
    s.markGreenhouseWatered("beginner_3", 1_000);
    expect(s.getSnapshot().greenhouses.beginner_3?.lastWateredAt).toBe(1_000);
    s.unmarkGreenhouse("beginner_3");
    expect(s.getSnapshot().greenhouses).toEqual({});
  });

  it("persists, reloads and sanitises stored greenhouses; clearAll wipes them", () => {
    const backing = fakeBacking();
    const s = createGardenStorage(backing);
    s.markGreenhouse("beginner_3");
    s.setGreenhouseCell("beginner_3", "4,4", "wheat");
    s.markGreenhouseWatered("beginner_3", 5);
    expect(createGardenStorage(backing).getSnapshot().greenhouses).toEqual({
      beginner_3: { cells: { "4,4": "wheat" }, lastWateredAt: 5 },
    });

    const corrupt = createGardenStorage(
      fakeBacking({
        "garden-hq:v1": JSON.stringify({
          greenhouses: {
            beginner_3: { cells: { "4,4": "wheat", x: "wheat", "4,5": 7 }, lastWateredAt: "soon" },
            not_a_plot: { cells: {}, lastWateredAt: null },
            beginner_1: 5,
          },
        }),
      }),
    );
    expect(corrupt.getSnapshot().greenhouses).toEqual({
      beginner_3: { cells: { "4,4": "wheat" }, lastWateredAt: null },
    });

    s.clearAll();
    expect(s.getSnapshot().greenhouses).toEqual({});
  });

  it("loads old saves without a greenhouses field", () => {
    const s = createGardenStorage(
      fakeBacking({ "garden-hq:v1": JSON.stringify({ assignments: { beginner_1: "wheat" } }) }),
    );
    expect(s.getSnapshot().greenhouses).toEqual({});
    expect(s.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @garden-hq/web test -- src/api/client.test.ts src/state/storage.test.ts`
Expected: FAIL (`client.member` and the storage methods are missing).

- [ ] **Step 3: Implement client and query hook**

In `apps/web/src/api/client.ts` add `MemberResponse` to the type import from `@garden-hq/core`, and add to the object returned by `createApiClient` (after `garden`):

```ts
    member: (profileId: string, uuid: string) =>
      get<MemberResponse>("/api/member", { profile: profileId, uuid }),
```

In `apps/web/src/state/queries.ts` add after `useGarden`:

```ts
export function useMember(profileId: string | null, uuid: string | null) {
  return useQuery({
    queryKey: ["member", profileId, uuid],
    queryFn: () => api.member(profileId as string, uuid as string),
    enabled: profileId !== null && uuid !== null,
    refetchInterval: 5 * MINUTE,
    staleTime: 5 * MINUTE,
    // Shares the Worker's per-IP limit with link + garden.
    refetchOnWindowFocus: false,
  });
}
```

- [ ] **Step 4: Implement storage**

In `apps/web/src/state/storage.ts`:

1. Change the first import to `import { getPlot, isPlaceableId, type ProfileSummary } from "@garden-hq/core";`
2. After `StoredLink` add:

```ts
export const MAX_GREENHOUSES = 3;

export interface GreenhouseSave {
  /** Cell key "x,z" -> placed crop or mutation id. */
  cells: Record<string, string>;
  /** Epoch ms of the player's last "I watered it" press, or null. */
  lastWateredAt: number | null;
}
```

3. Add `greenhouses: Record<string, GreenhouseSave>;` to `StoredData` (after `assignments`) and `greenhouses: {},` to `EMPTY` (after `assignments: {},`).
4. Add to the `GardenStorage` interface:

```ts
  /** Marks a plot as a Greenhouse. False if at the maximum or the plot is unknown. */
  markGreenhouse(plotId: string): boolean;
  unmarkGreenhouse(plotId: string): void;
  setGreenhouseCell(
    plotId: string,
    cellKey: string,
    contentId: string | null,
  ): void;
  markGreenhouseWatered(plotId: string, at: number): void;
```

5. Add before `load`:

```ts
const CELL_KEY_RE = /^\d,\d$/;

function parseGreenhouses(v: unknown): Record<string, GreenhouseSave> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, GreenhouseSave> = {};
  for (const [plotId, raw] of Object.entries(v)) {
    if (Object.keys(out).length >= MAX_GREENHOUSES) break;
    if (getPlot(plotId) === undefined) continue;
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const cells: Record<string, string> = {};
    if (
      typeof r.cells === "object" &&
      r.cells !== null &&
      !Array.isArray(r.cells)
    ) {
      for (const [key, id] of Object.entries(r.cells)) {
        if (CELL_KEY_RE.test(key) && typeof id === "string" && isPlaceableId(id)) {
          cells[key] = id;
        }
      }
    }
    out[plotId] = {
      cells,
      lastWateredAt:
        typeof r.lastWateredAt === "number" && Number.isFinite(r.lastWateredAt)
          ? r.lastWateredAt
          : null,
    };
  }
  return out;
}
```

6. In `load`, add `greenhouses: parseGreenhouses(d.greenhouses),` after the `assignments` line of the returned object.
7. In the object returned by `createGardenStorage`, add before `setTimeZone`:

```ts
    markGreenhouse(plotId) {
      if (plotId in data.greenhouses) return true;
      if (
        getPlot(plotId) === undefined ||
        Object.keys(data.greenhouses).length >= MAX_GREENHOUSES
      ) {
        return false;
      }
      commit({
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [plotId]: { cells: {}, lastWateredAt: null },
        },
      });
      return true;
    },
    unmarkGreenhouse(plotId) {
      if (!(plotId in data.greenhouses)) return;
      const greenhouses = { ...data.greenhouses };
      delete greenhouses[plotId];
      commit({ ...data, greenhouses });
    },
    setGreenhouseCell(plotId, cellKey, contentId) {
      const save = data.greenhouses[plotId];
      if (save === undefined || !CELL_KEY_RE.test(cellKey)) return;
      if (contentId !== null && !isPlaceableId(contentId)) return;
      const cells = { ...save.cells };
      if (contentId === null) delete cells[cellKey];
      else cells[cellKey] = contentId;
      commit({
        ...data,
        greenhouses: { ...data.greenhouses, [plotId]: { ...save, cells } },
      });
    },
    markGreenhouseWatered(plotId, at) {
      const save = data.greenhouses[plotId];
      if (save === undefined) return;
      commit({
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [plotId]: { ...save, lastWateredAt: at },
        },
      });
    },
```

The cell-key regex `^\d,\d$` is deliberately single-digit (grid is 0..9); if the grid size in `data/greenhouse-crops.json` ever grows past 10, widen it.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm exec prettier --write apps/web/src/api apps/web/src/state && pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck`
Expected: PASS. If typecheck fails in an existing web test or component that builds a `GardenState` literal without `greenhouse`, add `greenhouse: { lockedCells: [] }` (earlier search found none, so this is a safeguard).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts apps/web/src/state/queries.ts apps/web/src/state/storage.ts apps/web/src/state/storage.test.ts
git commit -m "feat(web): member API client, useMember, greenhouse local storage" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

---

### Task 6: Greenhouse tab with grid editor and bonus

**Files:**
- Create: `apps/web/src/test/greenhouseFixtures.ts`, `apps/web/src/viewmodels/greenhouse.ts`, `apps/web/src/greenhouse/GreenhouseGrid.tsx`, `apps/web/src/greenhouse/GreenhousePalette.tsx`, `apps/web/src/greenhouse/BonusBar.tsx`, `apps/web/src/greenhouse/GreenhousePanel.tsx`, `apps/web/src/screens/GreenhouseScreen.tsx`
- Test: `apps/web/src/viewmodels/greenhouse.test.ts`, `apps/web/src/greenhouse/GreenhousePanel.test.tsx`, `apps/web/src/screens/GreenhouseScreen.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/TabBar.tsx`, `apps/web/src/index.css`

**Interfaces:**
- Consumes: `GreenhouseSave` + `useStorage`/`useStoredData`; `useGarden`, `useMember`; core `unlockedCellKeys`, `uniqueCropBonus`, `cellKey`, `GREENHOUSE_GRID_SIZE`, `GREENHOUSE_CROPS`, `ALL_MUTATIONS`, `placeableName`, `GREENHOUSE_UNLOCK_LEVEL`, `getPlot`, `type GardenMemberState`, `type GreenhouseCellRef`, `type BonusResult`.
- Produces:
  - `viewmodels/greenhouse.ts`: `interface GridCell { key: string; x: number; z: number; state: "locked" | "empty" | "filled"; contentId?: string }`, `interface GreenhouseViewModel { rows: GridCell[][]; cells: Record<string, string>; unlocked: Set<string>; bonus: BonusResult }`, `buildGreenhouseViewModel(save: GreenhouseSave, lockedCells: readonly GreenhouseCellRef[]): GreenhouseViewModel`, `swatchColour(id: string): string`, `interface Highlight { kind: "ok" | "near"; missing: number }`, `formatAge(ms: number): string`
  - `GreenhouseGrid` props: `{ rows: GridCell[][]; highlights?: ReadonlyMap<string, Highlight>; onCellTap: (key: string) => void; label: string }`
  - `GreenhousePalette` props: `{ brush: string | undefined; onBrush: (id: string | undefined) => void }` where `""` means eraser, `undefined` means nothing selected
  - `BonusBar` props: `{ bonus: BonusResult }`
  - `GreenhousePanel` props: `{ plotId: string; lockedCells: readonly GreenhouseCellRef[]; member: GardenMemberState | undefined; memberError?: boolean }`
  - Route `/greenhouse` → `GreenhouseScreen`; `TabBar` gets a "Greenhouse" tab after "Home".

- [ ] **Step 1: Shared test constants**

Create `apps/web/src/test/greenhouseFixtures.ts`:

```ts
import {
  GREENHOUSE_GRID_SIZE,
  cellKey,
  type GreenhouseCellRef,
} from "@garden-hq/core";

/** The owner's 12 unlocked cells (owner-confirmed 2026-10-06). */
export const UNLOCKED_KEYS: readonly string[] = [
  "3,4", "3,5", "4,3", "4,4", "4,5", "4,6",
  "5,3", "5,4", "5,5", "5,6", "6,4", "6,5",
];

/** Everything else in the 10x10 grid, as the API's locked-cell list. */
export const LOCKED_CELLS: GreenhouseCellRef[] = (() => {
  const locked: GreenhouseCellRef[] = [];
  for (let z = 0; z < GREENHOUSE_GRID_SIZE; z++) {
    for (let x = 0; x < GREENHOUSE_GRID_SIZE; x++) {
      if (!UNLOCKED_KEYS.includes(cellKey(x, z))) locked.push({ x, z });
    }
  }
  return locked;
})();
```

- [ ] **Step 2: Write the failing view-model tests**

Create `apps/web/src/viewmodels/greenhouse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOCKED_CELLS } from "../test/greenhouseFixtures";
import {
  buildGreenhouseViewModel,
  formatAge,
  swatchColour,
} from "./greenhouse";

describe("buildGreenhouseViewModel", () => {
  it("builds a 10x10 grid of locked/empty/filled cells", () => {
    const vm = buildGreenhouseViewModel(
      { cells: { "4,4": "wheat" }, lastWateredAt: null },
      LOCKED_CELLS,
    );
    expect(vm.rows).toHaveLength(10);
    expect(vm.rows.every((row) => row.length === 10)).toBe(true);
    const at = (x: number, z: number) => vm.rows[z]?.[x];
    expect(at(0, 0)?.state).toBe("locked");
    expect(at(4, 3)?.state).toBe("empty");
    expect(at(4, 4)).toMatchObject({ state: "filled", contentId: "wheat", key: "4,4" });
    expect(vm.unlocked.size).toBe(12);
    expect(vm.cells).toEqual({ "4,4": "wheat" });
  });

  it("drops saved content on cells that are locked and computes the bonus", () => {
    const vm = buildGreenhouseViewModel(
      { cells: { "0,0": "wheat", "4,4": "carrot", "4,5": "potato" }, lastWateredAt: null },
      LOCKED_CELLS,
    );
    expect(vm.rows[0]?.[0]?.state).toBe("locked");
    expect(vm.cells).toEqual({ "4,4": "carrot", "4,5": "potato" });
    expect(vm.bonus).toMatchObject({ unique: 2, percent: 6 });
  });
});

describe("swatchColour", () => {
  it("is deterministic and an hsl colour", () => {
    expect(swatchColour("wheat")).toBe(swatchColour("wheat"));
    expect(swatchColour("wheat")).toMatch(/^hsl\(\d+ 55% 62%\)$/);
    expect(swatchColour("wheat")).not.toBe(swatchColour("carrot"));
  });
});

describe("formatAge", () => {
  it("formats minutes, hours and days", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5 min ago");
    expect(formatAge(119 * 60_000)).toBe("119 min ago");
    expect(formatAge(3 * 3_600_000)).toBe("3 h ago");
    expect(formatAge(50 * 3_600_000)).toBe("2 d ago");
    expect(formatAge(-5)).toBe("just now");
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then implement the view model**

Run: `pnpm --filter @garden-hq/web test -- src/viewmodels/greenhouse.test.ts`
Expected: FAIL (module missing).

Create `apps/web/src/viewmodels/greenhouse.ts`:

```ts
import {
  GREENHOUSE_GRID_SIZE,
  cellKey,
  uniqueCropBonus,
  unlockedCellKeys,
  type BonusResult,
  type GreenhouseCellRef,
} from "@garden-hq/core";
import type { GreenhouseSave } from "../state/storage";

export interface GridCell {
  key: string;
  x: number;
  z: number;
  state: "locked" | "empty" | "filled";
  contentId?: string;
}

export interface GreenhouseViewModel {
  /** rows[z][x] */
  rows: GridCell[][];
  /** Saved content on unlocked cells only. */
  cells: Record<string, string>;
  unlocked: Set<string>;
  bonus: BonusResult;
}

export interface Highlight {
  kind: "ok" | "near";
  missing: number;
}

export function buildGreenhouseViewModel(
  save: GreenhouseSave,
  lockedCells: readonly GreenhouseCellRef[],
): GreenhouseViewModel {
  const unlocked = unlockedCellKeys(lockedCells);
  const cells: Record<string, string> = {};
  for (const [key, id] of Object.entries(save.cells)) {
    if (unlocked.has(key)) cells[key] = id;
  }

  const rows: GridCell[][] = [];
  for (let z = 0; z < GREENHOUSE_GRID_SIZE; z++) {
    const row: GridCell[] = [];
    for (let x = 0; x < GREENHOUSE_GRID_SIZE; x++) {
      const key = cellKey(x, z);
      const contentId = cells[key];
      if (!unlocked.has(key)) row.push({ key, x, z, state: "locked" });
      else if (contentId === undefined) row.push({ key, x, z, state: "empty" });
      else row.push({ key, x, z, state: "filled", contentId });
    }
    rows.push(row);
  }

  return { rows, cells, unlocked, bonus: uniqueCropBonus(cells, unlocked) };
}

export function swatchColour(id: string): string {
  let hue = 0;
  for (const char of id) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hue} 55% 62%)`;
}

export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
```

Run again: Expected PASS.

- [ ] **Step 4: Write the failing panel and screen tests**

Create `apps/web/src/greenhouse/GreenhousePanel.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createGardenStorage } from "../state/storage";
import { LOCKED_CELLS } from "../test/greenhouseFixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { GreenhousePanel } from "./GreenhousePanel";

function setup() {
  const storage = createGardenStorage(null);
  storage.markGreenhouse("beginner_3");
  renderWithProviders(
    <GreenhousePanel
      plotId="beginner_3"
      lockedCells={LOCKED_CELLS}
      member={undefined}
    />,
    { storage },
  );
  return { storage, user: userEvent.setup() };
}

describe("GreenhousePanel", () => {
  it("is titled with the plot and shows locked cells as disabled", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /Plot 4 \(beginner_3\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cell 0,0: locked/ }),
    ).toBeDisabled();
    expect(screen.getAllByText(/expand with Ethereal Vines/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cell 4,4: empty" })).toBeEnabled();
  });

  it("places the selected crop on an unlocked cell and updates the bonus", async () => {
    const { storage, user } = setup();
    expect(screen.getByText(/0\/12 unique crops/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wheat" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,4: empty" }));
    expect(storage.getSnapshot().greenhouses.beginner_3?.cells).toEqual({
      "4,4": "wheat",
    });
    expect(screen.getByRole("button", { name: "Cell 4,4: Wheat" })).toBeInTheDocument();
    expect(screen.getByText(/1\/12 unique crops/)).toBeInTheDocument();
    expect(screen.getByText(/\+3%/)).toBeInTheDocument();
  });

  it("does nothing on a cell tap until a palette entry is chosen, and the eraser clears", async () => {
    const { storage, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cell 4,4: empty" }));
    expect(storage.getSnapshot().greenhouses.beginner_3?.cells).toEqual({});
    await user.click(screen.getByRole("button", { name: "Carrot" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,4: empty" }));
    await user.click(screen.getByRole("button", { name: "Clear cell" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,4: Carrot" }));
    expect(storage.getSnapshot().greenhouses.beginner_3?.cells).toEqual({});
  });
});
```

Create `apps/web/src/screens/GreenhouseScreen.test.tsx`:

```tsx
import { normalizeGarden } from "@garden-hq/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { LOCKED_CELLS } from "../test/greenhouseFixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { GreenhouseScreen } from "./GreenhouseScreen";

const mocks = vi.hoisted(() => ({
  useGarden: vi.fn(),
  useMember: vi.fn(),
}));
vi.mock("../state/queries", () => mocks);

const LINK = {
  name: "Steve",
  uuid: "u1",
  profileId: "p1",
  profiles: [{ profileId: "p1", name: "Apple", selected: true }],
};

function gardenAt(level: number) {
  const garden = normalizeGarden({
    garden_experience: level >= 7 ? 5000 : 0,
    unlocked_plots_ids: ["beginner_3"],
  });
  return { ...garden, greenhouse: { lockedCells: LOCKED_CELLS } };
}

beforeEach(() => {
  mocks.useGarden.mockReset();
  mocks.useMember.mockReset();
  mocks.useMember.mockReturnValue({ data: undefined, isError: false });
});

describe("GreenhouseScreen", () => {
  it("explains how to mark a Greenhouse when none is marked", () => {
    mocks.useGarden.mockReturnValue({ data: { garden: gardenAt(7), fetchedAt: "x" }, isError: false });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByText(/No Greenhouse marked yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /map/i })).toHaveAttribute("href", "/");
  });

  it("renders one panel per marked plot once the garden has loaded", () => {
    mocks.useGarden.mockReturnValue({ data: { garden: gardenAt(7), fetchedAt: "x" }, isError: false });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    storage.markGreenhouse("beginner_3");
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByRole("heading", { name: /Plot 4/ })).toBeInTheDocument();
  });

  it("does not draw a grid before the locked cells are known", () => {
    mocks.useGarden.mockReturnValue({ data: undefined, isError: false });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    storage.markGreenhouse("beginner_3");
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByText(/Loading your Garden/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cell 4,4/ })).toBeNull();
  });

  it("notes the level-7 requirement when below it and no Greenhouse is built", () => {
    mocks.useGarden.mockReturnValue({ data: { garden: gardenAt(1), fetchedAt: "x" }, isError: false });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByText(/unlocks at Garden Level 7/i)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @garden-hq/web test -- src/greenhouse src/screens/GreenhouseScreen.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 5: Implement the components**

Create `apps/web/src/greenhouse/GreenhouseGrid.tsx`:

```tsx
import { placeableName } from "@garden-hq/core";
import { swatchColour, type GridCell, type Highlight } from "../viewmodels/greenhouse";

function abbreviation(id: string): string {
  return placeableName(id).slice(0, 2).toUpperCase();
}

function cellLabel(cell: GridCell, highlight: Highlight | undefined): string {
  const where = `Cell ${cell.x},${cell.z}`;
  if (cell.state === "locked") {
    return `${where}: locked — expand with Ethereal Vines`;
  }
  const content =
    cell.state === "filled" && cell.contentId !== undefined
      ? placeableName(cell.contentId)
      : "empty";
  if (highlight === undefined) return `${where}: ${content}`;
  return highlight.kind === "ok"
    ? `${where}: ${content} (recipe satisfied here)`
    : `${where}: ${content} (recipe missing ${highlight.missing})`;
}

export function GreenhouseGrid({
  rows,
  highlights,
  onCellTap,
  label,
}: {
  rows: GridCell[][];
  highlights?: ReadonlyMap<string, Highlight>;
  onCellTap: (key: string) => void;
  label: string;
}) {
  return (
    <div className="gh-grid" role="group" aria-label={label}>
      {rows.flat().map((cell) => {
        const highlight = highlights?.get(cell.key);
        return (
          <button
            key={cell.key}
            type="button"
            className="gh-cell"
            data-state={cell.state}
            data-hl={highlight?.kind}
            disabled={cell.state === "locked"}
            aria-label={cellLabel(cell, highlight)}
            title={
              cell.state === "locked" ? "Expand with Ethereal Vines" : undefined
            }
            style={
              cell.state === "filled" && cell.contentId !== undefined
                ? { background: swatchColour(cell.contentId) }
                : undefined
            }
            onClick={() => onCellTap(cell.key)}
          >
            {cell.state === "filled" && cell.contentId !== undefined
              ? abbreviation(cell.contentId)
              : null}
          </button>
        );
      })}
    </div>
  );
}
```

Create `apps/web/src/greenhouse/GreenhousePalette.tsx`:

```tsx
import { ALL_MUTATIONS, GREENHOUSE_CROPS } from "@garden-hq/core";

export function GreenhousePalette({
  brush,
  onBrush,
}: {
  /** "" = eraser, undefined = nothing selected. */
  brush: string | undefined;
  onBrush: (id: string | undefined) => void;
}) {
  function toggle(id: string) {
    onBrush(brush === id ? undefined : id);
  }

  return (
    <div className="gh-palette">
      <p className="muted">Pick something, then tap cells to place it.</p>
      <div className="gh-palette-row">
        <button
          type="button"
          aria-pressed={brush === ""}
          onClick={() => toggle("")}
        >
          Clear cell
        </button>
        {GREENHOUSE_CROPS.map((crop) => (
          <button
            key={crop.id}
            type="button"
            aria-pressed={brush === crop.id}
            onClick={() => toggle(crop.id)}
          >
            {crop.name}
          </button>
        ))}
      </div>
      <details>
        <summary>Place a grown mutation</summary>
        <div className="gh-palette-row">
          {ALL_MUTATIONS.map((mutation) => (
            <button
              key={mutation.id}
              type="button"
              aria-pressed={brush === mutation.id}
              onClick={() => toggle(mutation.id)}
            >
              {mutation.name}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
```

Create `apps/web/src/greenhouse/BonusBar.tsx`:

```tsx
import type { BonusResult } from "@garden-hq/core";

export function BonusBar({ bonus }: { bonus: BonusResult }) {
  return (
    <div className="gh-bonus">
      <p>
        <strong>
          {bonus.counted}/{bonus.max} unique crops
        </strong>{" "}
        — yield bonus +{bonus.percent}%
      </p>
      <progress
        value={bonus.counted}
        max={bonus.max}
        aria-label="Unique crop bonus"
      />
      {bonus.unique > bonus.max ? (
        <p className="muted">
          {bonus.unique} different crops placed; the bonus is capped at{" "}
          {bonus.max}.
        </p>
      ) : null}
    </div>
  );
}
```

Create `apps/web/src/greenhouse/GreenhousePanel.tsx`:

```tsx
import type { GardenMemberState, GreenhouseCellRef } from "@garden-hq/core";
import { getPlot } from "@garden-hq/core";
import { useMemo, useState } from "react";
import { useStorage, useStoredData } from "../state/StorageProvider";
import { buildGreenhouseViewModel } from "../viewmodels/greenhouse";
import { BonusBar } from "./BonusBar";
import { GreenhouseGrid } from "./GreenhouseGrid";
import { GreenhousePalette } from "./GreenhousePalette";

export interface GreenhousePanelProps {
  plotId: string;
  lockedCells: readonly GreenhouseCellRef[];
  member: GardenMemberState | undefined;
  memberError?: boolean;
}

export function GreenhousePanel({ plotId, lockedCells }: GreenhousePanelProps) {
  const storage = useStorage();
  const save = useStoredData().greenhouses[plotId];
  const [brush, setBrush] = useState<string | undefined>(undefined);

  const vm = useMemo(
    () =>
      save === undefined ? null : buildGreenhouseViewModel(save, lockedCells),
    [save, lockedCells],
  );

  if (vm === null) return null;

  const plot = getPlot(plotId);
  const title =
    plot === undefined ? plotId : `Plot ${plot.plotNumber} (${plotId})`;

  function onCellTap(key: string) {
    if (brush === undefined) return;
    storage.setGreenhouseCell(plotId, key, brush === "" ? null : brush);
  }

  return (
    <section className="card gh-panel" aria-label={`Greenhouse ${title}`}>
      <h2>Greenhouse — {title}</h2>
      <BonusBar bonus={vm.bonus} />
      <GreenhouseGrid
        rows={vm.rows}
        onCellTap={onCellTap}
        label={`Greenhouse grid, ${title}`}
      />
      <p className="muted">
        Greyed cells are locked: expand with Ethereal Vines.
      </p>
      <GreenhousePalette brush={brush} onBrush={setBrush} />
    </section>
  );
}
```

Create `apps/web/src/screens/GreenhouseScreen.tsx`:

```tsx
import { GREENHOUSE_UNLOCK_LEVEL, getPlot } from "@garden-hq/core";
import { Link, Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { ErrorCard } from "../components/ErrorCard";
import { GreenhousePanel } from "../greenhouse/GreenhousePanel";
import { useGarden, useMember } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";

export function GreenhouseScreen() {
  const { link, greenhouses } = useStoredData();
  const garden = useGarden(link?.profileId ?? null);
  const member = useMember(link?.profileId ?? null, link?.uuid ?? null);

  if (link === null) return <Navigate to="/link" replace />;

  const state = garden.data?.garden;
  const plotIds = Object.keys(greenhouses).sort(
    (a, b) => (getPlot(a)?.plotNumber ?? 99) - (getPlot(b)?.plotNumber ?? 99),
  );
  const built = member.data?.member.hasGreenhouse === true;

  return (
    <>
      <h1>Greenhouse</h1>
      {state !== undefined && state.level < GREENHOUSE_UNLOCK_LEVEL && !built ? (
        <p className="card">
          The Greenhouse unlocks at Garden Level {GREENHOUSE_UNLOCK_LEVEL} (you
          are level {state.level}).
        </p>
      ) : null}
      {plotIds.length === 0 ? (
        <div className="card">
          <p>
            No Greenhouse marked yet. Open the map, tap an unlocked plot and
            choose “Mark as Greenhouse”.
          </p>
          <Link to="/">Go to the map</Link>
        </div>
      ) : state === undefined ? (
        garden.isError ? (
          <ErrorCard
            title="Couldn't load your Garden"
            message={
              garden.error instanceof ApiError
                ? garden.error.message
                : "Unknown error"
            }
            onRetry={() => void garden.refetch()}
          />
        ) : (
          <p>Loading your Garden…</p>
        )
      ) : (
        plotIds.map((plotId) => (
          <GreenhousePanel
            key={plotId}
            plotId={plotId}
            lockedCells={state.greenhouse.lockedCells}
            member={member.data?.member}
            memberError={member.isError}
          />
        ))
      )}
    </>
  );
}
```

In `apps/web/src/components/TabBar.tsx` insert after the Home tab: `{ to: "/greenhouse", label: "Greenhouse", end: false },`

In `apps/web/src/App.tsx` add `import { GreenhouseScreen } from "./screens/GreenhouseScreen";` and, after the `index` route, `<Route path="greenhouse" element={<GreenhouseScreen />} />`.

Append to `apps/web/src/index.css`:

```css
/* Greenhouse */
.muted {
  color: var(--muted);
}
.gh-grid {
  display: grid;
  grid-template-columns: repeat(10, 32px);
  width: 322px;
  max-width: 100%;
  margin: 8px auto;
  gap: 1px;
  border: 2px solid var(--ink);
  background: var(--ink);
  image-rendering: pixelated;
}
.gh-cell {
  width: 32px;
  height: 32px;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  font-size: 11px;
  line-height: 1;
  color: var(--ink);
  background: var(--meadow-dark);
}
.gh-cell[data-state="locked"] {
  background: repeating-linear-gradient(
    45deg,
    #8d8a80,
    #8d8a80 4px,
    #a29f94 4px,
    #a29f94 8px
  );
  cursor: not-allowed;
}
.gh-cell[data-hl="ok"] {
  outline: 3px solid var(--good);
  outline-offset: -3px;
}
.gh-cell[data-hl="near"] {
  outline: 3px solid var(--gold);
  outline-offset: -3px;
}
.gh-palette-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}
.gh-bonus progress {
  width: 100%;
}
```

- [ ] **Step 6: Run tests, typecheck, lint, format**

Run: `pnpm exec prettier --write apps/web/src && pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck && pnpm exec eslint apps/web`
Expected: PASS. If an existing `TabBar`/`Layout` test asserts the exact tab list or count, update it to include "Greenhouse" after "Home". If `button` global styles override `.gh-cell` sizing, raise specificity (`.gh-grid .gh-cell`) rather than using `!important`; confirm visually in Task 10.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/test/greenhouseFixtures.ts apps/web/src/viewmodels/greenhouse.ts apps/web/src/viewmodels/greenhouse.test.ts apps/web/src/greenhouse apps/web/src/screens/GreenhouseScreen.tsx apps/web/src/screens/GreenhouseScreen.test.tsx apps/web/src/App.tsx apps/web/src/components/TabBar.tsx apps/web/src/index.css
git commit -m "feat(web): Greenhouse tab with 10x10 grid editor and unique-crop bonus" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

(`apps/web/src/index.css`, `App.tsx` and `TabBar.tsx` may carry earlier uncommitted edits; check `git diff` on each and use `git add -p` if they contain unrelated hunks.)

---

### Task 7: Mutation guide, discovery progress and chip levels

**Files:**
- Create: `apps/web/src/greenhouse/MutationGuide.tsx`, `apps/web/src/greenhouse/ChipLevels.tsx`
- Test: `apps/web/src/greenhouse/MutationGuide.test.tsx`; additions to `GreenhousePanel.test.tsx` and `viewmodels/greenhouse.test.ts`
- Modify: `apps/web/src/greenhouse/GreenhousePanel.tsx`, `apps/web/src/viewmodels/greenhouse.ts`

**Interfaces:**
- Consumes: core `ALL_MUTATIONS`, `getMutation`, `placeableName`, `rankCandidateCells`, `extraCellsNeeded`, `prettifyId`, `cellKey`, `GREENHOUSE_GRID_SIZE`, `type Candidate`, `type MutationDefinition`; `Highlight` from the view model.
- Produces:
  - `buildHighlights(candidates: readonly Candidate[]): Map<string, Highlight>` in `viewmodels/greenhouse.ts` (a candidate is `ok` when satisfied, `near` when at least one ingredient is already adjacent, otherwise not highlighted)
  - `MutationGuide` props: `{ selectedId: string | undefined; onSelect: (id: string | undefined) => void; discovered: ReadonlySet<string>; analyzed: ReadonlySet<string>; best: Candidate | undefined; extraCells: number | null }` (`extraCells` is core's `extraCellsNeeded`: 0 = fits, N = "Needs N more unlocked cells", null = cannot fit in a 10×10 grid)
  - `ChipLevels` props: `{ chips: Readonly<Record<string, number>> }`
  - `GreenhousePanel` now renders the guide, progress counts, chip levels (when `member` is defined) and a "progress unavailable" note when `memberError` is true.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/viewmodels/greenhouse.test.ts` (extend the import with `buildHighlights`, and add `import type { Candidate } from "@garden-hq/core";`):

```ts
describe("buildHighlights", () => {
  const status = (missing: number, required: number) => ({
    satisfied: missing === 0,
    missing,
    required,
    ingredients: [],
  });

  it("marks satisfied cells ok, partly filled cells near, and ignores the rest", () => {
    const candidates: Candidate[] = [
      { x: 4, z: 4, status: status(0, 2) },
      { x: 4, z: 5, status: status(1, 2) },
      { x: 5, z: 4, status: status(2, 2) },
    ];
    const map = buildHighlights(candidates);
    expect(map.get("4,4")).toEqual({ kind: "ok", missing: 0 });
    expect(map.get("4,5")).toEqual({ kind: "near", missing: 1 });
    expect(map.has("5,4")).toBe(false);
  });
});
```

Create `apps/web/src/greenhouse/MutationGuide.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MutationGuide } from "./MutationGuide";

const base = {
  discovered: new Set(["ashwreath", "dustgrain"]),
  analyzed: new Set(["dustgrain"]),
  best: undefined,
  extraCells: 0 as number | null,
};

describe("MutationGuide", () => {
  it("lists mutations with progress and reports the choice", async () => {
    const onSelect = vi.fn();
    render(<MutationGuide {...base} selectedId={undefined} onSelect={onSelect} />);
    const select = screen.getByLabelText("Target mutation");
    expect(screen.getByRole("option", { name: "Dustgrain (analysed)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ashwreath (discovered)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Coalroot" })).toBeInTheDocument();
    await userEvent.selectOptions(select, "dustgrain");
    expect(onSelect).toHaveBeenCalledWith("dustgrain");
  });

  it("shows the recipe for a neighbour mutation, including the unverified note", () => {
    render(<MutationGuide {...base} selectedId="dustgrain" onSelect={() => {}} />);
    expect(screen.getByText("2× Wheat")).toBeInTheDocument();
    expect(screen.getByText(/Harvest Boost/)).toBeInTheDocument();
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
  });

  it("flags non-placeable ingredients", () => {
    render(<MutationGuide {...base} selectedId="ashwreath" onSelect={() => {}} />);
    expect(screen.getByText(/2× fire/i)).toHaveTextContent(/not checked/i);
  });

  it("shows text-only recipes", () => {
    render(<MutationGuide {...base} selectedId="godseed" onSelect={() => {}} extraCells={1} />);
    expect(screen.getByText("Needs all positive crop effects.")).toBeInTheDocument();
    expect(screen.getByText(/Needs a free 3×3 block/)).toBeInTheDocument();
  });

  it("shows how many more cells to unlock when the recipe does not fit", () => {
    const { rerender } = render(
      <MutationGuide {...base} selectedId="coalroot" onSelect={() => {}} extraCells={1} />,
    );
    expect(screen.getByText("Needs 1 more unlocked cell.")).toBeInTheDocument();

    rerender(
      <MutationGuide {...base} selectedId="noctilume" onSelect={() => {}} extraCells={4} />,
    );
    expect(screen.getByText("Needs 4 more unlocked cells.")).toBeInTheDocument();

    rerender(
      <MutationGuide {...base} selectedId="noctilume" onSelect={() => {}} extraCells={null} />,
    );
    expect(screen.getByText("Can't fit in a 10×10 grid.")).toBeInTheDocument();
  });

  it("reports the best spot when the recipe fits", () => {
    const { rerender } = render(
      <MutationGuide
        {...base}
        selectedId="dustgrain"
        onSelect={() => {}}
        best={{ x: 4, z: 4, status: { satisfied: true, missing: 0, required: 2, ingredients: [] } }}
      />,
    );
    expect(screen.getByText(/Recipe satisfied at cell 4,4/)).toBeInTheDocument();
    expect(screen.queryByText(/more unlocked cell/)).toBeNull();

    rerender(
      <MutationGuide
        {...base}
        selectedId="dustgrain"
        onSelect={() => {}}
        best={{ x: 4, z: 5, status: { satisfied: false, missing: 1, required: 2, ingredients: [] } }}
      />,
    );
    expect(screen.getByText(/Closest spot: cell 4,5 — missing 1/)).toBeInTheDocument();
  });
});
```

Add to `GreenhousePanel.test.tsx` (extend its `setup` to take an optional `member` and `memberError`; add `import type { GardenMemberState } from "@garden-hq/core";`). Replace `setup` with:

```tsx
function setup(
  options: { member?: GardenMemberState; memberError?: boolean } = {},
) {
  const storage = createGardenStorage(null);
  storage.markGreenhouse("beginner_3");
  renderWithProviders(
    <GreenhousePanel
      plotId="beginner_3"
      lockedCells={LOCKED_CELLS}
      member={options.member}
      memberError={options.memberError}
    />,
    { storage },
  );
  return { storage, user: userEvent.setup() };
}
```

and add these tests inside `describe("GreenhousePanel", ...)`:

```tsx
  it("shows mutation progress and chip levels from the API", () => {
    setup({
      member: {
        discoveredMutations: ["ashwreath", "shadevine", "dead_plant", "dustgrain", "lonelily"],
        analyzedMutations: ["ashwreath", "shadevine", "dustgrain"],
        chips: { cropshot: 5, quickdraw: 2 },
        hasGreenhouse: true,
      },
    });
    expect(screen.getByText("Discovered 4/40 · Analysed 3/40")).toBeInTheDocument();
    expect(screen.getByText("Cropshot Lv 5")).toBeInTheDocument();
    expect(screen.getByText("Quickdraw Lv 2")).toBeInTheDocument();
  });

  it("says progress is unavailable when the member request failed", () => {
    setup({ memberError: true });
    expect(screen.getByText(/progress unavailable/i)).toBeInTheDocument();
  });

  it("highlights the cells where the chosen recipe is satisfied", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Wheat" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,3: empty" }));
    await user.click(screen.getByRole("button", { name: "Cell 5,3: empty" }));
    await user.selectOptions(screen.getByLabelText("Target mutation"), "dustgrain");
    expect(
      screen.getByRole("button", { name: "Cell 4,4: empty (recipe satisfied here)" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Recipe satisfied at cell/)).toBeInTheDocument();
  });

  it("shows how many more cells a recipe needs on the owner's 12 unlocked cells", async () => {
    const { user } = setup();
    const target = screen.getByLabelText("Target mutation");
    await user.selectOptions(target, "coalroot");
    expect(screen.getByText("Needs 1 more unlocked cell.")).toBeInTheDocument();
    await user.selectOptions(target, "noctilume");
    expect(screen.getByText("Needs 4 more unlocked cells.")).toBeInTheDocument();
    await user.selectOptions(target, "dustgrain");
    expect(screen.queryByText(/more unlocked cell/)).toBeNull();
  });
```

Here `Discovered 4/40` counts only ids that are mutations (`dead_plant` is excluded).

Run: `pnpm --filter @garden-hq/web test -- src/greenhouse src/viewmodels/greenhouse.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement `buildHighlights`**

Append to `apps/web/src/viewmodels/greenhouse.ts` (add `import type { Candidate } from "@garden-hq/core";` to the existing core import as `type Candidate`):

```ts
/** `ok` where the recipe is satisfied, `near` where some ingredient is already adjacent. */
export function buildHighlights(
  candidates: readonly Candidate[],
): Map<string, Highlight> {
  const highlights = new Map<string, Highlight>();
  for (const { x, z, status } of candidates) {
    const key = cellKey(x, z);
    if (status.satisfied) {
      highlights.set(key, { kind: "ok", missing: 0 });
    } else if (status.missing < status.required) {
      highlights.set(key, { kind: "near", missing: status.missing });
    }
  }
  return highlights;
}
```

- [ ] **Step 3: Implement the guide and chip components**

Create `apps/web/src/greenhouse/ChipLevels.tsx`:

```tsx
import { prettifyId } from "@garden-hq/core";

export function ChipLevels({
  chips,
}: {
  chips: Readonly<Record<string, number>>;
}) {
  const entries = Object.entries(chips).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    <div>
      <h3>Chips</h3>
      <ul className="gh-chips">
        {entries.map(([id, level]) => (
          <li key={id}>{`${prettifyId(id)} Lv ${level}`}</li>
        ))}
      </ul>
    </div>
  );
}
```

Create `apps/web/src/greenhouse/MutationGuide.tsx`:

```tsx
import {
  ALL_MUTATIONS,
  GREENHOUSE_GRID_SIZE,
  getMutation,
  placeableName,
  type Candidate,
  type MutationRarity,
} from "@garden-hq/core";

const RARITY_ORDER: MutationRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

export interface MutationGuideProps {
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  discovered: ReadonlySet<string>;
  analyzed: ReadonlySet<string>;
  best: Candidate | undefined;
  /** extraCellsNeeded: 0 = fits, N = unlock N more cells, null = cannot fit the grid. */
  extraCells: number | null;
}

function optionLabel(
  name: string,
  id: string,
  discovered: ReadonlySet<string>,
  analyzed: ReadonlySet<string>,
): string {
  if (analyzed.has(id)) return `${name} (analysed)`;
  if (discovered.has(id)) return `${name} (discovered)`;
  return name;
}

export function MutationGuide({
  selectedId,
  onSelect,
  discovered,
  analyzed,
  best,
  extraCells,
}: MutationGuideProps) {
  const mutation = selectedId === undefined ? undefined : getMutation(selectedId);

  return (
    <div className="gh-guide">
      <h3>Mutation guide</h3>
      <label>
        Target mutation
        <select
          value={selectedId ?? ""}
          onChange={(event) =>
            onSelect(event.target.value === "" ? undefined : event.target.value)
          }
        >
          <option value="">Choose a mutation…</option>
          {RARITY_ORDER.map((rarity) => (
            <optgroup key={rarity} label={rarity}>
              {ALL_MUTATIONS.filter((m) => m.rarity === rarity).map((m) => (
                <option key={m.id} value={m.id}>
                  {optionLabel(m.name, m.id, discovered, analyzed)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {mutation === undefined ? null : (
        <div className="gh-recipe">
          <h4>
            {mutation.name} <small>({mutation.rarity})</small>
          </h4>
          {mutation.recipe.kind === "special" ? (
            <p>{mutation.recipe.text}</p>
          ) : (
            <ul>
              {mutation.recipe.ingredients.map((ingredient) => (
                <li key={ingredient.id}>
                  {ingredient.placeable
                    ? `${ingredient.count}× ${placeableName(ingredient.id)}`
                    : `${ingredient.count}× ${ingredient.id} (not placeable — not checked)`}
                </li>
              ))}
            </ul>
          )}
          {mutation.effects.length > 0 ? (
            <p>Effects: {mutation.effects.join(", ")}</p>
          ) : null}
          {mutation.growth.footprint > 1 ? (
            <p>
              Needs a free {mutation.growth.footprint}×{mutation.growth.footprint} block
              of unlocked cells.
            </p>
          ) : null}
          {extraCells === null ? (
            <p role="status" className="gh-warn">
              {`Can't fit in a ${GREENHOUSE_GRID_SIZE}×${GREENHOUSE_GRID_SIZE} grid.`}
            </p>
          ) : extraCells > 0 ? (
            <p role="status" className="gh-warn">
              {`Needs ${extraCells} more unlocked ${extraCells === 1 ? "cell" : "cells"}.`}
            </p>
          ) : best === undefined ? null : best.status.satisfied ? (
            <p role="status">
              Recipe satisfied at cell {best.x},{best.z}.
            </p>
          ) : (
            <p role="status">
              Closest spot: cell {best.x},{best.z} — missing {best.status.missing}.
            </p>
          )}
          <p className="muted">
            Layout is unverified: assumes the ring of cells around the mutation
            (8 for a 1×1, 12 for a 2×2, 16 for a 3×3) counts toward the recipe.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the guide into the panel**

Replace `apps/web/src/greenhouse/GreenhousePanel.tsx` with:

```tsx
import {
  ALL_MUTATIONS,
  getMutation,
  extraCellsNeeded,
  getPlot,
  rankCandidateCells,
  type GardenMemberState,
  type GreenhouseCellRef,
} from "@garden-hq/core";
import { useMemo, useState } from "react";
import { useStorage, useStoredData } from "../state/StorageProvider";
import {
  buildGreenhouseViewModel,
  buildHighlights,
} from "../viewmodels/greenhouse";
import { BonusBar } from "./BonusBar";
import { ChipLevels } from "./ChipLevels";
import { GreenhouseGrid } from "./GreenhouseGrid";
import { GreenhousePalette } from "./GreenhousePalette";
import { MutationGuide } from "./MutationGuide";

export interface GreenhousePanelProps {
  plotId: string;
  lockedCells: readonly GreenhouseCellRef[];
  member: GardenMemberState | undefined;
  memberError?: boolean;
}

const MUTATION_IDS = new Set(ALL_MUTATIONS.map((m) => m.id));

export function GreenhousePanel({
  plotId,
  lockedCells,
  member,
  memberError = false,
}: GreenhousePanelProps) {
  const storage = useStorage();
  const save = useStoredData().greenhouses[plotId];
  const [brush, setBrush] = useState<string | undefined>(undefined);
  const [targetId, setTargetId] = useState<string | undefined>(undefined);

  const vm = useMemo(
    () =>
      save === undefined ? null : buildGreenhouseViewModel(save, lockedCells),
    [save, lockedCells],
  );

  const discovered = useMemo(
    () =>
      new Set(
        (member?.discoveredMutations ?? []).filter((id) => MUTATION_IDS.has(id)),
      ),
    [member],
  );
  const analyzed = useMemo(
    () =>
      new Set(
        (member?.analyzedMutations ?? []).filter((id) => MUTATION_IDS.has(id)),
      ),
    [member],
  );

  const target = targetId === undefined ? undefined : getMutation(targetId);
  const guide = useMemo(() => {
    if (vm === null || target === undefined) return null;
    const candidates = rankCandidateCells(target, vm.cells, vm.unlocked);
    return {
      best: candidates[0],
      extraCells: extraCellsNeeded(target, vm.unlocked),
      highlights: buildHighlights(candidates),
    };
  }, [vm, target]);

  if (vm === null) return null;

  const plot = getPlot(plotId);
  const title =
    plot === undefined ? plotId : `Plot ${plot.plotNumber} (${plotId})`;

  function onCellTap(key: string) {
    if (brush === undefined) return;
    storage.setGreenhouseCell(plotId, key, brush === "" ? null : brush);
  }

  return (
    <section className="card gh-panel" aria-label={`Greenhouse ${title}`}>
      <h2>Greenhouse — {title}</h2>
      <BonusBar bonus={vm.bonus} />
      <GreenhouseGrid
        rows={vm.rows}
        highlights={guide?.highlights}
        onCellTap={onCellTap}
        label={`Greenhouse grid, ${title}`}
      />
      <p className="muted">
        Greyed cells are locked: expand with Ethereal Vines.
      </p>
      <GreenhousePalette brush={brush} onBrush={setBrush} />
      <MutationGuide
        selectedId={targetId}
        onSelect={setTargetId}
        discovered={discovered}
        analyzed={analyzed}
        best={guide?.best}
        extraCells={guide?.extraCells ?? 0}
      />
      {member === undefined ? (
        memberError ? (
          <p className="muted">Mutation progress unavailable right now.</p>
        ) : null
      ) : (
        <>
          <p>{`Discovered ${discovered.size}/${MUTATION_IDS.size} · Analysed ${analyzed.size}/${MUTATION_IDS.size}`}</p>
          <ChipLevels chips={member.chips} />
        </>
      )}
    </section>
  );
}
```

Append to `apps/web/src/index.css`:

```css
.gh-guide label {
  display: grid;
  gap: 4px;
}
.gh-warn {
  color: var(--danger);
}
.gh-chips {
  margin: 0;
  padding-left: 18px;
}
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm exec prettier --write apps/web/src && pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck && pnpm exec eslint apps/web`
Expected: PASS. If the `Cell 4,4: empty (recipe satisfied here)` assertion fails, remember that `(4,3)` and `(5,3)` hold wheat and `(4,4)` is the highest-ranked empty neighbour of both; the ranking test in Task 3 proves a satisfied cell exists.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/greenhouse apps/web/src/viewmodels/greenhouse.ts apps/web/src/viewmodels/greenhouse.test.ts apps/web/src/index.css
git commit -m "feat(web): mutation guide, discovery progress and chip levels" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

---

### Task 8: Map: mark plots as Greenhouses and draw glass tiles

**Files:**
- Modify: `apps/web/src/viewmodels/map.ts`, `apps/web/src/viewmodels/map.test.ts`, `apps/web/src/map/AssignCropSheet.tsx`, `apps/web/src/map/MapSection.tsx`, `apps/web/src/map/MapSection.test.tsx`, `apps/web/src/map/MapScene.ts`, `apps/web/src/map/palette.ts`, `apps/web/src/map/PlotList.tsx`, `apps/web/src/screens/HomeScreen.tsx`
- Test: additions to `map.test.ts`, `MapSection.test.tsx`; new `apps/web/src/map/AssignCropSheet.test.tsx` additions (file exists; append)

**Interfaces:**
- Consumes: `GardenStorage.markGreenhouse/unmarkGreenhouse`, `MAX_GREENHOUSES`; react-router `useNavigate`.
- Produces:
  - `PlotTile.greenhouse: boolean` (true only for unlocked plots that are marked); `buildMapViewModel(garden, assignments, greenhouseIds?: ReadonlySet<string>)`
  - `AssignCropSheet` optional prop `greenhouse?: { marked: boolean; canMark: boolean; onMark: () => void; onRemove: () => void; onOpen: () => void }`
  - `MapSection` optional prop `greenhousePlotIds?: readonly string[]` (default `[]`)
  - `COLORS.glassFrame`, `COLORS.glassPane`, `COLORS.glassShine` in `map/palette.ts`; `MapScene.glassHouse(g, x, y)`

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/viewmodels/map.test.ts`: in the two `toEqual` literals that include `lockedCost` (near lines 38 and 103), add `greenhouse: false,` next to `lockedCost`. Then append a test inside the main `describe` (use the file's existing `garden`/helper setup; build a garden with `normalizeGarden({ garden_experience: 0, unlocked_plots_ids: ["beginner_1", "beginner_3"] })`):

```ts
  it("flags unlocked marked plots as greenhouses and ignores locked ones", () => {
    const garden = normalizeGarden({
      garden_experience: 0,
      unlocked_plots_ids: ["beginner_1", "beginner_3"],
    });
    const vm = buildMapViewModel(
      garden,
      {},
      new Set(["beginner_3", "beginner_2"]),
    );
    const byId = new Map(plots(vm).map((t) => [t.plotId, t]));
    expect(byId.get("beginner_3")?.greenhouse).toBe(true);
    expect(byId.get("beginner_2")?.greenhouse).toBe(false); // locked
    expect(byId.get("beginner_1")?.greenhouse).toBe(false);
  });
```

(Ensure `normalizeGarden` is imported in that test file; it likely already is.)

Append to `apps/web/src/map/AssignCropSheet.test.tsx`:

```tsx
describe("AssignCropSheet greenhouse actions", () => {
  function sheet(greenhouse: Parameters<typeof AssignCropSheet>[0]["greenhouse"]) {
    render(
      <AssignCropSheet
        plotId="beginner_3"
        plotNumber={4}
        gardenLevel={7}
        onPick={() => {}}
        onClose={() => {}}
        greenhouse={greenhouse}
      />,
    );
  }

  it("offers 'Mark as Greenhouse' and calls onMark", async () => {
    const onMark = vi.fn();
    sheet({ marked: false, canMark: true, onMark, onRemove: () => {}, onOpen: () => {} });
    await userEvent.click(screen.getByRole("button", { name: "Mark as Greenhouse" }));
    expect(onMark).toHaveBeenCalled();
  });

  it("disables marking at the maximum", () => {
    sheet({ marked: false, canMark: false, onMark: () => {}, onRemove: () => {}, onOpen: () => {} });
    expect(screen.getByRole("button", { name: "Mark as Greenhouse" })).toBeDisabled();
    expect(screen.getByText(/at most 3 Greenhouses/i)).toBeInTheDocument();
  });

  it("requires a second tap to remove a Greenhouse, and can open it", async () => {
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    sheet({ marked: true, canMark: true, onMark: () => {}, onRemove, onOpen });
    await userEvent.click(screen.getByRole("button", { name: "Open Greenhouse" }));
    expect(onOpen).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove Greenhouse" }));
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm — clears its grid" }),
    );
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows no greenhouse actions when the prop is absent", () => {
    sheet(undefined);
    expect(screen.queryByRole("button", { name: "Mark as Greenhouse" })).toBeNull();
  });
});
```

Make sure `AssignCropSheet.test.tsx` imports `render`, `screen` (from `@testing-library/react`), `userEvent`, `vi`, `describe`, `expect`, `it`, and `AssignCropSheet`; add any that are missing.

Add to `apps/web/src/map/MapSection.test.tsx` (it already mocks `./MapScene` and renders `MapSection` via `renderWithProviders`; add `import { createGardenStorage } from "../state/storage";`):

```tsx
  it("marks the selected plot as a Greenhouse from the sheet", async () => {
    const storage = createGardenStorage(null);
    const g = normalizeGarden({
      garden_experience: 0,
      unlocked_plots_ids: ["beginner_1", "beginner_3"],
    });
    renderWithProviders(
      <MapSection garden={g} assignments={{}} greenhousePlotIds={[]} />,
      { storage },
    );
    useUi.setState({ selectedPlotId: "beginner_3" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Mark as Greenhouse" }),
    );
    expect(Object.keys(storage.getSnapshot().greenhouses)).toEqual(["beginner_3"]);
  });
```

Run: `pnpm --filter @garden-hq/web test -- src/viewmodels/map.test.ts src/map`
Expected: FAIL.

- [ ] **Step 2: Implement the view model change**

In `apps/web/src/viewmodels/map.ts`:
- add `greenhouse: boolean;` to `PlotTile` (after `lockedCost`);
- change the signature to
  ```ts
  export function buildMapViewModel(
    garden: GardenState,
    assignments: Record<string, string>,
    greenhouseIds: ReadonlySet<string> = new Set(),
  ): MapViewModel {
  ```
- in the plot mapping, change `base` to include `greenhouse: unlocked.has(plot.id) && greenhouseIds.has(plot.id),` (it spreads into all three return shapes, so the field is present on locked, unlocked and assigned tiles).

- [ ] **Step 3: Implement the sheet actions**

In `apps/web/src/map/AssignCropSheet.tsx`: add `useState` to the React import, add the prop type and prop:

```tsx
  greenhouse?: {
    marked: boolean;
    canMark: boolean;
    onMark: () => void;
    onRemove: () => void;
    onOpen: () => void;
  };
```

(add `greenhouse` to the destructured props), add `const [confirmRemove, setConfirmRemove] = useState(false);` at the top of the component, and render this block after the crop grid/Clear button and before the Cancel button:

```tsx
        {greenhouse === undefined ? null : greenhouse.marked ? (
          <>
            <button type="button" onClick={greenhouse.onOpen}>
              Open Greenhouse
            </button>
            {confirmRemove ? (
              <button type="button" onClick={greenhouse.onRemove}>
                Confirm — clears its grid
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)}>
                Remove Greenhouse
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!greenhouse.canMark}
              onClick={greenhouse.onMark}
            >
              Mark as Greenhouse
            </button>
            {greenhouse.canMark ? null : (
              <p>You can have at most 3 Greenhouses.</p>
            )}
          </>
        )}
```

- [ ] **Step 4: Implement MapSection, HomeScreen, PlotList wiring**

In `apps/web/src/map/MapSection.tsx`:
- import `useNavigate` from `react-router-dom` and `MAX_GREENHOUSES` from `../state/storage`;
- extend props: `greenhousePlotIds?: readonly string[];` and destructure `greenhousePlotIds = []`; use a module-level `const NO_GREENHOUSES: readonly string[] = [];` as the default so the memo dependency is stable (`greenhousePlotIds = NO_GREENHOUSES`);
- `const navigate = useNavigate();`
- change the view model memo to `buildMapViewModel(garden, assignments, new Set(greenhousePlotIds))` with `greenhousePlotIds` added to the dependency array;
- pass to `AssignCropSheet`:

```tsx
          greenhouse={{
            marked: selected.greenhouse,
            canMark: greenhousePlotIds.length < MAX_GREENHOUSES,
            onMark: () => {
              storage.markGreenhouse(selected.plotId);
              selectPlot(null);
            },
            onRemove: () => {
              storage.unmarkGreenhouse(selected.plotId);
              selectPlot(null);
            },
            onOpen: () => {
              selectPlot(null);
              navigate("/greenhouse");
            },
          }}
```

In `apps/web/src/screens/HomeScreen.tsx`: destructure `greenhouses` from `useStoredData()` (`const { link, assignments, greenhouses } = useStoredData();`) and pass `greenhousePlotIds={Object.keys(greenhouses)}` to `<MapSection .../>`. (The array identity changes each render; `MapSection` builds a `Set` inside `useMemo` keyed on the array, which only costs a rebuild per render of HomeScreen, which is cheap. If it causes visible redraw churn, memoise with `useMemo(() => Object.keys(greenhouses), [greenhouses])` in HomeScreen.) Do the `useMemo` now to avoid it:

```tsx
  const greenhousePlotIds = useMemo(() => Object.keys(greenhouses), [greenhouses]);
```
(import `useMemo` from `react`; place the hook call above the early `return <Navigate .../>` is NOT allowed to be after it, so put it directly after the `useGarden` line, before the `link === null` return.)

In `apps/web/src/map/PlotList.tsx`: in `describe(tile)`, make the unlocked and assigned strings append ` · Greenhouse` when `tile.greenhouse`:

```ts
  const suffix = tile.greenhouse ? " · Greenhouse" : "";
  return (tile.state === "assigned" ? `crop: ${tile.cropId}` : "unlocked — no crop") + suffix;
```

- [ ] **Step 5: Draw the glass tile**

In `apps/web/src/map/palette.ts` add to `COLORS` (before `selected`):

```ts
  glassFrame: 0x5b7f86,
  glassPane: 0xbfeaf0,
  glassShine: 0xffffff,
```

In `apps/web/src/map/MapScene.ts`, in `plotGraphic`, replace the block

```ts
      if (tile.state === "assigned" && tile.cropId !== undefined) {
```

with

```ts
      if (tile.greenhouse) {
        this.glassHouse(g, x, y);
      } else if (tile.state === "assigned" && tile.cropId !== undefined) {
```

(the body of the crop branch stays unchanged), and add this method next to `barnGraphic`:

```ts
  /** Original pixel-art glasshouse: roof ridge, framed 2x2 panes with a shine pixel row. */
  private glassHouse(g: Graphics, x: number, y: number): void {
    g.rect(x + 2, y + 2, TILE - 4, 2).fill(COLORS.glassFrame);
    g.rect(x + 1, y + 4, TILE - 2, TILE - 6).fill(COLORS.glassFrame);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const px = x + 2 + col * 6;
        const py = y + 5 + row * 4;
        g.rect(px, py, 5, 3).fill({ color: COLORS.glassPane, alpha: 0.9 });
        g.rect(px, py, 2, 1).fill({ color: COLORS.glassShine, alpha: 0.8 });
      }
    }
  }
```

(`TILE` is 16, so panes sit at x+2..x+6 and x+8..x+12 inside the frame at x+1..x+14.)

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `pnpm exec prettier --write apps/web/src && pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck && pnpm exec eslint apps/web`
Expected: PASS. `MapScene` has no unit test (jsdom has no WebGL); the glass tile is verified visually in Task 10.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/viewmodels/map.ts apps/web/src/viewmodels/map.test.ts apps/web/src/map apps/web/src/screens/HomeScreen.tsx
git commit -m "feat(web): mark plots as Greenhouses on the map and draw glass tiles" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

(`apps/web/src/map/*` and `HomeScreen.tsx` may contain earlier uncommitted edits; inspect `git diff --stat` and use `git add -p` for any file with unrelated hunks.)

---

### Task 9: Manual "I watered it" timestamp

**Files:**
- Modify: `apps/web/src/greenhouse/GreenhousePanel.tsx`, `apps/web/src/greenhouse/GreenhousePanel.test.tsx`

**Interfaces:**
- Consumes: `storage.markGreenhouseWatered(plotId, at)`, `formatAge` from the view model, `useNow(intervalMs)` from `../state/useNow`.
- Produces: a "I watered it" button and a "Not watered yet" / "Watered X ago" line in each panel. No countdown and no decay prediction (no source for the numbers; see spec).

- [ ] **Step 1: Write the failing test**

Add to `GreenhousePanel.test.tsx` inside `describe("GreenhousePanel", ...)`:

```tsx
  it("records a manual watering time and shows its age", async () => {
    const { storage, user } = setup();
    expect(screen.getByText("Not watered yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I watered it" }));
    const at = storage.getSnapshot().greenhouses.beginner_3?.lastWateredAt;
    expect(typeof at).toBe("number");
    expect(screen.getByText("Watered just now")).toBeInTheDocument();
    expect(screen.queryByText(/countdown|dries out|decays/i)).toBeNull();
  });
```

Run: `pnpm --filter @garden-hq/web test -- src/greenhouse/GreenhousePanel.test.tsx`
Expected: FAIL (no such button).

- [ ] **Step 2: Implement**

In `GreenhousePanel.tsx` add imports `import { useNow } from "../state/useNow";` and `formatAge` to the view-model import. Inside the component, after `const [targetId, ...]`, add:

```tsx
  const now = useNow(30_000);
  const wateredAt = save?.lastWateredAt ?? null;
```

(check `apps/web/src/state/useNow.ts` for the exact signature; `SyncBar` calls `useNow(30_000)` and uses the result as epoch ms, so this matches.) Then, directly under the `BonusBar` block (above the grid), add:

```tsx
      <p>
        {wateredAt === null
          ? "Not watered yet"
          : `Watered ${formatAge(now - wateredAt)}`}{" "}
        <button
          type="button"
          onClick={() => storage.markGreenhouseWatered(plotId, Date.now())}
        >
          I watered it
        </button>
      </p>
```

`useNow` and `wateredAt` sit above the early `if (vm === null) return null;`, which keeps the hook order stable.

`formatAge(now - lastWateredAt)` can be slightly negative right after clicking if `now` lags the click; `formatAge` clamps negatives to "just now" (covered by the view-model test).

- [ ] **Step 3: Run tests, typecheck, lint, commit**

Run: `pnpm exec prettier --write apps/web/src/greenhouse && pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck && pnpm exec eslint apps/web`
Expected: PASS.

```bash
git add apps/web/src/greenhouse/GreenhousePanel.tsx apps/web/src/greenhouse/GreenhousePanel.test.tsx
git commit -m "feat(web): manual 'I watered it' timestamp per Greenhouse" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```

---

### Task 10: Full verification, visual check and docs

**Files:**
- Modify: `CLAUDE.md` (two lines, Step 3), `data/VERIFY.md` (only if the checks below reveal something), `docs/superpowers/specs/2026-10-06-greenhouse-design.md` (status line)

- [ ] **Step 1: Full automated checks**

Run: `pnpm typecheck && pnpm lint && pnpm format && pnpm test && pnpm build`
Expected: all pass. If `pnpm format` reports files you did not touch (the working tree already had many modified files), only fix files from this feature; list the rest in your report instead of reformatting them.

- [ ] **Step 2: Run the app and check the feature by eye**

Use the `run` skill (or `pnpm --filter @garden-hq/worker dev` plus `pnpm --filter @garden-hq/web dev` with `apps/worker/.dev.vars` present). With a browser at 380 px width:
1. Link the owner's Minecraft name. Open the map; tap plot 4 (`beginner_3`); choose "Mark as Greenhouse". The plot must draw as a glass tile and sit clear of the plot-number badge.
2. Open the Greenhouse tab. The panel must read "Greenhouse — Plot 4 (beginner_3)"; the 10x10 grid must fit without horizontal scroll; 88 cells greyed, the 12 centre cells (columns 3-6, rows 3-6) usable.
3. Place Wheat on `4,3` and `5,3`; choose Dustgrain in the guide; `4,4` must highlight green and the text must say the recipe is satisfied. Choose Coalroot (must say "Needs 1 more unlocked cell."), Noctilume ("Needs 4 more unlocked cells.") and Snoozling ("Needs 13 more unlocked cells.").
4. Confirm the discovery line reads "Discovered 4/40 · Analysed 3/40", chips read "Cropshot Lv 5" and "Quickdraw Lv 2", the bonus bar reads "1/12 unique crops — +3%", and "I watered it" switches the line to "Watered just now".
5. Reload: the grid and marked plot persist. Remove the Greenhouse via the sheet (two taps) and confirm the tile returns to normal and the tab shows the empty state.

If a visual problem appears (cell sizing overridden by global `button` styles, glass tile overlapping the badge), fix it with a CSS or draw-offset change and re-run Step 1; do not claim the feature works without having looked.

- [ ] **Step 3: Close out the docs**

- In `docs/superpowers/specs/2026-10-06-greenhouse-design.md` change the status line to `implemented (see commits on this branch)` only if every step above passed.
- Update the two outdated lines in `CLAUDE.md` (the owner approved this edit). Make two exact-string edits in §2, changing nothing else:

  1. In the `**Greenhouse (0.24, Dec 2025):**` paragraph, replace this exact text:

  ```text
  Up to 3 Greenhouse plots.
  ```

  with:

  ```text
  Up to 3 Greenhouses, each a placeable plot on the 24-plot map; the API does not say which plots are Greenhouses (the app has the player mark them), and `garden.greenhouse_slots` lists the LOCKED cells of the 10x10 grid (unlocked = 10x10 minus that list).
  ```

  2. In the `**Chips:**` line, replace this exact text:

  ```text
  Chip state is not reliably exposed by the API; track it manually.
  ```

  with:

  ```text
  Chip levels are exposed by the API (`player_data.garden_chips` in the profile member data, e.g. `{ "cropshot": 5 }`); the app reads them read-only.
  ```
  Do not change any other line. Two other lines still mention chips as manual/user-entered (`CLAUDE.md` §3 "treat the API as truth ... user input for everything else (... chips ...)" and the §6 `chips` table); leave them and mention them in your report so the owner can decide.
- Make sure `data/VERIFY.md` still lists every open item (adjacency rule, special recipes, 12-crop list, locked-cell list for multiple Greenhouses, `needsWater`, Ethereal Vines cost wording).

- [ ] **Step 4: Final commit (docs only, if anything changed)**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-06-greenhouse-design.md data/VERIFY.md
git commit -m "docs: update CLAUDE.md for exposed chips and Greenhouse plots; mark spec implemented" -m $'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RukkmYjYmo2eMyNjwsTHAW'
```
