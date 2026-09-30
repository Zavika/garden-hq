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
