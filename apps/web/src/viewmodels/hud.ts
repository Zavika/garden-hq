import {
  isDaytime,
  seasonOf,
  skyblockDate,
  type Contest,
  type Mayor,
  type SkyblockDate,
} from "@garden-hq/core";

/** A remote slot: still fetching, failed, or loaded. */
export type Slot<T> =
  { status: "loading" } | { status: "unavailable" } | { status: "ok"; data: T };

export type NextContest =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "none" }
  | {
      status: "ok";
      startsAt: number;
      crops: string[];
      matchesAssigned: boolean;
    };

export type MayorSlot =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ok"; mayor: Mayor };

export interface HudViewModel {
  date: SkyblockDate;
  season: string;
  isDay: boolean;
  nextContest: NextContest;
  mayor: MayorSlot;
}

export function buildHudViewModel(
  now: number,
  contests: Slot<Contest[]>,
  mayor: Slot<Mayor | null>,
  assignedCropIds: string[],
): HudViewModel {
  const when = new Date(now);
  const date = skyblockDate(when);

  let nextContest: NextContest;
  if (contests.status !== "ok") {
    nextContest = { status: contests.status };
  } else {
    const next = contests.data
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

  const mayorSlot: MayorSlot =
    mayor.status !== "ok"
      ? { status: mayor.status }
      : mayor.data === null
        ? { status: "unavailable" }
        : { status: "ok", mayor: mayor.data };

  return {
    date,
    season: seasonOf(date),
    isDay: isDaytime(when),
    nextContest,
    mayor: mayorSlot,
  };
}

/** Maps a TanStack query result onto a Slot. */
export function toSlot<T>(query: {
  data: T | undefined;
  isError: boolean;
}): Slot<T> {
  if (query.data !== undefined) return { status: "ok", data: query.data };
  return { status: query.isError ? "unavailable" : "loading" };
}
