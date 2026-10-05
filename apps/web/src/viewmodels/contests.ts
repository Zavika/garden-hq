import type { Contest } from "@garden-hq/core";
import { DEFAULT_TIME_ZONE } from "../state/storage";

const MAX_ROWS = 20;

export interface ContestRow {
  startsAt: number;
  label: string;
  crops: string[];
  matchesAssigned: boolean;
}

export interface ContestsViewModel {
  rows: ContestRow[];
  /** true when the list was narrowed to the player's assigned crops. */
  filtered: boolean;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      ...options,
      timeZone: DEFAULT_TIME_ZONE,
    });
  }
}

export function buildContestsViewModel(
  contests: Contest[],
  assignedCropIds: string[],
  now: number,
  timeZone: string,
): ContestsViewModel {
  const fmt = formatter(timeZone);
  const filtered = assignedCropIds.length > 0;

  const rows = contests
    .filter((c) => c.startsAt >= now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((c) => ({
      startsAt: c.startsAt,
      label: fmt.format(new Date(c.startsAt)),
      crops: c.crops,
      matchesAssigned: c.crops.some((crop) => assignedCropIds.includes(crop)),
    }))
    .filter((row) => !filtered || row.matchesAssigned)
    .slice(0, MAX_ROWS);

  return { rows, filtered };
}
