// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanSprites, spritesPlugin } from "./sprites-plugin.ts";
import { pngBytes } from "./testPng.ts";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sprites-"));
  dirs.push(d);
  return d;
}
function put(dir: string, file: string, data: Uint8Array | string) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe("scanSprites", () => {
  it("handles empty and missing dirs", () => {
    expect(scanSprites(tmp(), ["wheat"])).toEqual({ present: [], issues: [] });
    expect(scanSprites(path.join(tmp(), "nope"), ["wheat"])).toEqual({
      present: [],
      issues: [],
    });
  });
  it("finds valid sprites in slot order", () => {
    const d = tmp();
    put(d, "crops/wheat.png", pngBytes(16, 16));
    put(d, "soil.png", pngBytes(16, 16));
    expect(scanSprites(d, ["wheat"])).toEqual({
      present: ["soil", "crop:wheat"],
      issues: [],
    });
  });
  it("reports bad files; ignores README and dotfiles", () => {
    const d = tmp();
    put(d, "barn.png", pngBytes(32, 16));
    put(d, "mystery.png", pngBytes(16, 16));
    put(d, "soil.png", "hello world, not a png at all");
    put(d, "README.md", "x");
    put(d, ".gitkeep", "");
    const scan = scanSprites(d, []);
    expect(scan.present).toEqual([]);
    expect(scan.issues).toEqual(
      expect.arrayContaining([
        { file: "barn.png", problem: "must be 16x16, is 32x16" },
        { file: "mystery.png", problem: "not a known sprite name" },
        { file: "soil.png", problem: "not a PNG" },
      ]),
    );
    expect(scan.issues).toHaveLength(3);
  });
});

describe("spritesPlugin", () => {
  it("resolves and loads the virtual module", () => {
    const d = tmp();
    put(d, "soil.png", pngBytes(16, 16));
    const plugin = spritesPlugin({ dir: d });
    const resolveId = plugin.resolveId as (id: string) => unknown;
    const load = plugin.load as (id: string) => unknown;
    expect(resolveId("virtual:sprites")).toBe("\0virtual:sprites");
    expect(resolveId("other")).toBeNull();
    const out = load("\0virtual:sprites") as string;
    expect(out).toContain('"soil"');
    expect(out.startsWith("export default")).toBe(true);
  });
  it("throws on build with issues", () => {
    const d = tmp();
    put(d, "soil.png", pngBytes(8, 8));
    const plugin = spritesPlugin({ dir: d });
    (plugin.configResolved as (c: unknown) => void)({ command: "build" });
    const ctx = {
      error(msg: string): never {
        throw new Error(msg);
      },
      warn() {},
    };
    expect(() =>
      (plugin.buildStart as unknown as (this: typeof ctx) => void).call(ctx),
    ).toThrow(/public\/sprites\/soil\.png: must be 16x16, is 8x8/);
  });
});
