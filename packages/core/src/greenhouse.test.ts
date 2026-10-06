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
  "3,4",
  "3,5",
  "4,3",
  "4,4",
  "4,5",
  "4,6",
  "5,3",
  "5,4",
  "5,5",
  "5,6",
  "6,4",
  "6,5",
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
      uniqueCropBonus(
        { "4,4": "wheat", "4,5": "carrot", "5,4": "wheat" },
        ownerUnlocked,
      ),
    ).toEqual({ unique: 2, counted: 2, max: 12, percent: 6 });
  });

  it("ignores locked cells, dead plants and mutations", () => {
    expect(
      uniqueCropBonus(
        {
          "0,0": "wheat",
          "4,4": "dead_plant",
          "4,5": "dustgrain",
          "5,4": "potato",
        },
        ownerUnlocked,
      ),
    ).toEqual({ unique: 1, counted: 1, max: 12, percent: 3 });
  });

  it("caps at 12 unique crops (36%)", () => {
    const ids = [
      "wheat",
      "carrot",
      "potato",
      "pumpkin",
      "melon",
      "cactus",
      "sugar_cane",
      "cocoa_beans",
      "red_mushroom",
      "brown_mushroom",
      "nether_wart",
      "sunflower",
      "moonflower",
      "wild_rose",
      "fermento",
    ];
    const cells = Object.fromEntries(
      ids.map((id, i) => [cellKey(i % 10, Math.floor(i / 10)), id]),
    );
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
    const cells = {
      "4,3": "wheat",
      "5,3": "wheat",
      "3,3": "wheat",
      "5,5": "carrot",
    };
    // (3,3) is locked for the owner, so it does not count.
    const counts = neighbourCounts(cells, ownerUnlocked, 4, 4);
    expect(counts.get("wheat")).toBe(2);
    expect(counts.get("carrot")).toBe(1);
  });

  it("uses the ring around a larger footprint and ignores the block itself", () => {
    const counts = neighbourCounts(
      { "4,4": "wheat", "6,6": "carrot" },
      allUnlocked,
      4,
      4,
      2,
    );
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
    expect(
      recipeStatus(dustgrain, { "4,3": "wheat" }, ownerUnlocked, 4, 4),
    ).toMatchObject({
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
    expect(status?.ingredients.find((i) => i.id === "fire")?.placeable).toBe(
      false,
    );
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
    const blocked = rankCandidateCells(
      noctilume,
      { "4,4": "wheat" },
      ownerUnlocked,
    );
    expect(blocked.map((c) => cellKey(c.x, c.z)).sort()).toEqual([
      "4,5",
      "5,4",
    ]);
  });
});

describe("extraCellsNeeded on the owner's 12 unlocked cells", () => {
  const needs = (id: string, unlocked = ownerUnlocked) =>
    extraCellsNeeded(mutation(id), unlocked);

  it("is 0 for recipes that already fit", () => {
    for (const id of [
      "dustgrain",
      "ashwreath",
      "witherbloom",
      "soggybud",
      "lonelily",
      "shellfruit",
      "jerryflower",
    ]) {
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
