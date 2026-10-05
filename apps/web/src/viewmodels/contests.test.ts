import type { Contest } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildContestsViewModel } from "./contests";

const now = Date.UTC(2026, 9, 5, 10, 0); // 12:00 in Warsaw (CEST)
const AT_1230_UTC = Date.UTC(2026, 9, 5, 12, 30); // 14:30 in Warsaw

const contests: Contest[] = [
  { startsAt: now - 1000, crops: ["wheat"] },
  { startsAt: AT_1230_UTC, crops: ["wheat", "carrot", "potato"] },
  { startsAt: AT_1230_UTC + 3_600_000, crops: ["melon", "cactus", "pumpkin"] },
];

describe("buildContestsViewModel", () => {
  it("shows only upcoming contests, formatted in the given time zone", () => {
    const vm = buildContestsViewModel(contests, [], now, "Europe/Warsaw");
    expect(vm.rows).toHaveLength(2);
    expect(vm.rows[0]?.label).toContain("14:30");
  });

  it("shows everything with filtered=false when no crops are assigned", () => {
    const vm = buildContestsViewModel(contests, [], now, "UTC");
    expect(vm.filtered).toBe(false);
    expect(vm.rows).toHaveLength(2);
  });

  it("filters to contests that include an assigned crop", () => {
    const vm = buildContestsViewModel(contests, ["melon"], now, "UTC");
    expect(vm.filtered).toBe(true);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0]?.crops).toContain("melon");
  });

  it("is not filtered when assigned crops are not contest crops", () => {
    const vm = buildContestsViewModel(contests, ["sunflower"], now, "UTC");
    expect(vm.filtered).toBe(false);
    expect(vm.assignedButNoContestCrops).toBe(true);
    expect(vm.rows).toHaveLength(2);
  });

  it("falls back to the default time zone for an invalid zone name", () => {
    const vm = buildContestsViewModel(contests, [], now, "Not/AZone");
    expect(vm.rows[0]?.label).toContain("14:30");
  });
});
