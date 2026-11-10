import achievementFile from "../../../data/achievements.json";
import type { UnlockedAchievement, ProgressSummary } from "./progress";
import type { GardenMemberState, GardenState } from "./types";

export type AchievementCheck =
  | "first_greenhouse"
  | "plots_unlocked"
  | "crops_assigned"
  | "mutations_discovered"
  | "garden_level"
  | "visitors_served"
  | "streak"
  | "quests_done";

export interface AchievementDef {
  id: string;
  check: AchievementCheck;
  threshold: number;
  title: string;
  description: string;
  xp: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] =
  achievementFile.achievements as AchievementDef[];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

export interface AchievementContext {
  garden: GardenState;
  member: GardenMemberState | null;
  assignments: Record<string, string>;
  greenhouses: Record<string, unknown>;
  summary: ProgressSummary;
}

export function achievementMetrics(
  ctx: AchievementContext,
): Record<AchievementCheck, number> {
  const unlockedPlots = new Set(ctx.garden.unlockedPlotIds);
  const crops = new Set<string>();
  for (const [plotId, cropId] of Object.entries(ctx.assignments)) {
    if (unlockedPlots.has(plotId)) crops.add(cropId);
  }
  const hasGreenhouse =
    ctx.member?.hasGreenhouse === true ||
    Object.keys(ctx.greenhouses).length > 0;
  return {
    first_greenhouse: hasGreenhouse ? 1 : 0,
    plots_unlocked: ctx.garden.unlockedPlotIds.length,
    crops_assigned: crops.size,
    mutations_discovered: ctx.member?.discoveredMutations.length ?? 0,
    garden_level: ctx.garden.level,
    visitors_served: ctx.garden.visitorsServedTotal,
    streak: ctx.summary.bestStreak,
    quests_done: ctx.summary.doneQuests,
  };
}

export function newlyUnlocked(
  ctx: AchievementContext,
  unlocked: Record<string, UnlockedAchievement>,
): AchievementDef[] {
  const metrics = achievementMetrics(ctx);
  return ACHIEVEMENTS.filter(
    (a) => !Object.hasOwn(unlocked, a.id) && metrics[a.check] >= a.threshold,
  );
}

export interface AchievementStatus {
  def: AchievementDef;
  value: number;
  unlocked: UnlockedAchievement | null;
}

export function achievementProgress(
  ctx: AchievementContext,
  unlocked: Record<string, UnlockedAchievement>,
): AchievementStatus[] {
  const metrics = achievementMetrics(ctx);
  return ACHIEVEMENTS.map((def) => ({
    def,
    value: metrics[def.check],
    unlocked: Object.hasOwn(unlocked, def.id)
      ? (unlocked[def.id] ?? null)
      : null,
  }));
}
