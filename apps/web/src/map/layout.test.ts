import { describe, expect, it } from "vitest";
import { TILE, tilePxFor } from "./layout";

describe("tilePxFor", () => {
  it("never goes below one logical tile", () => {
    expect(tilePxFor(0)).toBe(TILE);
    expect(tilePxFor(79)).toBe(TILE);
  });

  it("picks the largest integer scale that fits", () => {
    expect(tilePxFor(376)).toBe(64); // 380px phone minus padding → 4x
    expect(tilePxFor(480)).toBe(96); // desktop cap → 6x
    expect(tilePxFor(479)).toBe(80);
  });
});
