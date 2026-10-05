import {
  composterCapacity,
  forecastComposter,
  type ComposterState,
} from "@garden-hq/core";

export interface ComposterViewModel {
  fuel: number;
  fuelRatio: number;
  organicMatter: number;
  organicMatterRatio: number;
  fuelRunsOutAt: number | null;
  organicMatterRunsOutAt: number | null;
  compostReady: number;
}

function ratio(value: number, cap: number): number {
  return cap > 0 ? Math.min(1, Math.max(0, value / cap)) : 0;
}

export function buildComposterViewModel(
  composter: ComposterState,
  now: number,
): ComposterViewModel {
  // A missing last_save (0) would drain everything to zero; treat as just saved.
  const safe =
    composter.lastSave > 0 ? composter : { ...composter, lastSave: now };
  const forecast = forecastComposter(safe, now);
  const cap = composterCapacity();

  return {
    fuel: forecast.fuel,
    fuelRatio: ratio(forecast.fuel, cap.fuel),
    organicMatter: forecast.organicMatter,
    organicMatterRatio: ratio(forecast.organicMatter, cap.organicMatter),
    fuelRunsOutAt: forecast.fuelDepletesAt,
    organicMatterRunsOutAt: forecast.organicMatterDepletesAt,
    compostReady: composter.compostUnits,
  };
}
