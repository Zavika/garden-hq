import { describe, expect, it } from "vitest";
import sampleResponse from "../fixtures/garden-response.sample.json";
import { levelForExperience, normalizeGarden } from "./garden";

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
