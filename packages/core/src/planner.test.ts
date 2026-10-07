import { describe, expect, it } from "vitest";
import { fuelPerHour } from "./composter";
import { planActions, type PlannerInput } from "./planner";
import plannerData from "../../../data/planner.json";
import { ALL_PLOTS } from "./plots";
import type { GardenState } from "./types";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const UPGRADES = {
  speed: 0,
  multiDrop: 0,
  fuelCap: 0,
  organicMatterCap: 0,
  costReduction: 0,
};

function garden(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 1_000_000,
      fuel: 1_000_000,
      compostUnits: 3,
      lastSave: NOW,
      upgrades: UPGRADES,
    },
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

function input(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    now: NOW,
    garden: garden(),
    contests: [],
    assignments: {},
    greenhouses: {},
    ...over,
  };
}

function kinds(i: PlannerInput): string[] {
  return planActions(i).map((a) => a.kind);
}

describe("contest_soon", () => {
  const crops = ["wheat", "carrot", "potato"];

  it("fires for a contest within the window that includes an assigned crop", () => {
    const actions = planActions(
      input({
        assignments: { beginner_1: "wheat" },
        contests: [{ startsAt: NOW + 12 * MIN, crops }],
      }),
    );
    const action = actions.find((a) => a.kind === "contest_soon");
    expect(action?.title).toBe("Wheat contest in 12 min");
    expect(action?.id).toBe(`contest_soon:${NOW + 12 * MIN}`);
    expect(action?.dueAt).toBe(NOW + 12 * MIN);
  });

  it("ignores contests outside the window, already started, or for other crops", () => {
    const base = { assignments: { beginner_1: "wheat" } };
    expect(
      kinds(
        input({ ...base, contests: [{ startsAt: NOW + 61 * MIN, crops }] }),
      ),
    ).not.toContain("contest_soon");
    expect(
      kinds(input({ ...base, contests: [{ startsAt: NOW - MIN, crops }] })),
    ).not.toContain("contest_soon");
    expect(
      kinds(
        input({
          ...base,
          contests: [{ startsAt: NOW + 5 * MIN, crops: ["cactus"] }],
        }),
      ),
    ).not.toContain("contest_soon");
  });

  it("ignores assignments on plots the player has not unlocked", () => {
    expect(
      kinds(
        input({
          assignments: { advanced_5: "wheat" },
          contests: [{ startsAt: NOW + 5 * MIN, crops }],
        }),
      ),
    ).not.toContain("contest_soon");
  });
});

describe("composter", () => {
  function withComposter(fields: Partial<GardenState["composter"]>) {
    const base = garden();
    return input({
      garden: garden({ composter: { ...base.composter, ...fields } }),
    });
  }

  it("flags a composter that is out of fuel", () => {
    const action = planActions(withComposter({ fuel: 0 })).find(
      (a) => a.kind === "composter_no_fuel",
    );
    expect(action?.title).toBe("Composter is out of fuel");
    expect(action?.dueAt).toBeNull();
  });

  it("warns when fuel runs out inside the early-warning window", () => {
    const fuel = fuelPerHour(UPGRADES) * 0.25; // 15 minutes of fuel
    const action = planActions(withComposter({ fuel })).find(
      (a) => a.kind === "composter_fuel_low",
    );
    expect(action?.title).toBe("Composter fuel runs out in 15 min");
    expect(action?.dueAt).toBe(NOW + 15 * MIN);
  });

  it("stays quiet when fuel lasts beyond the window", () => {
    const fuel = fuelPerHour(UPGRADES) * 1; // 60 minutes
    const result = kinds(withComposter({ fuel }));
    expect(result).not.toContain("composter_fuel_low");
    expect(result).not.toContain("composter_no_fuel");
  });

  it("treats a missing last save as just saved", () => {
    // Plenty of organic matter so fuel is the limiter: without the guard the
    // bogus elapsed time drains fuel and reports no_fuel.
    const result = kinds(
      withComposter({ lastSave: 0, organicMatter: 100_000_000 }),
    );
    expect(result).not.toContain("composter_no_fuel");
    expect(result).not.toContain("composter_fuel_low");
  });
});

describe("visitors_waiting", () => {
  it("lists visitor names with the queue size and no copper value", () => {
    const action = planActions(
      input({
        garden: garden({
          visitors: [
            { id: "a", name: "Jacob" },
            { id: "b", name: "Rhys" },
          ],
        }),
      }),
    ).find((a) => a.kind === "visitors_waiting");
    expect(action?.title).toBe("2/5 visitors waiting");
    expect(action?.detail).toBe("Jacob, Rhys");
    expect(action?.id).toBe("visitors_waiting:a,b");
  });

  it("is absent with an empty queue", () => {
    expect(kinds(input())).not.toContain("visitors_waiting");
  });
});

describe("greenhouse_water", () => {
  it("fires once the interval is due or within the lead time", () => {
    const due = planActions(
      input({
        greenhouses: {
          beginner_3: {
            lastWateredAt: NOW - 9 * HOUR,
            wateringIntervalHours: 8,
          },
        },
      }),
    ).find((a) => a.kind === "greenhouse_water");
    expect(due?.detail).toBe("Watering is due now.");
    expect(due?.dueAt).toBe(NOW - HOUR);

    const soon = planActions(
      input({
        greenhouses: {
          beginner_3: {
            lastWateredAt: NOW - 8 * HOUR + 20 * MIN - 30_000,
            wateringIntervalHours: 8,
          },
        },
      }),
    ).find((a) => a.kind === "greenhouse_water");
    expect(soon?.detail).toBe("Due in 20 min.");
  });

  it("pins the lead-time boundary to the data file", () => {
    const lead = plannerData.thresholds.greenhouseLeadMinutes;
    const at = (minutesAway: number): string[] =>
      kinds(
        input({
          greenhouses: {
            beginner_3: {
              lastWateredAt: NOW + minutesAway * MIN - 8 * HOUR,
              wateringIntervalHours: 8,
            },
          },
        }),
      );
    expect(at(lead)).toContain("greenhouse_water");
    expect(at(lead + 1)).not.toContain("greenhouse_water");
  });

  it("stays quiet without an interval, without a watering time, or when not yet due", () => {
    const quiet = (g: {
      lastWateredAt: number | null;
      wateringIntervalHours: number | null;
    }) => kinds(input({ greenhouses: { beginner_3: g } }));

    expect(
      quiet({ lastWateredAt: NOW - HOUR, wateringIntervalHours: null }),
    ).not.toContain("greenhouse_water");
    expect(
      quiet({ lastWateredAt: null, wateringIntervalHours: 8 }),
    ).not.toContain("greenhouse_water");
    expect(
      quiet({ lastWateredAt: NOW, wateringIntervalHours: 8 }),
    ).not.toContain("greenhouse_water");
  });
});

describe("plot_unlock and garden_level", () => {
  it("suggests the cheapest plot with its cost and the composter's ready Compost", () => {
    const action = planActions(input()).find((a) => a.kind === "plot_unlock");
    expect(action?.title).toMatch(/^Unlock plot \d+$/);
    expect(action?.detail).toMatch(
      /^Costs \d+ Compost\. Composter holds 3 ready\.$/,
    );
  });

  it("shows the XP remaining to the next level", () => {
    // level 5 -> 6 needs cumulative 1120 XP; the player has 600.
    const action = planActions(input()).find((a) => a.kind === "garden_level");
    expect(action?.title).toBe("520 Garden XP to level 6");
  });

  it("is absent at max level with every plot owned", () => {
    const result = kinds(
      input({
        garden: garden({
          level: 15,
          experience: 60_120,
          unlockedPlotIds: ALL_PLOTS.map((p) => p.id),
        }),
      }),
    );
    expect(result).not.toContain("plot_unlock");
    expect(result).not.toContain("garden_level");
  });
});

describe("ordering", () => {
  const everything = (): PlannerInput => {
    const base = garden();
    return input({
      assignments: { beginner_1: "wheat" },
      contests: [
        { startsAt: NOW + 10 * MIN, crops: ["wheat", "carrot", "potato"] },
      ],
      garden: garden({
        visitors: [{ id: "a", name: "Jacob" }],
        composter: { ...base.composter, fuel: 0 },
      }),
      greenhouses: {
        beginner_3: { lastWateredAt: NOW - 9 * HOUR, wateringIntervalHours: 8 },
      },
    });
  };

  it("follows the CLAUDE.md §7 tier order and numbers the ranks", () => {
    const actions = planActions(everything());
    expect(actions.map((a) => a.kind)).toEqual([
      "contest_soon",
      "composter_no_fuel",
      "visitors_waiting",
      "greenhouse_water",
      "plot_unlock",
      "garden_level",
    ]);
    expect(actions.map((a) => a.rank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("orders inside a tier by dueAt, soonest first", () => {
    const crops = ["wheat", "carrot", "potato"];
    const actions = planActions(
      input({
        assignments: { beginner_1: "wheat" },
        contests: [
          { startsAt: NOW + 40 * MIN, crops },
          { startsAt: NOW + 10 * MIN, crops },
        ],
      }),
    ).filter((a) => a.kind === "contest_soon");
    expect(actions.map((a) => a.dueAt)).toEqual([
      NOW + 10 * MIN,
      NOW + 40 * MIN,
    ]);
  });

  it("is deterministic for the same input", () => {
    expect(planActions(everything())).toEqual(planActions(everything()));
  });
});
