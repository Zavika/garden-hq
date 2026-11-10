import { describe, expect, it } from "vitest";
import composter from "../../../data/composter.json";
import crops from "../../../data/crops.json";
import gardenLevels from "../../../data/garden-levels.json";
import pests from "../../../data/pests.json";
import playerLevels from "../../../data/player-levels.json";
import questData from "../../../data/quests.json";
import plots from "../../../data/plots.json";

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

describe("data/plots.json", () => {
  it("has 4 tiers totaling 24 plots", () => {
    expect(plots.tiers).toHaveLength(4);
    const total = plots.tiers.reduce((sum, tier) => sum + tier.plots.length, 0);
    expect(total).toBe(24);
  });

  it("has a cost ladder entry per plot and plot numbers 1-24 once each", () => {
    for (const tier of plots.tiers) {
      expect(tier.costLadder).toHaveLength(tier.plots.length);
    }
    const numbers = plots.tiers.flatMap((t) => t.plots.map((p) => p.plot));
    expect(numbers.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    );
  });
});

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

describe("versioned data files", () => {
  it.each([
    ["quests", questData],
    ["player-levels", playerLevels],
  ])("%s has a non-empty lastVerified", (_name, file) => {
    expect(typeof file.lastVerified).toBe("string");
    expect(file.lastVerified.length).toBeGreaterThan(0);
  });
});
