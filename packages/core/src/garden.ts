import gardenLevels from "../../../data/garden-levels.json";
import type { ComposterState, ComposterUpgrades, GardenState } from "./types";

interface GardenLevelEntry {
  level: number;
  xpRequired: number;
  cumulativeXp: number;
}

const LEVELS = gardenLevels as GardenLevelEntry[];

export function levelForExperience(experience: number): number {
  let level = 1;
  for (const entry of LEVELS) {
    if (experience >= entry.cumulativeXp) {
      level = entry.level;
    }
  }
  return level;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeUpgrades(raw: unknown): ComposterUpgrades {
  const data = (raw ?? {}) as Record<string, unknown>;

  return {
    speed: asNumber(data.speed, 0),
    multiDrop: asNumber(data.multi_drop, 0),
    fuelCap: asNumber(data.fuel_cap, 0),
    organicMatterCap: asNumber(data.organic_matter_cap, 0),
    costReduction: asNumber(data.cost_reduction, 0),
  };
}

function normalizeComposter(raw: unknown): ComposterState {
  const data = (raw ?? {}) as Record<string, unknown>;

  return {
    organicMatter: asNumber(data.organic_matter, 0),
    fuel: asNumber(data.fuel_units, 0),
    compostUnits: asNumber(data.compost_units, 0),
    lastSave: asNumber(data.last_save, 0),
    upgrades: normalizeUpgrades(data.upgrades),
  };
}

function countCompletedVisitors(raw: unknown): number {
  const data = (raw ?? {}) as Record<string, unknown>;
  return asNumber(data.total_completed, 0);
}

export function normalizeGarden(raw: unknown): GardenState {
  const data = (raw ?? {}) as Record<string, unknown>;
  const experience = asNumber(data.garden_experience, 0);

  return {
    level: levelForExperience(experience),
    experience,
    unlockedPlotIds: asStringArray(data.unlocked_plots_ids),
    composter: normalizeComposter(data.composter_data),
    visitorsServedTotal: countCompletedVisitors(data.commission_data),
  };
}
