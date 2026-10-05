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

describe("composterCapacity", () => {
  it("returns the fully-upgraded caps from data/composter.json", () => {
    expect(composterCapacity()).toEqual({
      fuel: composterData.upgrades.fuelCap.maxEffect,
      organicMatter: composterData.upgrades.organicMatterCap.maxEffect,
    });
    expect(composterCapacity().fuel).toBeGreaterThan(0);
  });
});
