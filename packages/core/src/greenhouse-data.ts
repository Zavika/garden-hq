import greenhouseCropData from "../../../data/greenhouse-crops.json";
import mutationData from "../../../data/mutations.json";

export type MutationRarity =
  "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface RecipeIngredient {
  id: string;
  count: number;
  /** false for ingredients a player cannot put in a cell (e.g. "fire"). */
  placeable: boolean;
}

export type MutationRecipe =
  | { kind: "neighbours"; ingredients: RecipeIngredient[] }
  | { kind: "special"; text: string };

export interface MutationDefinition {
  id: string;
  name: string;
  rarity: MutationRarity;
  recipe: MutationRecipe;
  effects: string[];
  growth: {
    stages: number | null;
    medium: string | null;
    footprint: 1 | 2 | 3;
  };
  /** null = unknown; see data/VERIFY.md. */
  needsWater: boolean | null;
  notes: string;
}

export interface GreenhouseCrop {
  id: string;
  name: string;
  countsForBonus: boolean;
}

interface RawMutation extends Omit<MutationDefinition, "recipe"> {
  recipe:
    | { kind: "neighbours"; ingredients: Record<string, number> }
    | { kind: "special"; text: string };
}

interface RawMutationFile {
  lastVerified: string | null;
  source: string;
  mutations: RawMutation[];
}

interface RawGreenhouseCropFile {
  gridSize: number;
  unlockGardenLevel: number;
  bonusPercentPerUniqueCrop: number;
  maxUniqueCrops: number;
  crops: GreenhouseCrop[];
}

const mutationFile = mutationData as unknown as RawMutationFile;
const cropFile = greenhouseCropData as unknown as RawGreenhouseCropFile;

export const GREENHOUSE_GRID_SIZE: number = cropFile.gridSize;
export const GREENHOUSE_UNLOCK_LEVEL: number = cropFile.unlockGardenLevel;
export const BONUS_PERCENT_PER_UNIQUE_CROP: number =
  cropFile.bonusPercentPerUniqueCrop;
export const MAX_UNIQUE_CROPS: number = cropFile.maxUniqueCrops;
export const GREENHOUSE_CROPS: GreenhouseCrop[] = cropFile.crops;
export const MUTATIONS_LAST_VERIFIED: string | null = mutationFile.lastVerified;

const PLACEABLE_NAMES = new Map<string, string>([
  ...cropFile.crops.map((c): [string, string] => [c.id, c.name]),
  ...mutationFile.mutations.map((m): [string, string] => [m.id, m.name]),
]);

export function isPlaceableId(id: string): boolean {
  return PLACEABLE_NAMES.has(id);
}

export function placeableName(id: string): string {
  return PLACEABLE_NAMES.get(id) ?? id;
}

export const ALL_MUTATIONS: MutationDefinition[] = mutationFile.mutations.map(
  (m) => ({
    ...m,
    recipe:
      m.recipe.kind === "special"
        ? m.recipe
        : {
            kind: "neighbours" as const,
            ingredients: Object.entries(m.recipe.ingredients).map(
              ([id, count]) => ({ id, count, placeable: isPlaceableId(id) }),
            ),
          },
  }),
);

export function getMutation(id: string): MutationDefinition | undefined {
  return ALL_MUTATIONS.find((m) => m.id === id);
}
