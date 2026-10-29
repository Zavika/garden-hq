import { forecastComposter } from "./composter";
import { getCrop } from "./crops";
import type { ComposterState, Contest, GardenState } from "./types";

const MINUTE = 60_000;
const HOUR_MS = 60 * MINUTE;

export interface GreenhousePlan {
  lastWateredAt: number | null;
  wateringIntervalHours: number | null;
}

export function cropName(id: string): string {
  return getCrop(id)?.name ?? id;
}

/** Crop ids planted on plots that are really unlocked; stale assignments are ignored. */
export function myCropIds(
  assignments: Readonly<Record<string, string>>,
  unlockedPlotIds: readonly string[],
): Set<string> {
  const unlocked = new Set(unlockedPlotIds);
  return new Set(
    Object.entries(assignments)
      .filter(([plotId]) => unlocked.has(plotId))
      .map(([, cropId]) => cropId),
  );
}

export interface ContestHit {
  contest: Contest;
  matching: string[];
}

export function contestsStartingWithin(
  contests: readonly Contest[],
  mine: ReadonlySet<string>,
  now: number,
  windowMinutes: number,
): ContestHit[] {
  const hits: ContestHit[] = [];
  for (const contest of contests) {
    const until = contest.startsAt - now;
    if (until < 0 || until > windowMinutes * MINUTE) continue;
    const matching = contest.crops.filter((id) => mine.has(id));
    if (matching.length > 0) hits.push({ contest, matching });
  }
  return hits;
}

export type ComposterAlarm =
  | { kind: "no_fuel"; lastSave: number }
  | { kind: "fuel_low"; lastSave: number; stopsAt: number };

export function composterAlarm(
  composter: ComposterState,
  now: number,
  earlyWarningMinutes: number,
): ComposterAlarm | null {
  // A missing last_save (0) would otherwise count decades of runtime.
  const safe =
    composter.lastSave > 0 ? composter : { ...composter, lastSave: now };
  const forecast = forecastComposter(safe, now);

  if (forecast.status === "no_fuel") {
    return { kind: "no_fuel", lastSave: composter.lastSave };
  }
  if (
    forecast.status === "running" &&
    forecast.stopsBecause === "fuel" &&
    forecast.stopsAt !== null &&
    forecast.stopsAt - now <= earlyWarningMinutes * MINUTE
  ) {
    return {
      kind: "fuel_low",
      lastSave: composter.lastSave,
      stopsAt: forecast.stopsAt,
    };
  }
  return null;
}

export function visitorsAtLeast(
  visitors: GardenState["visitors"],
  threshold: number,
): GardenState["visitors"] {
  return visitors.length >= threshold && visitors.length > 0 ? visitors : [];
}

export interface GreenhouseDue {
  plotId: string;
  lastWateredAt: number;
  dueAt: number;
}

export function greenhousesDue(
  greenhouses: Readonly<Record<string, GreenhousePlan>>,
  now: number,
  leadMinutes: number,
): GreenhouseDue[] {
  const due: GreenhouseDue[] = [];
  for (const [plotId, plan] of Object.entries(greenhouses)) {
    // Never fires without a player-set interval AND a watering time: there is
    // no verified water duration to fall back on (data/VERIFY.md "Water/decay").
    if (plan.wateringIntervalHours === null || plan.lastWateredAt === null) {
      continue;
    }
    const dueAt = plan.lastWateredAt + plan.wateringIntervalHours * HOUR_MS;
    if (dueAt - now > leadMinutes * MINUTE) continue;
    due.push({ plotId, lastWateredAt: plan.lastWateredAt, dueAt });
  }
  return due;
}
