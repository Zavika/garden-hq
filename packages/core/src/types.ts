export interface ComposterUpgrades {
  speed: number;
  multiDrop: number;
  fuelCap: number;
  organicMatterCap: number;
  costReduction: number;
}

export interface ComposterState {
  organicMatter: number;
  fuel: number;
  compostUnits: number;
  lastSave: number;
  upgrades: ComposterUpgrades;
}

export interface GreenhouseCellRef {
  x: number;
  z: number;
}

export interface GreenhouseState {
  /** Locked cells of the 10x10 Greenhouse grid (`garden.greenhouse_slots`). */
  lockedCells: GreenhouseCellRef[];
}

export interface ContestEntry {
  /** Start of the contest's SkyBlock day, epoch ms. */
  startsAt: number;
  apiCropId: string;
  /** Our crop id, or null when the API id is unmapped. */
  cropId: string | null;
  collected: number;
}

export interface GardenMemberState {
  discoveredMutations: string[];
  analyzedMutations: string[];
  /** Chip id -> chip level. */
  chips: Record<string, number>;
  hasGreenhouse: boolean;
  /** Jacob's contest results, sorted by startsAt ascending. */
  contestEntries: ContestEntry[];
}

export interface GardenState {
  level: number;
  experience: number;
  unlockedPlotIds: string[];
  composter: ComposterState;
  visitorsServedTotal: number;
  visitors: { id: string; name: string }[];
  greenhouse: GreenhouseState;
}

export interface ProfileSummary {
  profileId: string;
  name: string;
  selected: boolean;
}

export interface ProfilesResult {
  profiles: ProfileSummary[];
  selectedProfileId: string | null;
}

export interface MayorPerk {
  name: string;
  description: string;
}

export interface Mayor {
  key: string;
  name: string;
  perks: MayorPerk[];
  minister: { key: string; name: string; perk: MayorPerk | null } | null;
}

export interface Contest {
  /** Contest start, epoch milliseconds. */
  startsAt: number;
  /** Crop ids from data/crops.json. */
  crops: string[];
}
