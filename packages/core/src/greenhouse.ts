import {
  BONUS_PERCENT_PER_UNIQUE_CROP,
  GREENHOUSE_CROPS,
  GREENHOUSE_GRID_SIZE,
  MAX_UNIQUE_CROPS,
  type MutationDefinition,
} from "./greenhouse-data";
import type { GreenhouseCellRef } from "./types";

/** `"x,z"` with x the column and z the row, both 0..9. */
export type CellKey = string;
/** Cell key -> placed crop or mutation id. Absent key = empty cell. */
export type GreenhouseCells = Readonly<Record<CellKey, string>>;

export function cellKey(x: number, z: number): CellKey {
  return `${x},${z}`;
}

export function parseCellKey(key: string): GreenhouseCellRef | null {
  const match = /^(\d+),(\d+)$/.exec(key);
  if (match === null) return null;
  const x = Number(match[1]);
  const z = Number(match[2]);
  return x < GREENHOUSE_GRID_SIZE && z < GREENHOUSE_GRID_SIZE ? { x, z } : null;
}

function inGrid(x: number, z: number): boolean {
  return (
    x >= 0 && z >= 0 && x < GREENHOUSE_GRID_SIZE && z < GREENHOUSE_GRID_SIZE
  );
}

/** Unlocked cells = the full grid minus the API's locked list. */
export function unlockedCellKeys(
  lockedCells: readonly GreenhouseCellRef[],
): Set<CellKey> {
  const locked = new Set(lockedCells.map((cell) => cellKey(cell.x, cell.z)));
  const unlocked = new Set<CellKey>();
  for (let z = 0; z < GREENHOUSE_GRID_SIZE; z++) {
    for (let x = 0; x < GREENHOUSE_GRID_SIZE; x++) {
      const key = cellKey(x, z);
      if (!locked.has(key)) unlocked.add(key);
    }
  }
  return unlocked;
}

/** The size x size block with top-left cell (x, z). May extend past the grid. */
export function blockCells(
  x: number,
  z: number,
  size: number,
): GreenhouseCellRef[] {
  const cells: GreenhouseCellRef[] = [];
  for (let dz = 0; dz < size; dz++) {
    for (let dx = 0; dx < size; dx++) cells.push({ x: x + dx, z: z + dz });
  }
  return cells;
}

// VERIFY: a recipe's neighbours are the ring around the mutation's footprint
// (8 / 12 / 16 cells for 1x1 / 2x2 / 3x3). Inferred: 27 of 36 recipes sum to
// exactly the ring size for their footprint and none exceeds it. Whether extra
// non-recipe neighbours are allowed is unconfirmed (data/VERIFY.md).
/** In-grid cells in the one-cell ring around the block with top-left (x, z). */
export function ringCells(
  x: number,
  z: number,
  size: number,
): GreenhouseCellRef[] {
  const cells: GreenhouseCellRef[] = [];
  for (let dz = -1; dz <= size; dz++) {
    for (let dx = -1; dx <= size; dx++) {
      const inBlock = dx >= 0 && dx < size && dz >= 0 && dz < size;
      if (!inBlock && inGrid(x + dx, z + dz))
        cells.push({ x: x + dx, z: z + dz });
    }
  }
  return cells;
}

const BONUS_CROP_IDS = new Set(
  GREENHOUSE_CROPS.filter((crop) => crop.countsForBonus).map((crop) => crop.id),
);

export interface BonusResult {
  /** Distinct bonus-eligible crops placed on unlocked cells. */
  unique: number;
  /** `unique` capped at the maximum. */
  counted: number;
  max: number;
  percent: number;
}

// VERIFY: whether the bonus is per Greenhouse or global, and which crops count,
// is unconfirmed (data/VERIFY.md). Computed per Greenhouse here.
export function uniqueCropBonus(
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
): BonusResult {
  const seen = new Set<string>();
  for (const [key, id] of Object.entries(cells)) {
    if (unlocked.has(key) && BONUS_CROP_IDS.has(id)) seen.add(id);
  }
  const counted = Math.min(seen.size, MAX_UNIQUE_CROPS);
  return {
    unique: seen.size,
    counted,
    max: MAX_UNIQUE_CROPS,
    percent: counted * BONUS_PERCENT_PER_UNIQUE_CROP,
  };
}

export function neighbourCounts(
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
  x: number,
  z: number,
  size = 1,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ring of ringCells(x, z, size)) {
    const key = cellKey(ring.x, ring.z);
    if (!unlocked.has(key)) continue;
    const id = cells[key];
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface IngredientStatus {
  id: string;
  need: number;
  have: number;
  placeable: boolean;
}

export interface RecipeStatus {
  satisfied: boolean;
  /** Missing placeable ingredient units. */
  missing: number;
  /** Total placeable ingredient units the recipe needs. */
  required: number;
  ingredients: IngredientStatus[];
}

/** Null for special (text-only) recipes, which are not checked. */
export function recipeStatus(
  mutation: MutationDefinition,
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
  x: number,
  z: number,
): RecipeStatus | null {
  if (mutation.recipe.kind !== "neighbours") return null;

  const counts = neighbourCounts(
    cells,
    unlocked,
    x,
    z,
    mutation.growth.footprint,
  );
  let missing = 0;
  let required = 0;
  const ingredients = mutation.recipe.ingredients.map((ingredient) => {
    const have = counts.get(ingredient.id) ?? 0;
    if (ingredient.placeable) {
      required += ingredient.count;
      missing += Math.max(0, ingredient.count - have);
    }
    return {
      id: ingredient.id,
      need: ingredient.count,
      have,
      placeable: ingredient.placeable,
    };
  });

  return { satisfied: missing === 0, missing, required, ingredients };
}

export interface Candidate {
  x: number;
  z: number;
  status: RecipeStatus;
}

/** Anchors (top-left cells) of free, fully unlocked footprint blocks, closest to the recipe first. */
export function rankCandidateCells(
  mutation: MutationDefinition,
  cells: GreenhouseCells,
  unlocked: ReadonlySet<CellKey>,
): Candidate[] {
  const size = mutation.growth.footprint;
  const candidates: Candidate[] = [];
  for (const key of unlocked) {
    const ref = parseCellKey(key);
    if (ref === null) continue;
    const free = blockCells(ref.x, ref.z, size).every((cell) => {
      const cellKeyValue = cellKey(cell.x, cell.z);
      return (
        inGrid(cell.x, cell.z) &&
        unlocked.has(cellKeyValue) &&
        !(cellKeyValue in cells)
      );
    });
    if (!free) continue;
    const status = recipeStatus(mutation, cells, unlocked, ref.x, ref.z);
    if (status === null) return [];
    candidates.push({ ...ref, status });
  }
  return candidates.sort(
    (a, b) => a.status.missing - b.status.missing || a.z - b.z || a.x - b.x,
  );
}

/**
 * Minimum number of extra cells that must be unlocked before the mutation can
 * be built anywhere: locked cells in its footprint block plus the shortfall of
 * unlocked ring cells against the recipe's placeable ingredient total, taken at
 * the best anchor. 0 = already fits; null = cannot fit anywhere in the grid.
 * Special recipes need only their footprint block.
 */
export function extraCellsNeeded(
  mutation: MutationDefinition,
  unlocked: ReadonlySet<CellKey>,
): number | null {
  const size = mutation.growth.footprint;
  const required =
    mutation.recipe.kind === "special"
      ? 0
      : mutation.recipe.ingredients
          .filter((ingredient) => ingredient.placeable)
          .reduce((sum, ingredient) => sum + ingredient.count, 0);

  let best: number | null = null;
  for (let z = 0; z + size <= GREENHOUSE_GRID_SIZE; z++) {
    for (let x = 0; x + size <= GREENHOUSE_GRID_SIZE; x++) {
      const ring = ringCells(x, z, size);
      if (ring.length < required) continue;
      const lockedInBlock = blockCells(x, z, size).filter(
        (cell) => !unlocked.has(cellKey(cell.x, cell.z)),
      ).length;
      const unlockedInRing = ring.filter((cell) =>
        unlocked.has(cellKey(cell.x, cell.z)),
      ).length;
      const extra = lockedInBlock + Math.max(0, required - unlockedInRing);
      if (best === null || extra < best) best = extra;
    }
  }
  return best;
}
