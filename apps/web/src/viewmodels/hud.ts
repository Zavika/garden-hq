import {
  isDaytime,
  seasonOf,
  skyblockDate,
  type Contest,
  type Mayor,
  type SkyblockDate,
} from "@garden-hq/core";

export type NextContest =
  | { status: "unavailable" }
  | { status: "none" }
  | {
      status: "ok";
      startsAt: number;
      crops: string[];
      matchesAssigned: boolean;
    };

export interface HudViewModel {
  date: SkyblockDate;
  season: string;
  isDay: boolean;
  nextContest: NextContest;
  /** null = Mayor data unavailable. */
  mayor: Mayor | null;
}

export function buildHudViewModel(
  now: number,
  contests: Contest[] | null,
  mayor: Mayor | null,
  assignedCropIds: string[],
): HudViewModel {
  const when = new Date(now);
  const date = skyblockDate(when);

  let nextContest: NextContest;
  if (contests === null) {
    nextContest = { status: "unavailable" };
  } else {
    const next = contests
      .filter((c) => c.startsAt > now)
      .sort((a, b) => a.startsAt - b.startsAt)[0];
    nextContest =
      next === undefined
        ? { status: "none" }
        : {
            status: "ok",
            startsAt: next.startsAt,
            crops: next.crops,
            matchesAssigned: next.crops.some((c) =>
              assignedCropIds.includes(c),
            ),
          };
  }

  return {
    date,
    season: seasonOf(date),
    isDay: isDaytime(when),
    nextContest,
    mayor,
  };
}
