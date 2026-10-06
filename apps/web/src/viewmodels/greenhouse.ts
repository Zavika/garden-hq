import {
  GREENHOUSE_GRID_SIZE,
  cellKey,
  uniqueCropBonus,
  unlockedCellKeys,
  type BonusResult,
  type Candidate,
  type GreenhouseCellRef,
} from "@garden-hq/core";
import type { GreenhouseSave } from "../state/storage";

export interface GridCell {
  key: string;
  x: number;
  z: number;
  state: "locked" | "empty" | "filled";
  contentId?: string;
}

export interface GreenhouseViewModel {
  /** rows[z][x] */
  rows: GridCell[][];
  /** Saved content on unlocked cells only. */
  cells: Record<string, string>;
  unlocked: Set<string>;
  bonus: BonusResult;
}

export interface Highlight {
  kind: "ok" | "near";
  missing: number;
}

export function buildGreenhouseViewModel(
  save: GreenhouseSave,
  lockedCells: readonly GreenhouseCellRef[],
): GreenhouseViewModel {
  const unlocked = unlockedCellKeys(lockedCells);
  const cells: Record<string, string> = {};
  for (const [key, id] of Object.entries(save.cells)) {
    if (unlocked.has(key)) cells[key] = id;
  }

  const rows: GridCell[][] = [];
  for (let z = 0; z < GREENHOUSE_GRID_SIZE; z++) {
    const row: GridCell[] = [];
    for (let x = 0; x < GREENHOUSE_GRID_SIZE; x++) {
      const key = cellKey(x, z);
      const contentId = cells[key];
      if (!unlocked.has(key)) row.push({ key, x, z, state: "locked" });
      else if (contentId === undefined) row.push({ key, x, z, state: "empty" });
      else row.push({ key, x, z, state: "filled", contentId });
    }
    rows.push(row);
  }

  return { rows, cells, unlocked, bonus: uniqueCropBonus(cells, unlocked) };
}

export function swatchColour(id: string): string {
  let hue = 0;
  for (const char of id) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hue} 55% 62%)`;
}

export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** `ok` where the recipe is satisfied, `near` where some ingredient is already adjacent. */
export function buildHighlights(
  candidates: readonly Candidate[],
): Map<string, Highlight> {
  const highlights = new Map<string, Highlight>();
  for (const { x, z, status } of candidates) {
    const key = cellKey(x, z);
    if (status.satisfied) {
      highlights.set(key, { kind: "ok", missing: 0 });
    } else if (status.missing < status.required) {
      highlights.set(key, { kind: "near", missing: status.missing });
    }
  }
  return highlights;
}
