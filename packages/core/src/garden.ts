import gardenLevels from "../../../data/garden-levels.json";
import { asArray, asRecord } from "./coerce";
import { GREENHOUSE_GRID_SIZE } from "./greenhouse-data";
import type {
  ComposterState,
  ComposterUpgrades,
  GardenState,
  GreenhouseCellRef,
  GreenhouseState,
} from "./types";

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

function prettifyVisitorId(id: string): string {
  return id
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// VERIFY: active_commissions keys are internal visitor ids (e.g. "liam");
// other key formats are unconfirmed (see data/VERIFY.md). Display names come
// from prettifying the id until data/visitors.json (id -> name) exists.
function normalizeVisitors(raw: unknown): { id: string; name: string }[] {
  return Object.keys(asRecord(raw)).map((id) => ({
    id,
    name: prettifyVisitorId(id),
  }));
}

// VERIFY: `greenhouse_slots` lists LOCKED cells (owner-confirmed 2026-10-06);
// whether it applies to every Greenhouse a player owns is unconfirmed.
function normalizeGreenhouse(raw: unknown): GreenhouseState {
  const lockedCells: GreenhouseCellRef[] = [];
  const seen = new Set<string>();

  for (const entry of asArray(raw)) {
    const cell = asRecord(entry);
    const { x, z } = cell;
    if (
      typeof x !== "number" ||
      typeof z !== "number" ||
      !Number.isInteger(x) ||
      !Number.isInteger(z) ||
      x < 0 ||
      z < 0 ||
      x >= GREENHOUSE_GRID_SIZE ||
      z >= GREENHOUSE_GRID_SIZE
    ) {
      continue;
    }
    const key = `${x},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lockedCells.push({ x, z });
  }

  return { lockedCells };
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
    visitors: normalizeVisitors(data.active_commissions),
    greenhouse: normalizeGreenhouse(data.greenhouse_slots),
  };
}

// VERIFY: the live /v2/skyblock/garden response nests the garden under `garden`;
// the Phase 1 fixture is flat. Accept both until a real response is captured.
export function unwrapGardenResponse(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return null;

  const data = raw as Record<string, unknown>;
  if ("garden" in data) {
    return typeof data.garden === "object" ? data.garden : null;
  }

  return data.success === false ? null : raw;
}
