import {
  composterCapacity,
  forecastComposter,
  type ComposterState,
  type ComposterStatus,
} from "@garden-hq/core";

export interface ComposterViewModel {
  fuel: number;
  fuelCap: number;
  fuelRatio: number;
  organicMatter: number;
  organicMatterCap: number;
  organicMatterRatio: number;
  /** Idle states carry no time: nothing is running, so nothing "runs out". */
  status: ComposterStatus;
  /** Future epoch ms the composter stops; null unless running. */
  stopsAt: number | null;
  stopsBecause: "fuel" | "organic_matter" | null;
  compostReady: number;
}

function ratio(value: number, cap: number): number {
  return cap > 0 ? Math.min(1, Math.max(0, value / cap)) : 0;
}

export function buildComposterViewModel(
  composter: ComposterState,
  now: number,
): ComposterViewModel {
  // A missing last_save (0) would otherwise count decades of runtime; treat it as just saved.
  const safe =
    composter.lastSave > 0 ? composter : { ...composter, lastSave: now };
  const forecast = forecastComposter(safe, now);
  const cap = composterCapacity(composter.upgrades);

  return {
    fuel: forecast.fuel,
    fuelCap: cap.fuel,
    fuelRatio: ratio(forecast.fuel, cap.fuel),
    organicMatter: forecast.organicMatter,
    organicMatterCap: cap.organicMatter,
    organicMatterRatio: ratio(forecast.organicMatter, cap.organicMatter),
    status: forecast.status,
    stopsAt: forecast.stopsAt,
    stopsBecause: forecast.stopsBecause,
    compostReady: composter.compostUnits,
  };
}
