import { GRID_SIZE } from "@garden-hq/core";

/** Logical pixels per tile; the whole scene is scaled by an integer factor. */
export const TILE = 16;

/**
 * Largest integer-scaled tile size (CSS px) whose 5x5 grid fits `cssWidth`.
 * Lives outside MapScene so the frame can be sized before Pixi has loaded.
 */
export function tilePxFor(cssWidth: number): number {
  return TILE * Math.max(1, Math.floor(cssWidth / (GRID_SIZE * TILE)));
}
