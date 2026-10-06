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
      upgrades: { fuel_cap: 1, organic_matter_cap: 1 },
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
    expect(vm.status).toBe("running");
    expect(vm.fuelCap).toBe(composterCapacity(c.upgrades).fuel);
    expect(vm.fuelRatio).toBeCloseTo(20_000 / 70_000);
    expect(vm.organicMatterRatio).toBeCloseTo(40_000 / 70_000);
  });

  it("drains while running and reports a stop time after now", () => {
    // Base rate: 12,000 fuel/h and 24,000 organic matter/h.
    const c = composter({ fuel_units: 30_000, organic_matter: 100_000 });
    const now = 1_000_000 + HOUR;
    const later = buildComposterViewModel(c, now);
    expect(later.fuel).toBeCloseTo(18_000);
    expect(later.organicMatter).toBeCloseTo(76_000);
    expect(later.status).toBe("running");
    expect(later.stopsAt).toBeGreaterThanOrEqual(now);
    expect(later.stopsBecause).toBe("fuel");
  });

  it("names organic matter when that runs out first", () => {
    const c = composter({ fuel_units: 30_000, organic_matter: 40_000 });
    const vm = buildComposterViewModel(c, 1_000_000 + HOUR);
    expect(vm.status).toBe("running");
    expect(vm.stopsBecause).toBe("organic_matter");
  });

  it("is idle with the real organic matter when fuel is 0 (no time, no drain)", () => {
    const vm = buildComposterViewModel(
      composter({ fuel_units: 0, organic_matter: 8000 }),
      1_000_000 + 72 * HOUR,
    );
    expect(vm.status).toBe("no_fuel");
    expect(vm.organicMatter).toBe(8000);
    expect(vm.stopsAt).toBeNull();
  });

  it("goes idle instead of showing a past 'runs out' time", () => {
    const vm = buildComposterViewModel(
      composter({ fuel_units: 2000 }),
      1_000_000 + 24 * HOUR,
    );
    expect(vm.status).toBe("no_fuel");
    expect(vm.stopsAt).toBeNull();
  });

  it("clamps ratios to [0, 1]", () => {
    const vm = buildComposterViewModel(
      composter({ fuel_units: 99_999_999, organic_matter: 99_999_999 }),
      1_000_000,
    );
    expect(vm.fuelRatio).toBe(1);
    expect(vm.organicMatterRatio).toBe(1);
  });

  it("treats a missing last_save (0) as just saved instead of draining", () => {
    const now = 5_000_000_000;
    const vm = buildComposterViewModel(composter({ last_save: 0 }), now);
    expect(vm.fuel).toBe(20_000);
    expect(vm.stopsAt).toBeGreaterThan(now);
  });
});
