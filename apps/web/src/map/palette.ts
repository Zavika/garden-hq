export const COLORS = {
  grass: 0x4c7a34,
  grassAlt: 0x558640,
  soil: 0x6b4a2b,
  lock: 0x7a7a7a,
  lockDark: 0x555555,
  barnWall: 0x9c3b2e,
  barnRoof: 0x5e2a22,
  visitor: 0xf2d21b,
  selected: 0xffffff,
} as const;

const CROP_COLORS: Record<string, number> = {
  wheat: 0xe0c040,
  carrot: 0xe87a1e,
  potato: 0xc9a66b,
  pumpkin: 0xe07b12,
  sugar_cane: 0x7bd36b,
  melon: 0x4fa83d,
  cactus: 0x2f7d3a,
  cocoa_beans: 0x6b3f1d,
  mushroom: 0xb04a4a,
  nether_wart: 0x8a1c2b,
  sunflower: 0xf2d21b,
  moonflower: 0x8d7bd6,
  wild_rose: 0xe0558f,
};

export function cropColor(cropId: string): number {
  return CROP_COLORS[cropId] ?? 0xaaaaaa;
}
