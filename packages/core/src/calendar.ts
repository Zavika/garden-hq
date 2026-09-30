export const SKYBLOCK_EPOCH_MS = 1560275700000;
export const MS_PER_SKYBLOCK_DAY = 20 * 60 * 1000;
export const DAYS_PER_MONTH = 31;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

// VERIFY: month names are from general SkyBlock knowledge, not independently
// fetched from the wiki this session -- re-check against
// hypixelskyblock.minecraft.wiki before relying on this list for anything
// player-facing (see data/VERIFY.md).
export const MONTH_NAMES = [
  "Early Spring",
  "Spring",
  "Late Spring",
  "Early Summer",
  "Summer",
  "Late Summer",
  "Early Autumn",
  "Autumn",
  "Late Autumn",
  "Early Winter",
  "Winter",
  "Late Winter",
] as const;

export interface SkyblockDate {
  year: number;
  month: number;
  monthName: string;
  day: number;
}

export function skyblockDate(date: Date): SkyblockDate {
  const elapsedMs = date.getTime() - SKYBLOCK_EPOCH_MS;
  const elapsedDays = Math.floor(elapsedMs / MS_PER_SKYBLOCK_DAY);
  const year = Math.floor(elapsedDays / DAYS_PER_YEAR) + 1;
  const dayOfYear =
    ((elapsedDays % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
  const day = (dayOfYear % DAYS_PER_MONTH) + 1;

  return {
    year,
    month,
    monthName: MONTH_NAMES[month - 1] ?? "Unknown",
    day,
  };
}

// VERIFY: day/night is assumed to be an even 50/50 split within the
// 20-minute SkyBlock day, aligned to the epoch. Vanilla Minecraft's exact
// dawn/dusk tick boundaries may differ slightly -- re-check if in-game
// timing drifts from this (see data/VERIFY.md).
export function isDaytime(date: Date): boolean {
  const elapsedMs = date.getTime() - SKYBLOCK_EPOCH_MS;
  const msIntoDay =
    ((elapsedMs % MS_PER_SKYBLOCK_DAY) + MS_PER_SKYBLOCK_DAY) %
    MS_PER_SKYBLOCK_DAY;
  return msIntoDay < MS_PER_SKYBLOCK_DAY / 2;
}
