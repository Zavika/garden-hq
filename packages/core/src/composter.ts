import composterData from "../../../data/composter.json";
import type { ComposterState, ComposterUpgrades } from "./types";

interface UpgradeCurve {
  effectPerTier: number;
  maxEffect: number;
  maxTier: number | null;
}

interface ComposterData {
  baseCap: { fuel: number; organicMatter: number };
  baseRate: {
    minutesPerCompost: number;
    organicMatterPerCompost: number;
    fuelPerCompost: number;
  };
  upgrades: {
    speed: UpgradeCurve;
    multiDrop: UpgradeCurve;
    fuelCap: UpgradeCurve;
    organicMatterCap: UpgradeCurve;
    costReduction: UpgradeCurve;
  };
}

const DATA = composterData as ComposterData;

function effectAtTier(curve: UpgradeCurve, tier: number): number {
  return Math.min(tier * curve.effectPerTier, curve.maxEffect);
}

// VERIFY: base cap 40,000 is inferred -- the wiki's final caps (850,000 /
// 790,000) minus 27 / 25 tiers of +30,000 leave exactly 40,000, but no source
// states it (see data/VERIFY.md).
/** Fuel / organic-matter capacity; without `upgrades`, the fully-upgraded cap. */
export function composterCapacity(upgrades?: ComposterUpgrades): {
  fuel: number;
  organicMatter: number;
} {
  const { fuelCap, organicMatterCap } = DATA.upgrades;
  if (upgrades === undefined) {
    return {
      fuel: fuelCap.maxEffect,
      organicMatter: organicMatterCap.maxEffect,
    };
  }
  return {
    fuel: Math.min(
      DATA.baseCap.fuel + effectAtTier(fuelCap, upgrades.fuelCap),
      fuelCap.maxEffect,
    ),
    organicMatter: Math.min(
      DATA.baseCap.organicMatter +
        effectAtTier(organicMatterCap, upgrades.organicMatterCap),
      organicMatterCap.maxEffect,
    ),
  };
}

export function compostPerHour(upgrades: ComposterUpgrades): number {
  const baseline = 60 / DATA.baseRate.minutesPerCompost;
  const speedMultiplier = 1 + effectAtTier(DATA.upgrades.speed, upgrades.speed);
  const multiDropBonus =
    1 + effectAtTier(DATA.upgrades.multiDrop, upgrades.multiDrop);

  return baseline * speedMultiplier * multiDropBonus;
}

export function organicMatterPerHour(upgrades: ComposterUpgrades): number {
  return compostPerHour(upgrades) * DATA.baseRate.organicMatterPerCompost;
}

export function fuelPerHour(upgrades: ComposterUpgrades): number {
  return compostPerHour(upgrades) * DATA.baseRate.fuelPerCompost;
}

export type ComposterStatus = "running" | "no_fuel" | "no_organic_matter";

export interface ComposterForecast {
  organicMatter: number;
  fuel: number;
  status: ComposterStatus;
  /** When it will stop; always >= `nowMs`. Null unless `status` is running. */
  stopsAt: number | null;
  /** Which resource runs out first. Null unless `status` is running. */
  stopsBecause: "fuel" | "organic_matter" | null;
}

const HOUR_MS = 60 * 60 * 1000;

// VERIFY: this only forecasts fuel/organic-matter depletion, not the
// compost bin filling up -- the storage cap needed for a "full at" style
// prediction isn't confirmed anywhere (see data/VERIFY.md).
/**
 * The composter only consumes while it has BOTH fuel and organic matter, so
 * elapsed time is capped at the point the first of them ran out. With no fuel
 * nothing is consumed and the saved organic matter is still there.
 */
export function forecastComposter(
  state: ComposterState,
  nowMs: number,
): ComposterForecast {
  const elapsedHours = Math.max(0, nowMs - state.lastSave) / HOUR_MS;
  const fuelRate = fuelPerHour(state.upgrades);
  const organicRate = organicMatterPerHour(state.upgrades);

  const fuelHours = state.fuel > 0 ? state.fuel / fuelRate : 0;
  const organicHours =
    state.organicMatter > 0 ? state.organicMatter / organicRate : 0;
  const ranHours = Math.min(elapsedHours, fuelHours, organicHours);

  const fuel = Math.max(0, state.fuel - fuelRate * ranHours);
  const organicMatter = Math.max(
    0,
    state.organicMatter - organicRate * ranHours,
  );

  if (fuel <= 0) {
    return {
      organicMatter,
      fuel: 0,
      status: "no_fuel",
      stopsAt: null,
      stopsBecause: null,
    };
  }
  if (organicMatter <= 0) {
    return {
      organicMatter: 0,
      fuel,
      status: "no_organic_matter",
      stopsAt: null,
      stopsBecause: null,
    };
  }

  const fuelLeftHours = fuel / fuelRate;
  const organicLeftHours = organicMatter / organicRate;
  return {
    organicMatter,
    fuel,
    status: "running",
    stopsAt: nowMs + Math.min(fuelLeftHours, organicLeftHours) * HOUR_MS,
    stopsBecause: fuelLeftHours <= organicLeftHours ? "fuel" : "organic_matter",
  };
}
