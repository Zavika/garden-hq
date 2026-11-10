import type { PlotTile } from "../viewmodels/map";
import { cropSlot, type SpriteSlot } from "../sprites/slots";

export interface PlotSprites {
  /** Replaces the whole programmatic base (grass+weeds+fence, or tilled soil). null = draw the placeholder. */
  base: SpriteSlot | null;
  /** Drawn above the base: crop or greenhouse. null = placeholder / nothing. */
  overlay: SpriteSlot | null;
}

export function plotSpriteSlots(
  tile: PlotTile,
  has: (slot: SpriteSlot) => boolean,
): PlotSprites {
  if (tile.state === "locked") {
    return { base: has("locked") ? "locked" : null, overlay: null };
  }
  const base: SpriteSlot | null = has("soil") ? "soil" : null;
  let overlay: SpriteSlot | null = null;
  if (tile.greenhouse) {
    if (has("greenhouse")) overlay = "greenhouse";
  } else if (tile.state === "assigned" && tile.cropId !== undefined) {
    const slot = cropSlot(tile.cropId);
    if (has(slot)) overlay = slot;
  }
  return { base, overlay };
}
