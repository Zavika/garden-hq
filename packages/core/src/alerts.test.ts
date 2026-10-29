import { describe, expect, it } from "vitest";
import {
  ALERT_BOUNDS,
  alertParam,
  defaultAlertRules,
  deriveAlerts,
  nextSyncAt,
  parseAlertRules,
  type AlertInput,
  type AlertRules,
} from "./alerts";
import { fuelPerHour, organicMatterPerHour } from "./composter";
import type { ComposterState, GardenState } from "./types";

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

function garden(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 8,
    experience: 1000,
    unlockedPlotIds: ["beginner_1"],
    composter: composter(),
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

function allOn(): AlertRules {
  const rules = defaultAlertRules(true);
  rules.composter_fuel_low = { ...rules.composter_fuel_low, enabled: true };
  return rules;
}

function input(over: Partial<AlertInput> = {}): AlertInput {
  return {
    now: NOW,
    garden: garden(),
    contests: [],
    assignments: { beginner_1: "wheat" },
    greenhouses: {},
    rules: allOn(),
    ...over,
  };
}

describe("defaultAlertRules", () => {
  it("is all off before a verified test", () => {
    expect(
      Object.values(defaultAlertRules(false)).every((r) => !r.enabled),
    ).toBe(true);
  });
  it("turns on the four default rules after a test, fuel early warning stays off", () => {
    const rules = defaultAlertRules(true);
    expect(rules.contest_soon).toEqual({ enabled: true, leadMinutes: 5 });
    expect(rules.composter_fuel_out.enabled).toBe(true);
    expect(rules.composter_fuel_low).toEqual({
      enabled: false,
      leadMinutes: 30,
    });
    expect(rules.visitors_waiting).toEqual({ enabled: true, threshold: 5 });
    expect(rules.greenhouse_water.enabled).toBe(true);
  });
  it("knows which rule has which parameter", () => {
    expect(alertParam("contest_soon")).toBe("leadMinutes");
    expect(alertParam("visitors_waiting")).toBe("threshold");
    expect(alertParam("greenhouse_water")).toBeNull();
  });
});

describe("parseAlertRules", () => {
  const base = defaultAlertRules(true);
  it("merges a partial patch over the base", () => {
    const r = parseAlertRules(
      { contest_soon: { enabled: false, leadMinutes: 10 } },
      base,
    );
    expect(r.ok && r.rules.contest_soon).toEqual({
      enabled: false,
      leadMinutes: 10,
    });
    expect(r.ok && r.rules.visitors_waiting).toEqual(base.visitors_waiting);
  });
  it.each([
    ["unknown type", { nope: { enabled: true } }],
    ["non-object", []],
    ["non-boolean enabled", { contest_soon: { enabled: "yes" } }],
    [
      "lead below min",
      { contest_soon: { leadMinutes: ALERT_BOUNDS.leadMinutes.min - 1 } },
    ],
    [
      "lead above max",
      { contest_soon: { leadMinutes: ALERT_BOUNDS.leadMinutes.max + 1 } },
    ],
    ["threshold above the queue", { visitors_waiting: { threshold: 6 } }],
    ["non-integer", { contest_soon: { leadMinutes: 2.5 } }],
    ["param on the wrong rule", { contest_soon: { threshold: 3 } }],
    ["unknown field", { contest_soon: { colour: "red" } }],
  ])("rejects %s", (_name, raw) => {
    expect(parseAlertRules(raw, base).ok).toBe(false);
  });
  it("enforces a 5 minute lead floor (the cron ticks every 5 minutes)", () => {
    expect(parseAlertRules({ contest_soon: { leadMinutes: 4 } }, base).ok).toBe(
      false,
    );
    expect(parseAlertRules({ contest_soon: { leadMinutes: 5 } }, base).ok).toBe(
      true,
    );
  });
});

describe("deriveAlerts", () => {
  it("returns nothing when every rule is off, even if everything is due", () => {
    const out = deriveAlerts(
      input({
        rules: defaultAlertRules(false),
        garden: garden({ composter: composter({ fuel: 0 }) }),
        contests: [{ startsAt: NOW + MIN, crops: ["wheat"] }],
      }),
    );
    expect(out).toEqual([]);
  });

  describe("contest_soon", () => {
    const contest = (mins: number) => [
      { startsAt: NOW + mins * MIN, crops: ["wheat", "carrot", "potato"] },
    ];
    it("fires once per contest, keyed by start time, inside the lead", () => {
      const out = deriveAlerts(input({ contests: contest(4) }));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: "contest_soon",
        key: String(NOW + 4 * MIN),
        dueAt: NOW + 4 * MIN,
      });
      expect(out[0]?.title).toContain("Wheat");
    });
    it("waits until the lead and honours a custom lead", () => {
      expect(deriveAlerts(input({ contests: contest(6) }))).toEqual([]);
      const rules = allOn();
      rules.contest_soon = { enabled: true, leadMinutes: 10 };
      expect(deriveAlerts(input({ contests: contest(8), rules }))).toHaveLength(
        1,
      );
    });
    it("ignores contests for crops that are not mine or sit on locked plots", () => {
      expect(
        deriveAlerts(
          input({ contests: contest(4), assignments: { beginner_1: "melon" } }),
        ),
      ).toEqual([]);
      expect(
        deriveAlerts(
          input({ contests: contest(4), assignments: { beginner_2: "wheat" } }),
        ),
      ).toEqual([]);
    });
  });

  describe("composter", () => {
    it("fires fuel_out once, keyed by last_save, so a refill re-arms it", () => {
      const a = deriveAlerts(
        input({ garden: garden({ composter: composter({ fuel: 0 }) }) }),
      );
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({
        type: "composter_fuel_out",
        key: String(NOW),
      });
      const b = deriveAlerts(
        input({
          garden: garden({
            composter: composter({ fuel: 0, lastSave: NOW - HOUR }),
          }),
        }),
      );
      expect(b[0]?.key).toBe(String(NOW - HOUR));
    });
    it("fires fuel_low only when that optional rule is on and fuel is about to run out", () => {
      const low = garden({
        composter: composter({ fuel: fuelPerHour(upgrades) * 0.25 }),
      });
      const out = deriveAlerts(input({ garden: low }));
      expect(out.map((o) => o.type)).toEqual(["composter_fuel_low"]);
      const rules = allOn();
      rules.composter_fuel_low = {
        ...rules.composter_fuel_low,
        enabled: false,
      };
      expect(deriveAlerts(input({ garden: low, rules }))).toEqual([]);
    });
    it("does nothing with plenty of fuel", () => {
      expect(deriveAlerts(input())).toEqual([]);
    });
  });

  describe("visitors_waiting", () => {
    const queue = (ids: string[]) =>
      ids.map((id) => ({ id, name: id.toUpperCase() }));
    it("fires only when the queue reaches the threshold; key is the sorted ids", () => {
      expect(
        deriveAlerts(
          input({ garden: garden({ visitors: queue(["a", "b", "c", "d"]) }) }),
        ),
      ).toEqual([]);
      const out = deriveAlerts(
        input({
          garden: garden({ visitors: queue(["e", "d", "c", "b", "a"]) }),
        }),
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: "visitors_waiting",
        key: "a,b,c,d,e",
      });
    });
    it("honours a lower threshold", () => {
      const rules = allOn();
      rules.visitors_waiting = { enabled: true, threshold: 2 };
      expect(
        deriveAlerts(
          input({ rules, garden: garden({ visitors: queue(["a", "b"]) }) }),
        ),
      ).toHaveLength(1);
    });
  });

  describe("greenhouse_water", () => {
    it("fires once the player-set interval has elapsed; key changes when watered again", () => {
      const gh = {
        beginner_1: { lastWateredAt: NOW - 3 * HOUR, wateringIntervalHours: 2 },
      };
      const out = deriveAlerts(input({ greenhouses: gh }));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        type: "greenhouse_water",
        key: `beginner_1:${NOW - 3 * HOUR}`,
      });
      expect(out[0]?.title).toContain("Water the Greenhouse");
    });
    it("never fires without an interval, a watering time, or before it is due", () => {
      expect(
        deriveAlerts(
          input({
            greenhouses: {
              a: { lastWateredAt: null, wateringIntervalHours: 2 },
            },
          }),
        ),
      ).toEqual([]);
      expect(
        deriveAlerts(
          input({
            greenhouses: {
              a: { lastWateredAt: NOW - 5 * HOUR, wateringIntervalHours: null },
            },
          }),
        ),
      ).toEqual([]);
      expect(
        deriveAlerts(
          input({
            greenhouses: {
              a: { lastWateredAt: NOW - HOUR, wateringIntervalHours: 2 },
            },
          }),
        ),
      ).toEqual([]);
    });
  });

  it("is stable: identical input gives identical candidates and keys", () => {
    const i = input({
      garden: garden({
        composter: composter({ fuel: 0 }),
        visitors: [{ id: "a", name: "A" }],
      }),
      contests: [{ startsAt: NOW + 3 * MIN, crops: ["wheat"] }],
    });
    expect(deriveAlerts(i)).toEqual(deriveAlerts(i));
  });
});

describe("nextSyncAt", () => {
  it("is the baseline when nothing is coming up", () => {
    expect(nextSyncAt(input(), NOW)).toBe(NOW + 15 * MIN);
  });
  it("speeds up when a contest alert is due within the horizon", () => {
    const i = input({
      contests: [{ startsAt: NOW + 15 * MIN, crops: ["wheat"] }],
    });
    expect(nextSyncAt(i, NOW)).toBe(NOW + 5 * MIN);
  });
  it("does not speed up for an alert that is already due", () => {
    const i = input({
      contests: [{ startsAt: NOW + 3 * MIN, crops: ["wheat"] }],
    });
    expect(nextSyncAt(i, NOW)).toBe(NOW + 15 * MIN);
  });
  it("speeds up when fuel runs out soon or a Greenhouse is about to need water", () => {
    const fuel = garden({
      composter: composter({ fuel: fuelPerHour(upgrades) * 0.15 }),
    });
    expect(nextSyncAt(input({ garden: fuel }), NOW)).toBe(NOW + 5 * MIN);
    const gh = {
      beginner_1: { lastWateredAt: NOW - HOUR, wateringIntervalHours: 1.25 },
    };
    expect(nextSyncAt(input({ greenhouses: gh }), NOW)).toBe(NOW + 5 * MIN);
  });
  it("ignores events whose rule is off", () => {
    const rules = defaultAlertRules(false);
    const i = input({
      rules,
      contests: [{ startsAt: NOW + 15 * MIN, crops: ["wheat"] }],
    });
    expect(nextSyncAt(i, NOW)).toBe(NOW + 15 * MIN);
  });
});
