import { describe, expect, it } from "vitest";
import {
  ALL_PLOTS,
  BARN_CELL,
  GRID_SIZE,
  cheapestNextPlot,
  getPlot,
} from "./plots";

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

const SKYHANNI_GRID = [
  [21, 13, 9, 14, 22],
  [15, 5, 1, 6, 16],
  [10, 2, 0, 3, 11],
  [17, 7, 4, 8, 18],
  [23, 19, 12, 20, 24],
];

function idForNumber(n: number): string {
  if (n <= 4) return `beginner_${n}`;
  if (n <= 8) return `intermediate_${n - 4}`;
  if (n <= 12) return `advanced_${n - 8}`;
  return `expert_${n - 12}`;
}

describe("plot layout", () => {
  it("places every plot at its SkyHanni plotMap cell", () => {
    SKYHANNI_GRID.forEach((row, y) =>
      row.forEach((n, x) => {
        if (n === 0) return;
        const plot = getPlot(idForNumber(n));
        expect({ id: plot?.id, x: plot?.x, y: plot?.y }).toEqual({
          id: idForNumber(n),
          x,
          y,
        });
      }),
    );
  });

  it("uses 24 unique in-range cells that exclude the Barn", () => {
    const cells = ALL_PLOTS.map((p) => `${p.x},${p.y}`);
    expect(new Set(cells).size).toBe(24);
    for (const p of ALL_PLOTS) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(GRID_SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(GRID_SIZE);
    }
    expect(cells).not.toContain(`${BARN_CELL.x},${BARN_CELL.y}`);
  });

  it("puts the Barn in the centre of a 5x5 grid", () => {
    expect(GRID_SIZE).toBe(5);
    expect(BARN_CELL).toEqual({ x: 2, y: 2 });
  });
});
