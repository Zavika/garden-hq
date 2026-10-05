import type { Graphics } from "pixi.js";

/** Original 3x5 pixel digits; each row is a 3-bit mask, top to bottom. */
const GLYPHS: Record<string, readonly number[]> = {
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b111, 0b001, 0b111, 0b100, 0b111],
  "3": [0b111, 0b001, 0b111, 0b001, 0b111],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b111, 0b001, 0b111],
  "6": [0b111, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b010, 0b010, 0b010],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b111],
};

const GLYPH_WIDTH = 3;
const ADVANCE = GLYPH_WIDTH + 1;

/** Draws `value` in 1-logical-pixel cells at (x, y) with a 1px drop shadow. */
export function drawNumber(
  g: Graphics,
  value: number,
  x: number,
  y: number,
  colour: number,
  shadow: number,
): void {
  for (const [dx, dy, fill] of [
    [1, 1, shadow],
    [0, 0, colour],
  ] as const) {
    [...String(value)].forEach((char, i) => {
      GLYPHS[char]?.forEach((mask, row) => {
        for (let col = 0; col < GLYPH_WIDTH; col++) {
          if ((mask >> (GLYPH_WIDTH - 1 - col)) & 1) {
            g.rect(x + i * ADVANCE + col + dx, y + row + dy, 1, 1).fill(fill);
          }
        }
      });
    });
  }
}
