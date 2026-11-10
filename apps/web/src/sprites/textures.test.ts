import { describe, expect, it, vi } from "vitest";
import type { Texture } from "pixi.js";
import { loadTextures, type TextureLoader } from "./textures";
import { slotUrl, type SpriteSlot } from "./slots";

const fake: TextureLoader = (url) =>
  Promise.resolve({ id: url } as unknown as Texture);

describe("loadTextures", () => {
  it("loads every present slot under its key", async () => {
    const present: SpriteSlot[] = ["soil", "crop:wheat"];
    const map = await loadTextures(present, fake);
    expect(map.size).toBe(2);
    expect(map.get("soil")).toEqual({ id: "/sprites/soil.png" });
    expect(map.get("crop:wheat")).toEqual({ id: "/sprites/crops/wheat.png" });
  });

  it("omits a failing slot without throwing", async () => {
    const loader: TextureLoader = (url) =>
      url.includes("barn") ? Promise.reject(new Error("404")) : fake(url);
    const map = await loadTextures(["soil", "barn"], loader);
    expect(map.has("soil")).toBe(true);
    expect(map.has("barn")).toBe(false);
  });

  it("returns an empty map without calling the loader", async () => {
    const loader = vi.fn(fake);
    const map = await loadTextures([], loader);
    expect(map.size).toBe(0);
    expect(loader).not.toHaveBeenCalled();
  });

  it("calls the loader with slotUrl(slot)", async () => {
    const loader = vi.fn(fake);
    await loadTextures(["locked"], loader);
    expect(loader).toHaveBeenCalledWith(slotUrl("locked"));
  });
});
