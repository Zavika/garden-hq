import { describe, expect, it } from "vitest";
import questData from "../../../data/quests.json";
import { ALL_MUTATIONS } from "./greenhouse-data";
import { cheapestNextPlot } from "./plots";
import {
  ALL_PLOT_IDS,
  EXPIRES,
  NOW,
  makeContext,
  makeGarden,
  makeMember,
} from "./quest-fixtures";
import {
  QUEST_KINDS,
  QUESTS_PER_DAY,
  addDays,
  dayKey,
  eligibleKinds,
  generateQuests,
  isFreshSnapshot,
  nextResetMs,
  questProgress,
  questTitle,
  questXp,
  type QuestRecord,
} from "./quests";

describe("quest data", () => {
  it("gives every kind positive XP", () => {
    for (const kind of QUEST_KINDS) expect(questXp(kind)).toBeGreaterThan(0);
  });
});

describe("dayKey / nextResetMs / addDays", () => {
  it("uses the player's time zone", () => {
    const t = Date.UTC(2026, 10, 10, 23, 30);
    expect(dayKey(t, "UTC")).toBe("2026-11-10");
    expect(dayKey(t, "Europe/Warsaw")).toBe("2026-11-11");
  });
  it("falls back to the default zone for an invalid zone", () => {
    expect(dayKey(NOW, "Nope/Zone")).toBe(dayKey(NOW, "Europe/Warsaw"));
  });
  it("resets at local midnight", () => {
    expect(nextResetMs(NOW, "UTC")).toBe(EXPIRES);
    expect(nextResetMs(NOW, "Europe/Warsaw")).toBe(
      Date.UTC(2026, 10, 10, 23, 0),
    );
  });
  it("handles the spring-forward day", () => {
    expect(nextResetMs(Date.UTC(2026, 2, 29, 0, 30), "Europe/Warsaw")).toBe(
      Date.UTC(2026, 2, 29, 22, 0),
    );
  });
  it("adds calendar days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("isFreshSnapshot", () => {
  it("accepts recent, rejects old, future and null", () => {
    expect(isFreshSnapshot(NOW - 60_000, NOW)).toBe(true);
    expect(isFreshSnapshot(NOW - 11 * 60_000, NOW)).toBe(false);
    expect(isFreshSnapshot(NOW + 2 * 60_000, NOW)).toBe(true);
    expect(isFreshSnapshot(NOW + 6 * 60_000, NOW)).toBe(false);
    expect(isFreshSnapshot(null, NOW)).toBe(false);
    expect(isFreshSnapshot(Number.NaN, NOW)).toBe(false);
  });
});

describe("eligibleKinds", () => {
  it("offers everything for a fully populated context", () => {
    expect(eligibleKinds(makeContext(), EXPIRES).sort()).toEqual(
      [
        "analyze_mutation",
        "contest_crop",
        "discover_mutation",
        "gain_garden_xp",
        "serve_visitors",
        "unlock_plot",
        "water_greenhouse",
      ].sort(),
    );
  });
  it("drops member kinds when member data is missing or stale", () => {
    const missing = eligibleKinds(
      makeContext({ member: null, memberFetchedAt: null }),
      EXPIRES,
    );
    const stale = eligibleKinds(
      makeContext({ memberFetchedAt: NOW - 3_600_000 }),
      EXPIRES,
    );
    for (const kinds of [missing, stale]) {
      expect(kinds).not.toContain("discover_mutation");
      expect(kinds).not.toContain("analyze_mutation");
      expect(kinds).not.toContain("contest_crop");
    }
  });
  it("needs a marked Greenhouse to water", () => {
    expect(
      eligibleKinds(makeContext({ greenhouses: {} }), EXPIRES),
    ).not.toContain("water_greenhouse");
  });
  it("needs a contest later today", () => {
    const tomorrow = [{ startsAt: EXPIRES + 1, crops: ["wheat"] }];
    const past = [{ startsAt: NOW - 1, crops: ["wheat"] }];
    expect(
      eligibleKinds(makeContext({ contests: tomorrow }), EXPIRES),
    ).not.toContain("contest_crop");
    expect(
      eligibleKinds(makeContext({ contests: past }), EXPIRES),
    ).not.toContain("contest_crop");
  });
  it("drops garden XP at max level and plot unlock when every plot is owned", () => {
    const kinds = eligibleKinds(
      makeContext({
        garden: makeGarden({ level: 15, unlockedPlotIds: ALL_PLOT_IDS }),
      }),
      EXPIRES,
    );
    expect(kinds).not.toContain("gain_garden_xp");
    expect(kinds).not.toContain("unlock_plot");
  });
  it("drops mutation kinds when there is nothing left to discover or analyze", () => {
    const kinds = eligibleKinds(
      makeContext({
        member: makeMember({
          hasGreenhouse: false,
          analyzedMutations: ["ashwreath", "shadevine"],
        }),
      }),
      EXPIRES,
    );
    expect(kinds).not.toContain("discover_mutation");
    expect(kinds).not.toContain("analyze_mutation");
  });
});

describe("eligibleKinds boundaries", () => {
  it("drops discover_mutation once every mutation is discovered", () => {
    const kinds = eligibleKinds(
      makeContext({
        member: makeMember({
          hasGreenhouse: true,
          discoveredMutations: ALL_MUTATIONS.map((m) => m.id),
        }),
      }),
      EXPIRES,
    );
    expect(kinds).not.toContain("discover_mutation");
  });
  it("applies the unlock_plot shortfall boundary", () => {
    const beginner = ALL_PLOT_IDS.filter((id) => id.startsWith("beginner_"));
    const owned = [...beginner, "intermediate_1"];
    const level = 3;
    const cost = cheapestNextPlot(owned, level)?.cost ?? 0;
    expect(cost).toBe(24);
    expect(cost).toBeGreaterThan(questData.unlockMaxShortfall);
    const kindsAt = (compostUnits: number) =>
      eligibleKinds(
        makeContext({
          garden: makeGarden({
            level,
            unlockedPlotIds: owned,
            composter: { ...makeGarden().composter, compostUnits },
          }),
        }),
        EXPIRES,
      );
    expect(kindsAt(0)).not.toContain("unlock_plot");
    const edge = cost - questData.unlockMaxShortfall;
    expect(kindsAt(edge - 1)).not.toContain("unlock_plot");
    expect(kindsAt(edge)).toContain("unlock_plot");
  });
});

describe("generateQuests profile stamp", () => {
  it("stamps the profile id on every record", () => {
    const quests = generateQuests(makeContext({ profileId: "prof-x" }));
    expect(quests.length).toBeGreaterThan(0);
    for (const q of quests) expect(q.params.profileId).toBe("prof-x");
  });
});

describe("generateQuests", () => {
  it("makes up to QUESTS_PER_DAY distinct quests with frozen fields", () => {
    const quests = generateQuests(makeContext());
    expect(quests).toHaveLength(QUESTS_PER_DAY);
    expect(new Set(quests.map((q) => q.kind)).size).toBe(QUESTS_PER_DAY);
    quests.forEach((q, slot) => {
      expect(q).toMatchObject({
        day: "2026-11-10",
        slot,
        createdAt: NOW,
        expiresAt: EXPIRES,
        doneAt: null,
      });
      expect(q.xp).toBeGreaterThan(0);
    });
  });
  it("is deterministic for the same input and varies with the seed", () => {
    expect(generateQuests(makeContext())).toEqual(
      generateQuests(makeContext()),
    );
    const kindsFor = (seed: string) =>
      generateQuests(makeContext({ seed }))
        .map((q) => q.kind)
        .join();
    const variants = new Set(
      Array.from({ length: 30 }, (_, i) => kindsFor(`seed-${i}`)),
    );
    expect(variants.size).toBeGreaterThan(1);
  });
  it("returns fewer quests rather than filler when little is eligible", () => {
    const quests = generateQuests(
      makeContext({
        member: null,
        memberFetchedAt: null,
        greenhouses: {},
        contests: [],
        garden: makeGarden({ level: 15, unlockedPlotIds: ALL_PLOT_IDS }),
      }),
    );
    expect(quests.map((q) => q.kind)).toEqual(["serve_visitors"]);
  });
  it("freezes the baseline from the supplied snapshot", () => {
    const ctx = makeContext({
      garden: makeGarden({ visitorsServedTotal: 777, experience: 4321 }),
      member: makeMember({
        discoveredMutations: ["a", "b", "c"],
        analyzedMutations: ["a"],
      }),
    });
    const byKind = new Map<string, QuestRecord>();
    for (let i = 0; i < 40; i++) {
      for (const q of generateQuests({ ...ctx, seed: `s${i}` }))
        byKind.set(q.kind, q);
    }
    expect(byKind.get("serve_visitors")?.baseline).toBe(777);
    expect(byKind.get("gain_garden_xp")?.baseline).toBe(4321);
    expect(byKind.get("discover_mutation")?.baseline).toBe(3);
    expect(byKind.get("analyze_mutation")?.baseline).toBe(1);
    expect(byKind.get("unlock_plot")?.params.plotId).toEqual(
      expect.any(String),
    );
    const target = byKind.get("serve_visitors")?.params.target;
    expect(target).toBeGreaterThanOrEqual(3);
    expect(target).toBeLessThanOrEqual(5);
  });
});

describe("questTitle / questProgress", () => {
  const rec = (over: Partial<QuestRecord>): QuestRecord => ({
    day: "2026-11-10",
    slot: 0,
    kind: "serve_visitors",
    params: { target: 4 },
    baseline: 100,
    createdAt: NOW,
    expiresAt: EXPIRES,
    doneAt: null,
    xp: 25,
    ...over,
  });
  it("keeps numbers as separate title parts", () => {
    expect(questTitle(rec({}))).toEqual(["Serve ", 4, " visitors"]);
    expect(
      questTitle(rec({ kind: "water_greenhouse", params: {} })).join(""),
    ).toBe("Water the Greenhouse");
  });
  it("shows clamped progress for counting kinds and null for the rest", () => {
    expect(
      questProgress(rec({}), makeGarden({ visitorsServedTotal: 102 })),
    ).toEqual({ current: 2, target: 4 });
    expect(
      questProgress(rec({}), makeGarden({ visitorsServedTotal: 150 })),
    ).toEqual({ current: 4, target: 4 });
    expect(
      questProgress(rec({}), makeGarden({ visitorsServedTotal: 90 })),
    ).toEqual({ current: 0, target: 4 });
    expect(
      questProgress(
        rec({ kind: "water_greenhouse", params: {}, baseline: null }),
        makeGarden(),
      ),
    ).toBeNull();
  });
});
