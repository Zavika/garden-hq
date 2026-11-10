import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readPngSize } from "../vite/png.ts";
import { encodePng, renderIcon, SPROUT, type Rgba } from "./icons.ts";

function parse(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const idat: Uint8Array[] = [];
  let pos = 8;
  let crcOk = true;
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const body = png.subarray(pos + 4, pos + 8 + len);
    if (view.getUint32(pos + 8 + len) !== crc32(body)) crcOk = false;
    if (String.fromCharCode(...png.subarray(pos + 4, pos + 8)) === "IDAT")
      idat.push(png.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  return { raw: inflateSync(Buffer.concat(idat)), crcOk };
}

function decode(png: Uint8Array, w: number, h: number): Uint8Array {
  const { raw } = parse(png);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 4 + 1)]).toBe(0);
    out.set(
      raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)),
      y * w * 4,
    );
  }
  return out;
}

const BG: Rgba = [0xf4, 0xe4, 0xb5, 255];

function bbox(px: Uint8Array, size: number) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (BG.some((v, k) => px[i + k] !== v)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

describe("encodePng", () => {
  it("round-trips pixels with valid signature, size and CRCs", () => {
    for (const [w, h] of [
      [2, 2],
      [3, 2],
    ] as const) {
      const px = Uint8Array.from(
        { length: w * h * 4 },
        (_, i) => (i * 37) % 256,
      );
      const png = encodePng(w, h, px);
      expect([...png.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(readPngSize(png)).toEqual({ width: w, height: h });
      expect(parse(png).crcOk).toBe(true);
      // IHDR: width, height, then bit depth 8, colour type 6, 0, 0, 0.
      expect([...png.subarray(24, 29)]).toEqual([8, 6, 0, 0, 0]);
      expect(decode(png, w, h)).toEqual(px);
    }
  });
});

describe("renderIcon", () => {
  const opts = { size: 192, paddingRatio: 0.1, background: BG };
  it("has a 16x16 grid", () => {
    expect(SPROUT).toHaveLength(16);
    for (const r of SPROUT) expect(r).toHaveLength(16);
  });
  it("fills background and draws the sprout", () => {
    const px = renderIcon(opts);
    expect(px).toHaveLength(192 * 192 * 4);
    expect([...px.subarray(0, 4)]).toEqual([...BG]);
    const i = (96 * 192 + 96) * 4;
    expect([...px.subarray(i, i + 4)]).not.toEqual([...BG]);
  });
  it("shrinks the sprout with larger padding", () => {
    const a = bbox(renderIcon(opts), 192);
    const b = bbox(renderIcon({ ...opts, paddingRatio: 0.3 }), 192);
    expect(b.w).toBeLessThan(a.w);
    expect(b.h).toBeLessThan(a.h);
  });
  it("keeps the maskable sprout inside the safe zone", () => {
    const size = 512;
    const px = renderIcon({ size, paddingRatio: 0.2, background: BG });
    const c = size / 2;
    let count = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (!BG.some((v, k) => px[i + k] !== v)) continue;
        count++;
        expect(Math.hypot(x + 0.5 - c, y + 0.5 - c)).toBeLessThanOrEqual(
          0.4 * size,
        );
      }
    expect(count).toBeGreaterThan(0);
  });
  it("is deterministic", () => {
    expect(renderIcon(opts)).toEqual(renderIcon(opts));
  });
});

describe("committed icons", () => {
  const pub = resolve(import.meta.dirname, "../public");
  it.each([
    ["icons/icon-192.png", 192],
    ["icons/icon-512.png", 512],
    ["icons/icon-maskable-512.png", 512],
    ["icons/apple-touch-icon.png", 180],
  ])("%s is %i square", (file, size) => {
    const p = resolve(pub, file);
    expect(existsSync(p)).toBe(true);
    expect(readPngSize(readFileSync(p))).toEqual({ width: size, height: size });
  });
});
