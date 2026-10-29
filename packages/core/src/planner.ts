import plannerData from "../../../data/planner.json";
import gardenLevels from "../../../data/garden-levels.json";
import {
  composterAlarm,
  contestsStartingWithin,
  cropName,
  greenhousesDue,
  myCropIds,
  visitorsAtLeast,
  type GreenhousePlan,
} from "./detect";
import { cheapestNextPlot, getPlot } from "./plots";
import type { Contest, GardenState } from "./types";

export type { GreenhousePlan } from "./detect";

interface PlannerData {
  thresholds: {
    contestWindowMinutes: number;
    fuelEarlyWarningMinutes: number;
    greenhouseLeadMinutes: number;
    visitorQueueMax: number;
  };
  maxActionsShown: number;
}

const DATA = plannerData as PlannerData;
const T = DATA.thresholds;

export const MAX_SHOWN_ACTIONS: number = DATA.maxActionsShown;

export type ActionKind =
  | "contest_soon"
  | "composter_no_fuel"
  | "composter_fuel_low"
  | "visitors_waiting"
  | "greenhouse_water"
  | "plot_unlock"
  | "garden_level";

export interface PlannedAction {
  kind: ActionKind;
  /** Stable across calls with the same input; safe as a React key and a dedupe key. */
  id: string;
  title: string;
  detail: string;
  /** When it becomes (or became) urgent; null means "now". */
  dueAt: number | null;
  /** Position in the ranked list, 0 first. */
  rank: number;
}

export interface PlannerInput {
  /** Epoch ms. */
  now: number;
  garden: GardenState;
  contests: Contest[];
  /** plotId -> cropId (user input). */
  assignments: Record<string, string>;
  /** Marked Greenhouse plotId -> watering state (user input). */
  greenhouses: Record<string, GreenhousePlan>;
}

type Draft = Omit<PlannedAction, "rank">;

/** CLAUDE.md §7 order; lower tier is shown first. */
const TIER: Record<ActionKind, number> = {
  contest_soon: 1,
  composter_no_fuel: 2,
  composter_fuel_low: 2,
  visitors_waiting: 3,
  greenhouse_water: 4,
  plot_unlock: 5,
  garden_level: 6,
};

const MINUTE = 60_000;

function minutesUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / MINUTE));
}

function contestActions({
  now,
  garden,
  contests,
  assignments,
}: PlannerInput): Draft[] {
  const mine = myCropIds(assignments, garden.unlockedPlotIds);
  return contestsStartingWithin(
    contests,
    mine,
    now,
    T.contestWindowMinutes,
  ).map(({ contest, matching }) => ({
    kind: "contest_soon",
    id: `contest_soon:${contest.startsAt}`,
    title: `${matching.map(cropName).join(", ")} contest in ${minutesUntil(contest.startsAt, now)} min`,
    detail: "A crop you have planted is in the next Jacob's Contest.",
    dueAt: contest.startsAt,
  }));
}

function composterActions({ now, garden }: PlannerInput): Draft[] {
  const alarm = composterAlarm(
    garden.composter,
    now,
    T.fuelEarlyWarningMinutes,
  );
  if (alarm === null) return [];
  if (alarm.kind === "no_fuel") {
    return [
      {
        kind: "composter_no_fuel",
        id: `composter_no_fuel:${alarm.lastSave}`,
        title: "Composter is out of fuel",
        detail: "Add fuel so it keeps making Compost.",
        dueAt: null,
      },
    ];
  }
  return [
    {
      kind: "composter_fuel_low",
      id: `composter_fuel_low:${alarm.lastSave}`,
      title: `Composter fuel runs out in ${minutesUntil(alarm.stopsAt, now)} min`,
      detail: "Top up fuel before it stops.",
      dueAt: alarm.stopsAt,
    },
  ];
}

interface GardenLevelEntry {
  level: number;
  cumulativeXp: number;
}
const LEVELS = gardenLevels as GardenLevelEntry[];

function visitorActions({ garden }: PlannerInput): Draft[] {
  // TODO(visitors.json): show copper and Garden XP value once data/visitors.json exists.
  const visitors = visitorsAtLeast(garden.visitors, 1);
  if (visitors.length === 0) return [];
  return [
    {
      kind: "visitors_waiting",
      id: `visitors_waiting:${visitors
        .map((v) => v.id)
        .sort()
        .join(",")}`,
      title: `${visitors.length}/${T.visitorQueueMax} visitors waiting`,
      detail: visitors.map((v) => v.name).join(", "),
      dueAt: null,
    },
  ];
}

function greenhouseActions({ now, greenhouses }: PlannerInput): Draft[] {
  return greenhousesDue(greenhouses, now, T.greenhouseLeadMinutes).map(
    ({ plotId, lastWateredAt, dueAt }) => {
      const plotNumber = getPlot(plotId)?.plotNumber;
      return {
        kind: "greenhouse_water",
        id: `greenhouse_water:${plotId}:${lastWateredAt}`,
        title: `Water the Greenhouse${plotNumber === undefined ? "" : ` (plot ${plotNumber})`}`,
        detail:
          dueAt <= now
            ? "Watering is due now."
            : `Due in ${minutesUntil(dueAt, now)} min.`,
        dueAt,
      };
    },
  );
}

function plotAction({ garden }: PlannerInput): Draft[] {
  const plot = cheapestNextPlot(garden.unlockedPlotIds, garden.level);
  if (plot === undefined) return [];
  // VERIFY: the API gives Compost in the composter bin only, not the player's
  // inventory, so a real shortfall cannot be computed (data/VERIFY.md).
  return [
    {
      kind: "plot_unlock",
      id: `plot_unlock:${plot.id}`,
      title: `Unlock plot ${plot.plotNumber}`,
      detail: `Costs ${plot.cost} Compost. Composter holds ${garden.composter.compostUnits} ready.`,
      dueAt: null,
    },
  ];
}

function levelAction({ garden }: PlannerInput): Draft[] {
  const next = LEVELS.find((entry) => entry.level === garden.level + 1);
  if (next === undefined) return [];
  const remaining = Math.max(0, next.cumulativeXp - garden.experience);
  return [
    {
      kind: "garden_level",
      id: `garden_level:${next.level}`,
      title: `${remaining} Garden XP to level ${next.level}`,
      detail: "Visitors and crop milestones give Garden XP.",
      dueAt: null,
    },
  ];
}

export function planActions(input: PlannerInput): PlannedAction[] {
  const drafts: Draft[] = [
    ...contestActions(input),
    ...composterActions(input),
    ...visitorActions(input),
    ...greenhouseActions(input),
    ...plotAction(input),
    ...levelAction(input),
  ];

  return drafts
    .sort(
      (a, b) =>
        TIER[a.kind] - TIER[b.kind] ||
        (a.dueAt ?? input.now) - (b.dueAt ?? input.now) ||
        a.id.localeCompare(b.id),
    )
    .map((draft, rank) => ({ ...draft, rank }));
}
