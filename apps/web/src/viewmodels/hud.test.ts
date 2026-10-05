import { SKYBLOCK_EPOCH_MS, type Contest, type Mayor } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildHudViewModel } from "./hud";

const MAYOR: Mayor = {
  key: "finnegan",
  name: "Finnegan",
  perks: [{ name: "Farming Simulator", description: "…" }],
  minister: null,
};

const now = SKYBLOCK_EPOCH_MS;
const SOON: Contest = {
  startsAt: now + 600_000,
  crops: ["wheat", "carrot", "potato"],
};
const LATER: Contest = {
  startsAt: now + 3_600_000,
  crops: ["melon", "cactus", "pumpkin"],
};
const PAST: Contest = { startsAt: now - 1000, crops: ["wheat"] };

describe("buildHudViewModel", () => {
  it("derives date, season and day/night from the clock", () => {
    const vm = buildHudViewModel(now, [], MAYOR, []);
    expect(vm.date).toMatchObject({ year: 1, month: 1, day: 1 });
    expect(vm.season).toBe("Early Spring");
    expect(vm.isDay).toBe(true);
  });

  it("picks the earliest upcoming contest and flags assigned-crop matches", () => {
    const vm = buildHudViewModel(now, [LATER, PAST, SOON], MAYOR, ["carrot"]);
    expect(vm.nextContest).toEqual({
      status: "ok",
      startsAt: SOON.startsAt,
      crops: SOON.crops,
      matchesAssigned: true,
    });
  });

  it("reports matchesAssigned=false when no crop overlaps", () => {
    const vm = buildHudViewModel(now, [SOON], MAYOR, ["melon"]);
    expect(vm.nextContest).toMatchObject({
      status: "ok",
      matchesAssigned: false,
    });
  });

  it("distinguishes 'none upcoming' from 'unavailable'", () => {
    expect(buildHudViewModel(now, [PAST], MAYOR, []).nextContest).toEqual({
      status: "none",
    });
    expect(buildHudViewModel(now, null, MAYOR, []).nextContest).toEqual({
      status: "unavailable",
    });
  });

  it("passes the mayor through, or null when unavailable", () => {
    expect(buildHudViewModel(now, [], MAYOR, []).mayor).toBe(MAYOR);
    expect(buildHudViewModel(now, [], null, []).mayor).toBeNull();
  });
});
