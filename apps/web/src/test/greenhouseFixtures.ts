import {
  GREENHOUSE_GRID_SIZE,
  cellKey,
  type GreenhouseCellRef,
} from "@garden-hq/core";

/** The owner's 12 unlocked cells (owner-confirmed 2026-10-06). */
export const UNLOCKED_KEYS: readonly string[] = [
  "3,4",
  "3,5",
  "4,3",
  "4,4",
  "4,5",
  "4,6",
  "5,3",
  "5,4",
  "5,5",
  "5,6",
  "6,4",
  "6,5",
];

/** Everything else in the 10x10 grid, as the API's locked-cell list. */
export const LOCKED_CELLS: GreenhouseCellRef[] = (() => {
  const locked: GreenhouseCellRef[] = [];
  for (let z = 0; z < GREENHOUSE_GRID_SIZE; z++) {
    for (let x = 0; x < GREENHOUSE_GRID_SIZE; x++) {
      if (!UNLOCKED_KEYS.includes(cellKey(x, z))) locked.push({ x, z });
    }
  }
  return locked;
})();
