import { describe, expect, it } from "vitest";
import { drawNumber } from "./digits";

function fakeGraphics() {
  const rects: { x: number; y: number; fill: number }[] = [];
  let current = { x: 0, y: 0 };
  const g = {
    rect(x: number, y: number) {
      current = { x, y };
      return g;
    },
    fill(fill: number) {
      rects.push({ ...current, fill });
      return g;
    },
  };
  return { g: g as never, rects };
}

describe("drawNumber", () => {
  it("draws a shadow pass then a foreground pass for every lit pixel", () => {
    const { g, rects } = fakeGraphics();
    drawNumber(g, 1, 0, 0, 0xffffff, 0x000000);
    // "1" has 3+... lit cells: 1+2+1+1+3 = 8, drawn twice.
    expect(rects).toHaveLength(16);
    expect(rects.filter((r) => r.fill === 0x000000)).toHaveLength(8);
  });

  it("advances 4px per digit and stays inside a 16px tile for 2 digits", () => {
    const { g, rects } = fakeGraphics();
    drawNumber(g, 24, 1, 1, 1, 0);
    expect(Math.max(...rects.map((r) => r.x))).toBeLessThan(16);
    expect(Math.max(...rects.map((r) => r.y))).toBeLessThan(16);
    expect(Math.min(...rects.map((r) => r.x))).toBe(1);
  });
});
