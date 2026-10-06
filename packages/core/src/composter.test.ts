import { describe, expect, it } from "vitest";
import composterData from "../../../data/composter.json";
import {
  composterCapacity,
  compostPerHour,
  forecastComposter,
} from "./composter";
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

const HOUR = 60 * 60 * 1000;
const LAST_SAVE = 1_000_000_000_000;

function state(fields: Partial<ComposterState> = {}): ComposterState {
  return {
    organicMatter: 1_000_000,
    fuel: 2000,
    compostUnits: 0,
    lastSave: LAST_SAVE,
    upgrades: NO_UPGRADES,
    ...fields,
  };
}

describe("forecastComposter", () => {
  it("runs out of fuel after exactly 10 minutes at the base rate with 2000 fuel", () => {
    const tenMinutesMs = 10 * 60 * 1000;
    const atSave = forecastComposter(state(), LAST_SAVE);
    expect(atSave.status).toBe("running");
    expect(atSave.stopsAt).toBe(LAST_SAVE + tenMinutesMs);
    expect(atSave.stopsBecause).toBe("fuel");

    const after = forecastComposter(state(), LAST_SAVE + tenMinutesMs);
    expect(after.fuel).toBeCloseTo(0, 5);
    expect(after.status).toBe("no_fuel");
  });

  it("never goes negative once fuel is fully depleted", () => {
    const f = forecastComposter(state(), LAST_SAVE + HOUR);
    expect(f.fuel).toBe(0);
    expect(f.organicMatter).toBeGreaterThanOrEqual(0);
  });

  it("consumes nothing while there is no fuel (organic matter is kept)", () => {
    const f = forecastComposter(
      state({ fuel: 0, organicMatter: 8000 }),
      LAST_SAVE + 48 * HOUR,
    );
    expect(f).toEqual({
      organicMatter: 8000,
      fuel: 0,
      status: "no_fuel",
      stopsAt: null,
      stopsBecause: null,
    });
  });

  it("stops consuming organic matter at the moment fuel ran out", () => {
    // 2000 fuel lasts 10 min = 4000 organic matter at the base rate.
    const f = forecastComposter(
      state({ organicMatter: 10_000 }),
      LAST_SAVE + 24 * HOUR,
    );
    expect(f.status).toBe("no_fuel");
    expect(f.organicMatter).toBeCloseTo(6000, 5);
  });

  it("stops consuming fuel when organic matter runs out first", () => {
    const f = forecastComposter(
      state({ organicMatter: 4000, fuel: 100_000 }),
      LAST_SAVE + 24 * HOUR,
    );
    expect(f.status).toBe("no_organic_matter");
    expect(f.organicMatter).toBe(0);
    expect(f.fuel).toBeCloseTo(98_000, 5);
    expect(f.stopsAt).toBeNull();
  });

  it("reports which resource runs out first while running", () => {
    const f = forecastComposter(
      state({ organicMatter: 4000, fuel: 100_000 }),
      LAST_SAVE,
    );
    expect(f.status).toBe("running");
    expect(f.stopsBecause).toBe("organic_matter");
    expect(f.stopsAt).toBe(LAST_SAVE + 10 * 60 * 1000);
  });

  it("never reports a stop time in the past", () => {
    for (const hours of [0, 0.05, 0.5, 3, 500]) {
      const now = LAST_SAVE + hours * HOUR;
      const f = forecastComposter(state({ fuel: 50_000 }), now);
      if (f.stopsAt !== null) expect(f.stopsAt).toBeGreaterThanOrEqual(now);
    }
    const idle = forecastComposter(state({ fuel: 0 }), LAST_SAVE + HOUR);
    expect(idle.stopsAt).toBeNull();
  });
});

describe("composterCapacity", () => {
  it("defaults to the fully-upgraded caps from data/composter.json", () => {
    expect(composterCapacity()).toEqual({
      fuel: composterData.upgrades.fuelCap.maxEffect,
      organicMatter: composterData.upgrades.organicMatterCap.maxEffect,
    });
  });

  it("is the 40,000 base cap plus 30,000 per purchased tier", () => {
    expect(composterCapacity(NO_UPGRADES)).toEqual({
      fuel: 40_000,
      organicMatter: 40_000,
    });
    expect(
      composterCapacity({ ...NO_UPGRADES, fuelCap: 2, organicMatterCap: 1 }),
    ).toEqual({ fuel: 100_000, organicMatter: 70_000 });
  });

  it("reaches the documented maximum at 27 / 25 tiers and never exceeds it", () => {
    expect(
      composterCapacity({ ...NO_UPGRADES, fuelCap: 27, organicMatterCap: 25 }),
    ).toEqual({ fuel: 850_000, organicMatter: 790_000 });
    expect(
      composterCapacity({ ...NO_UPGRADES, fuelCap: 99, organicMatterCap: 99 }),
    ).toEqual({ fuel: 850_000, organicMatter: 790_000 });
  });
});
