import { deflateSync } from "node:zlib";

export type Rgba = readonly [number, number, number, number];

// 16x16 pixel-art sprout: two leaves, a stem and a soil mound.
// '.' transparent, 'o' outline, 'g' leaf, 'd' dark leaf, 's' soil.
export const SPROUT: readonly string[] = [
  "................",
  "................",
  "..oooo....oooo..",
  ".oggggo..oggggo.",
  ".ogggddo.oddggo.",
  ".oggddoo.oddggo.",
  "...oooodooo.....",
  ".......ogo......",
  ".......ogo......",
  ".......ogo......",
  ".......ogo......",
  ".......ogo......",
  "......ossso.....",
  "....ossssssso...",
  "...ossssssssso..",
  "...ooooooooooo..",
];

export const SPROUT_PALETTE: Readonly<Record<string, string>> = {
  o: "#3a2313",
  g: "#6fa24a",
  d: "#4a7d2e",
  s: "#8a5a32",
};

const GRID = 16;

function hexToRgba(hex: string): Rgba {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function renderIcon(opts: {
  size: number;
  paddingRatio: number;
  background: Rgba;
}): Uint8Array {
  const { size, paddingRatio, background } = opts;
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) out.set(background, i * 4);
  const scale = Math.max(1, Math.floor((size * (1 - 2 * paddingRatio)) / GRID));
  const span = scale * GRID;
  const offset = Math.floor((size - span) / 2);
  for (let gy = 0; gy < GRID; gy++) {
    const row = SPROUT[gy] ?? "";
    for (let gx = 0; gx < GRID; gx++) {
      const hex = SPROUT_PALETTE[row[gx] ?? "."];
      if (hex === undefined) continue;
      const color = hexToRgba(hex);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = offset + gx * scale + dx;
          const y = offset + gy * scale + dy;
          out.set(color, (y * size + x) * 4);
        }
      }
    }
  }
  return out;
}

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function sproutSvg(): string {
  const rects: string[] = [];
  SPROUT.forEach((row, y) => {
    for (let x = 0; x < GRID; x++) {
      const hex = SPROUT_PALETTE[row[x] ?? "."];
      if (hex !== undefined)
        rects.push(
          `<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`,
        );
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="64" height="64" shape-rendering="crispEdges">\n${rects.join("\n")}\n</svg>\n`;
}
