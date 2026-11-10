import { ALL_PLOTS } from "./plots";
import type { QuestContext } from "./quests";
import type { GardenMemberState, GardenState } from "./types";

export const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
export const EXPIRES = Date.UTC(2026, 10, 11, 0, 0, 0);
export const PROFILE_ID = "profile-1";
export const ALL_PLOT_IDS = ALL_PLOTS.map((plot) => plot.id);

export function makeGarden(overrides: Partial<GardenState> = {}): GardenState {
  return {
    level: 3,
    experience: 300,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 0,
      fuel: 0,
      compostUnits: 10,
      lastSave: 0,
      upgrades: {
        speed: 0,
        multiDrop: 0,
        fuelCap: 0,
        organicMatterCap: 0,
        costReduction: 0,
      },
    },
    visitorsServedTotal: 100,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...overrides,
  };
}

export function makeMember(
  overrides: Partial<GardenMemberState> = {},
): GardenMemberState {
  return {
    discoveredMutations: ["ashwreath", "shadevine"],
    analyzedMutations: ["ashwreath"],
    chips: {},
    hasGreenhouse: true,
    contestEntries: [],
    ...overrides,
  };
}

export function makeContext(
  overrides: Partial<QuestContext> = {},
): QuestContext {
  return {
    now: NOW,
    timeZone: "UTC",
    seed: "uuid-1",
    profileId: PROFILE_ID,
    garden: makeGarden(),
    gardenFetchedAt: NOW - 60_000,
    member: makeMember(),
    memberFetchedAt: NOW - 60_000,
    greenhouses: { beginner_1: { lastWateredAt: null } },
    contests: [
      { startsAt: NOW + 3_600_000, crops: ["wheat", "carrot", "potato"] },
    ],
    ...overrides,
  };
}
