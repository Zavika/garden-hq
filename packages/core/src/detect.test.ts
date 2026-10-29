import { describe, expect, it } from "vitest";
import {
  composterAlarm,
  contestsStartingWithin,
  greenhousesDue,
  myCropIds,
  visitorsAtLeast,
} from "./detect";
import { fuelPerHour, organicMatterPerHour } from "./composter";
import type { ComposterState } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const upgrades = {
  speed: 0,
  multiDrop: 0,
  fuelCap: 0,
  organicMatterCap: 0,
  costReduction: 0,
};

function composter(over: Partial<ComposterState> = {}): ComposterState {
  return {
    organicMatter: organicMatterPerHour(upgrades) * 10,
    fuel: fuelPerHour(upgrades) * 10,
    compostUnits: 0,
    lastSave: NOW,
    upgrades,
    ...over,
  };
}

describe("myCropIds", () => {
  it("ignores assignments on plots that are not unlocked", () => {
    const mine = myCropIds({ beginner_1: "wheat", beginner_2: "carrot" }, [
      "beginner_1",
    ]);
    expect([...mine]).toEqual(["wheat"]);
  });
});

describe("contestsStartingWithin", () => {
  const mine = new Set(["wheat"]);
  it("returns contests inside the window that include one of my crops", () => {
    const hits = contestsStartingWithin(
      [{ startsAt: NOW + 4 * MIN, crops: ["wheat", "carrot", "potato"] }],
      mine,
      NOW,
      5,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matching).toEqual(["wheat"]);
  });
  it("skips contests outside the window, already started, or without my crops", () => {
    expect(
      contestsStartingWithin(
        [{ startsAt: NOW + 6 * MIN, crops: ["wheat"] }],
        mine,
        NOW,
        5,
      ),
    ).toEqual([]);
    expect(
      contestsStartingWithin(
        [{ startsAt: NOW - 1, crops: ["wheat"] }],
        mine,
        NOW,
        5,
      ),
    ).toEqual([]);
    expect(
      contestsStartingWithin(
        [{ startsAt: NOW + MIN, crops: ["carrot"] }],
        mine,
        NOW,
        5,
      ),
    ).toEqual([]);
  });
});

describe("composterAlarm", () => {
  it("reports no_fuel when the fuel is gone", () => {
    expect(composterAlarm(composter({ fuel: 0 }), NOW, 30)).toEqual({
      kind: "no_fuel",
      lastSave: NOW,
    });
  });
  it("reports fuel_low when fuel runs out inside the early-warning window", () => {
    const alarm = composterAlarm(
      composter({ fuel: fuelPerHour(upgrades) * 0.25 }),
      NOW,
      30,
    );
    expect(alarm?.kind).toBe("fuel_low");
  });
  it("is null when there is plenty of fuel, and not fuel_low outside the window", () => {
    expect(composterAlarm(composter(), NOW, 30)).toBeNull();
    expect(
      composterAlarm(composter({ fuel: fuelPerHour(upgrades) * 0.25 }), NOW, 5),
    ).toBeNull();
  });
  it("treats a missing last_save (0) as just saved", () => {
    expect(composterAlarm(composter({ lastSave: 0 }), NOW, 30)).toBeNull();
  });
});

describe("visitorsAtLeast", () => {
  const v = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `v${i}`, name: `V${i}` }));
  it("returns the queue only when it reaches the threshold", () => {
    expect(visitorsAtLeast(v(4), 5)).toEqual([]);
    expect(visitorsAtLeast(v(5), 5)).toHaveLength(5);
    expect(visitorsAtLeast(v(1), 1)).toHaveLength(1);
    expect(visitorsAtLeast([], 1)).toEqual([]);
  });
});

describe("greenhousesDue", () => {
  const plan = (
    lastWateredAt: number | null,
    wateringIntervalHours: number | null,
  ) => ({ lastWateredAt, wateringIntervalHours });
  it("is due once lastWateredAt + interval is within the lead", () => {
    const due = greenhousesDue({ beginner_1: plan(NOW - 3 * HOUR, 2) }, NOW, 0);
    expect(due).toEqual([
      {
        plotId: "beginner_1",
        lastWateredAt: NOW - 3 * HOUR,
        dueAt: NOW - HOUR,
      },
    ]);
    expect(greenhousesDue({ beginner_1: plan(NOW - HOUR, 2) }, NOW, 0)).toEqual(
      [],
    );
    expect(
      greenhousesDue({ beginner_1: plan(NOW - HOUR, 2) }, NOW, 90),
    ).toHaveLength(1);
  });
  it("never fires without an interval or a watering time", () => {
    expect(
      greenhousesDue(
        { a: plan(null, 2), b: plan(NOW - 5 * HOUR, null) },
        NOW,
        0,
      ),
    ).toEqual([]);
  });
});
