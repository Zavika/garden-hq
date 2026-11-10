import { describe, expect, it } from "vitest";
import { readPngSize } from "./png.ts";
import { pngBytes } from "./testPng.ts";

describe("readPngSize", () => {
  it("reads valid sizes", () => {
    expect(readPngSize(pngBytes(16, 16))).toEqual({ width: 16, height: 16 });
    expect(readPngSize(pngBytes(32, 16))).toEqual({ width: 32, height: 16 });
  });
  it("returns null for bad input", () => {
    expect(readPngSize(pngBytes(16, 16).slice(0, 20))).toBeNull();
    const jpeg = new Uint8Array(33);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect(readPngSize(jpeg)).toBeNull();
    expect(readPngSize(new Uint8Array())).toBeNull();
  });
  it("returns null without IHDR", () => {
    const b = pngBytes(16, 16);
    b[12] = 0;
    expect(readPngSize(b)).toBeNull();
  });
});
