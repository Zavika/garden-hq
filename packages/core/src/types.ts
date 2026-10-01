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

export interface GardenState {
  level: number;
  experience: number;
  unlockedPlotIds: string[];
  composter: ComposterState;
  visitorsServedTotal: number;
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
