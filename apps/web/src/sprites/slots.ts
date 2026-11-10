export const SPRITE_SIZE = 16;

export type SpriteSlot =
  "soil" | "locked" | "greenhouse" | "barn" | `crop:${string}`;

const FIXED_SLOTS: readonly SpriteSlot[] = [
  "soil",
  "locked",
  "greenhouse",
  "barn",
];

export function cropSlot(cropId: string): SpriteSlot {
  return `crop:${cropId}`;
}

export function slotsFor(cropIds: readonly string[]): SpriteSlot[] {
  return [...FIXED_SLOTS, ...cropIds.map(cropSlot)];
}

export function slotFile(slot: SpriteSlot): string {
  if (slot.startsWith("crop:")) return `crops/${slot.slice(5)}.png`;
  return `${slot}.png`;
}

export function slotUrl(slot: SpriteSlot): string {
  return `/sprites/${slotFile(slot)}`;
}

export function fileSlot(
  file: string,
  cropIds: readonly string[],
): SpriteSlot | null {
  return slotsFor(cropIds).find((slot) => slotFile(slot) === file) ?? null;
}
