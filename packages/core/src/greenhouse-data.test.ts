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
    expect(special).toEqual([
      "godseed",
      "jerryflower",
      "lonelily",
      "shellfruit",
    ]);
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
