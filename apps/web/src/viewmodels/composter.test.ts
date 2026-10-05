import { composterCapacity, normalizeGarden } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildComposterViewModel } from "./composter";

const HOUR = 3_600_000;

function composter(fields: Record<string, unknown>) {
  return normalizeGarden({
    composter_data: {
      organic_matter: 40_000,
      fuel_units: 20_000,
      compost_units: 3,
      last_save: 1_000_000,
      upgrades: {},
      ...fields,
    },
  }).composter;
}

describe("buildComposterViewModel", () => {
  it("uses the save snapshot when now equals last_save", () => {
    const c = composter({});
    const vm = buildComposterViewModel(c, 1_000_000);
    expect(vm.fuel).toBe(20_000);
    expect(vm.organicMatter).toBe(40_000);
    expect(vm.compostReady).toBe(3);
    expect(vm.fuelRatio).toBeCloseTo(20_000 / composterCapacity().fuel);
    expect(vm.organicMatterRatio).toBeCloseTo(
      40_000 / composterCapacity().organicMatter,
    );
  });

  it("drains over time and reports depletion times after last_save", () => {
    const c = composter({});
    const later = buildComposterViewModel(c, 1_000_000 + 2 * HOUR);
    expect(later.fuel).toBeLessThan(20_000);
    expect(later.fuelRunsOutAt).toBeGreaterThan(1_000_000);
    expect(later.organicMatterRunsOutAt).toBeGreaterThan(1_000_000);
  });

  it("clamps ratios to [0, 1]", () => {
    const vm = buildComposterViewModel(
      composter({ fuel_units: 99_999_999, organic_matter: 99_999_999 }),
      1_000_000,
    );
    expect(vm.fuelRatio).toBe(1);
    expect(vm.organicMatterRatio).toBe(1);
  });

  it("treats a missing last_save (0) as 'just saved' instead of draining to zero", () => {
    const vm = buildComposterViewModel(
      composter({ last_save: 0 }),
      5_000_000_000,
    );
    expect(vm.fuel).toBe(20_000);
    expect(vm.fuelRunsOutAt).toBeGreaterThan(5_000_000_000);
  });
});
