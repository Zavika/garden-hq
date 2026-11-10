import { describe, expect, it } from "vitest";
import achievementFile from "../../../data/achievements.json";
import gardenLevels from "../../../data/garden-levels.json";
import {
  ACHIEVEMENTS,
  achievementMetrics,
  achievementProgress,
  getAchievement,
  newlyUnlocked,
  type AchievementCheck,
  type AchievementContext,
} from "./achievements";
import { ALL_CROPS } from "./crops";
import { ALL_MUTATIONS } from "./greenhouse-data";
import { ALL_PLOTS } from "./plots";
import {
  EMPTY_PROGRESS,
  summarizeProgress,
  type UnlockedAchievement,
} from "./progress";
import { ALL_PLOT_IDS, makeGarden, makeMember } from "./quest-fixtures";

const CHECKS: AchievementCheck[] = [
  "first_greenhouse",
  "plots_unlocked",
  "crops_assigned",
  "mutations_discovered",
  "garden_level",
  "visitors_served",
  "streak",
  "quests_done",
];
const BASE_SUMMARY = summarizeProgress(EMPTY_PROGRESS, "2026-11-10");

function ctx(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    garden: makeGarden(),
    member: makeMember({ hasGreenhouse: false, discoveredMutations: [] }),
    assignments: {},
    greenhouses: {},
    summary: BASE_SUMMARY,
    ...overrides,
  };
}
function ids(list: { id: string }[]): string[] {
  return list.map((a) => a.id);
}

describe("achievement data", () => {
  it("has 23 unique ids and valid checks", () => {
    expect(ACHIEVEMENTS).toHaveLength(23);
    expect(new Set(ids([...ACHIEVEMENTS])).size).toBe(23);
    for (const a of ACHIEVEMENTS) {
      expect(CHECKS).toContain(a.check);
      expect(a.xp).toBeGreaterThan(0);
      expect(a.threshold).toBeGreaterThan(0);
    }
    expect(achievementFile.lastVerified).toBeTruthy();
  });
  it("keeps thresholds within game limits", () => {
    const max: Partial<Record<AchievementCheck, number>> = {
      plots_unlocked: ALL_PLOTS.length,
      crops_assigned: ALL_CROPS.length,
      mutations_discovered: ALL_MUTATIONS.length,
      garden_level: Math.max(...gardenLevels.map((l) => l.level)),
    };
    for (const a of ACHIEVEMENTS) {
      const limit = max[a.check];
      if (limit !== undefined) expect(a.threshold).toBeLessThanOrEqual(limit);
    }
  });
  it("looks up by id", () => {
    expect(getAchievement("plots_24")?.threshold).toBe(24);
    expect(getAchievement("nope")).toBeUndefined();
    expect(getAchievement("constructor")).toBeUndefined();
  });
});

describe("achievementMetrics", () => {
  it("first_greenhouse from member flag, marked greenhouse, or neither", () => {
    const flag = ctx({ member: makeMember({ hasGreenhouse: true }) });
    expect(achievementMetrics(flag).first_greenhouse).toBe(1);
    const marked = ctx({ greenhouses: { beginner_1: {} } });
    expect(achievementMetrics(marked).first_greenhouse).toBe(1);
    expect(achievementMetrics(ctx()).first_greenhouse).toBe(0);
  });
  it("crops_assigned ignores locked plots and counts distinct crops", () => {
    const c = ctx({
      assignments: {
        beginner_1: "wheat",
        beginner_2: "wheat",
        intermediate_1: "carrot",
      },
    });
    expect(achievementMetrics(c).crops_assigned).toBe(1);
  });
  it("null member gives zero mutations and no greenhouse", () => {
    const m = achievementMetrics(ctx({ member: null }));
    expect(m.mutations_discovered).toBe(0);
    expect(m.first_greenhouse).toBe(0);
  });
  it("maps the remaining metrics", () => {
    const m = achievementMetrics(
      ctx({
        garden: makeGarden({ level: 8, visitorsServedTotal: 77 }),
        summary: { ...BASE_SUMMARY, bestStreak: 4, doneQuests: 12 },
      }),
    );
    expect(m.plots_unlocked).toBe(2);
    expect(m.garden_level).toBe(8);
    expect(m.visitors_served).toBe(77);
    expect(m.streak).toBe(4);
    expect(m.quests_done).toBe(12);
  });
});

describe("newlyUnlocked", () => {
  it("unlocks exactly at the threshold, not one below", () => {
    const below = ctx({ garden: makeGarden({ visitorsServedTotal: 49 }) });
    expect(ids(newlyUnlocked(below, {}))).not.toContain("visitors_50");
    const at = ctx({ garden: makeGarden({ visitorsServedTotal: 50 }) });
    expect(ids(newlyUnlocked(at, {}))).toContain("visitors_50");
  });
  it("excludes already-unlocked ids", () => {
    const c = ctx({ garden: makeGarden({ visitorsServedTotal: 50 }) });
    const got = newlyUnlocked(c, { visitors_50: { at: 1, xp: 30 } });
    expect(ids(got)).not.toContain("visitors_50");
  });
  it("ignores inherited keys in the unlocked map", () => {
    const c = ctx({ garden: makeGarden({ visitorsServedTotal: 50 }) });
    const u = Object.create({
      visitors_50: { at: 1, xp: 30 },
    }) as Record<string, UnlockedAchievement>;
    expect(ids(newlyUnlocked(c, u))).toContain("visitors_50");
    const status = achievementProgress(c, u).find(
      (s) => s.def.id === "visitors_50",
    );
    expect(status?.unlocked).toBeNull();
  });
  it("veteran unlocks every satisfied tier at once", () => {
    const vet = ctx({
      garden: makeGarden({
        level: 15,
        unlockedPlotIds: ALL_PLOT_IDS,
        visitorsServedTotal: 5000,
      }),
      member: makeMember({
        hasGreenhouse: true,
        discoveredMutations: ALL_MUTATIONS.map((m) => m.id),
      }),
      assignments: Object.fromEntries(
        ALL_CROPS.map((crop, i) => [ALL_PLOT_IDS[i], crop.id]),
      ),
      summary: { ...BASE_SUMMARY, bestStreak: 30, doneQuests: 250 },
    });
    expect(newlyUnlocked(vet, {})).toHaveLength(ACHIEVEMENTS.length);
  });
});

describe("achievementProgress", () => {
  it("returns every definition with value and unlock info", () => {
    const entry = { at: 5, xp: 30 };
    const out = achievementProgress(
      ctx({ garden: makeGarden({ visitorsServedTotal: 60 }) }),
      { visitors_50: entry },
    );
    expect(out).toHaveLength(ACHIEVEMENTS.length);
    const v50 = out.find((s) => s.def.id === "visitors_50");
    expect(v50?.value).toBe(60);
    expect(v50?.unlocked).toEqual(entry);
    expect(out.find((s) => s.def.id === "visitors_250")?.unlocked).toBeNull();
  });
});
