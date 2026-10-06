import { describe, expect, it } from "vitest";
import {
  ALL_PLOTS,
  BARN_CELL,
  GRID_SIZE,
  cheapestNextPlot,
  getPlot,
  nextPlotCost,
  plotAvailability,
} from "./plots";

describe("ALL_PLOTS", () => {
  it("has 24 plots", () => {
    expect(ALL_PLOTS).toHaveLength(24);
  });
});

describe("getPlot", () => {
  it("finds a plot by id", () => {
    expect(getPlot("beginner_1")?.plotNumber).toBe(2);
  });

  it("returns undefined for an unknown id", () => {
    expect(getPlot("nonexistent")).toBeUndefined();
  });
});

describe("cheapestNextPlot", () => {
  it("picks the cheapest unlocked-tier plot when nothing is owned", () => {
    // All locked beginner plots cost 1; the lowest-numbered (plot 1) is offered.
    expect(cheapestNextPlot([], 1)).toMatchObject({
      id: "beginner_2",
      plotNumber: 1,
      cost: 1,
    });
  });

  it("skips already-unlocked plots", () => {
    expect(cheapestNextPlot(["beginner_2"], 1)?.id).toBe("beginner_1");
  });

  it("crosses into a higher tier once the cheaper tier is fully unlocked", () => {
    const owned = ["beginner_1", "beginner_2", "beginner_3", "beginner_4"];
    expect(cheapestNextPlot(owned, 5)?.id).toBe("intermediate_1");
  });

  it("prices each tier by how many of it are owned, not by plot", () => {
    // Real account: all of beginner + intermediate, plus advanced_5 (plot 19).
    const owned = [
      "beginner_1",
      "beginner_2",
      "beginner_3",
      "beginner_4",
      "intermediate_1",
      "intermediate_2",
      "intermediate_3",
      "intermediate_4",
      "advanced_5",
    ];
    // Advanced is the only tier open at level 5: second ladder rung is 96,
    // offered as its lowest-numbered locked plot (plot 9 = advanced_6).
    expect(cheapestNextPlot(owned, 5)).toMatchObject({
      id: "advanced_6",
      plotNumber: 9,
      cost: 96,
    });
    // At level 7 expert opens, but 1280 is still dearer than 96.
    expect(cheapestNextPlot(owned, 7)?.cost).toBe(96);
    expect(nextPlotCost("advanced", owned)).toBe(96);
  });

  it("returns undefined once every unlocked-tier plot is owned", () => {
    expect(
      cheapestNextPlot(
        ALL_PLOTS.map((p) => p.id),
        7,
      ),
    ).toBeUndefined();
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

// API id -> in-game plot number and (column x, row y); source:
// EliteFarmers/Website packages/farming-weight/src/constants/plots.ts
const API_PLOTS: Record<string, [number, number, number]> = {
  beginner_1: [2, 1, 2],
  beginner_2: [1, 2, 1],
  beginner_3: [4, 2, 3],
  beginner_4: [3, 3, 2],
  intermediate_1: [5, 1, 1],
  intermediate_2: [7, 1, 3],
  intermediate_3: [6, 3, 1],
  intermediate_4: [8, 3, 3],
  advanced_1: [15, 0, 1],
  advanced_2: [10, 0, 2],
  advanced_3: [17, 0, 3],
  advanced_4: [13, 1, 0],
  advanced_5: [19, 1, 4],
  advanced_6: [9, 2, 0],
  advanced_7: [12, 2, 4],
  advanced_8: [14, 3, 0],
  advanced_9: [20, 3, 4],
  advanced_10: [16, 4, 1],
  advanced_11: [11, 4, 2],
  advanced_12: [18, 4, 3],
  expert_1: [21, 0, 0],
  expert_2: [23, 0, 4],
  expert_3: [22, 4, 0],
  expert_4: [24, 4, 4],
};

describe("plot layout", () => {
  it("places every plot at its SkyHanni plotMap cell", () => {
    SKYHANNI_GRID.forEach((row, y) =>
      row.forEach((n, x) => {
        if (n === 0) return;
        const plot = ALL_PLOTS.find((p) => p.plotNumber === n);
        expect({ n, x: plot?.x, y: plot?.y }).toEqual({ n, x, y });
      }),
    );
  });

  it("maps every real API id to its plot number and cell", () => {
    expect(Object.keys(API_PLOTS)).toHaveLength(24);
    for (const [id, [plotNumber, x, y]] of Object.entries(API_PLOTS)) {
      expect(getPlot(id)).toMatchObject({ id, plotNumber, x, y });
    }
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

describe("nextPlotCost", () => {
  it("is the first ladder cost when nothing is owned", () => {
    expect(nextPlotCost("beginner", [])).toBe(1);
  });

  it("follows owned count, not plot number (out of order)", () => {
    expect(nextPlotCost("beginner", ["beginner_4"])).toBe(2);
    expect(nextPlotCost("beginner", ["beginner_1", "beginner_2"])).toBe(4);
  });

  it("ignores owned plots from other tiers", () => {
    expect(nextPlotCost("intermediate", ["beginner_1", "beginner_2"])).toBe(16);
  });

  it("walks the full advanced and expert ladders", () => {
    const advanced = Array.from({ length: 12 }, (_, i) => `advanced_${i + 1}`);
    expect(
      advanced.map((_, n) => nextPlotCost("advanced", advanced.slice(0, n))),
    ).toEqual([64, 96, 128, 160, 160, 320, 320, 480, 480, 640, 800, 1120]);
    expect(nextPlotCost("expert", [])).toBe(1280);
    expect(nextPlotCost("expert", ["expert_1", "expert_2", "expert_3"])).toBe(
      2400,
    );
  });

  it("is null when the tier is fully bought or unknown", () => {
    expect(
      nextPlotCost("beginner", [
        "beginner_1",
        "beginner_2",
        "beginner_3",
        "beginner_4",
      ]),
    ).toBeNull();
    expect(nextPlotCost("nope", [])).toBeNull();
  });
});

describe("plotAvailability", () => {
  // A real account: all beginner + intermediate, plus advanced_5 (plot 19).
  const REAL_OWNED = [
    "beginner_1",
    "beginner_2",
    "beginner_3",
    "beginner_4",
    "intermediate_1",
    "intermediate_2",
    "intermediate_3",
    "intermediate_4",
    "advanced_5",
  ];

  function numbersWhere(
    availability: "owned" | "buyable" | "unreachable",
    owned = REAL_OWNED,
    level = 10,
  ): number[] {
    const map = plotAvailability(owned, level);
    return ALL_PLOTS.filter((p) => map.get(p.id) === availability)
      .map((p) => p.plotNumber)
      .sort((a, b) => a - b);
  }

  it("only plots touching the Barn or an owned plot are buyable (real account)", () => {
    expect(numbersWhere("buyable")).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 23,
    ]);
    expect(numbersWhere("unreachable")).toEqual([21, 22, 24]);
    expect(numbersWhere("owned")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 19]);
  });

  it("does not count diagonal neighbours", () => {
    // Plot 21 (0,0) is diagonal to owned plot 5 (1,1) but shares no edge.
    expect(plotAvailability(["intermediate_1"], 10).get("expert_1")).toBe(
      "unreachable",
    );
  });

  it("starts from the Barn when nothing is owned", () => {
    expect(numbersWhere("buyable", [], 1)).toEqual([1, 2, 3, 4]);
  });

  it("keeps an adjacent plot unreachable until the garden level opens its tier", () => {
    const owned = ["beginner_1", "beginner_2", "beginner_3", "beginner_4"];
    expect(numbersWhere("buyable", owned, 1)).toEqual([]);
    expect(numbersWhere("buyable", owned, 3)).toEqual([5, 6, 7, 8]);
  });

  it("makes cheapestNextPlot recommend only buyable plots", () => {
    const next = cheapestNextPlot(REAL_OWNED, 10);
    expect(next?.plotNumber).toBe(9);
    // Own everything around the corners except 21/22/24's neighbours: never offered.
    const all = ALL_PLOTS.map((p) => p.id).filter(
      (id) => !["expert_1", "expert_3", "expert_4"].includes(id),
    );
    expect(cheapestNextPlot(all, 10)?.plotNumber).toBe(21);
  });
});
