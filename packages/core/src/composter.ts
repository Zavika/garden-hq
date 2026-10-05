import composterData from "../../../data/composter.json";
import type { ComposterState, ComposterUpgrades } from "./types";

interface UpgradeCurve {
  effectPerTier: number;
  maxEffect: number;
  maxTier: number | null;
}

interface ComposterData {
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

// VERIFY: the per-player cap (base + tiers) is unconfirmed; the gauge uses
// the fully-upgraded cap as its denominator (see data/VERIFY.md).
export function composterCapacity(): { fuel: number; organicMatter: number } {
  return {
    fuel: DATA.upgrades.fuelCap.maxEffect,
    organicMatter: DATA.upgrades.organicMatterCap.maxEffect,
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

export interface ComposterForecast {
  organicMatter: number;
  fuel: number;
  fuelDepletesAt: number | null;
  organicMatterDepletesAt: number | null;
}

// VERIFY: this only forecasts fuel/organic-matter depletion, not the
// compost bin filling up -- the storage cap needed for a "full at" style
// prediction isn't confirmed anywhere (see data/VERIFY.md).
export function forecastComposter(
  state: ComposterState,
  nowMs: number,
): ComposterForecast {
  const elapsedHours = Math.max(0, nowMs - state.lastSave) / (60 * 60 * 1000);
  const fuelUsedPerHour = fuelPerHour(state.upgrades);
  const organicMatterUsedPerHour = organicMatterPerHour(state.upgrades);

  const fuel = Math.max(0, state.fuel - fuelUsedPerHour * elapsedHours);
  const organicMatter = Math.max(
    0,
    state.organicMatter - organicMatterUsedPerHour * elapsedHours,
  );

  const fuelDepletesAt =
    fuelUsedPerHour > 0
      ? state.lastSave + (state.fuel / fuelUsedPerHour) * 60 * 60 * 1000
      : null;

  const organicMatterDepletesAt =
    organicMatterUsedPerHour > 0
      ? state.lastSave +
        (state.organicMatter / organicMatterUsedPerHour) * 60 * 60 * 1000
      : null;

  return { organicMatter, fuel, fuelDepletesAt, organicMatterDepletesAt };
}
