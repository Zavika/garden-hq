import type { Texture } from "pixi.js";
import { slotUrl, type SpriteSlot } from "./slots";

export type TextureMap = ReadonlyMap<SpriteSlot, Texture>;
export type TextureLoader = (url: string) => Promise<Texture>;

const defaultLoader: TextureLoader = async (url) => {
  const { Assets } = await import("pixi.js");
  const texture = await Assets.load<Texture>(url);
  texture.source.scaleMode = "nearest";
  return texture;
};

/** Loads every present slot; a slot whose load fails is omitted (placeholder stays). Never throws. */
export async function loadTextures(
  present: readonly SpriteSlot[],
  load: TextureLoader = defaultLoader,
): Promise<TextureMap> {
  const map = new Map<SpriteSlot, Texture>();
  await Promise.all(
    present.map(async (slot) => {
      try {
        map.set(slot, await load(slotUrl(slot)));
      } catch {
        // omitted: the placeholder stays
      }
    }),
  );
  return map;
}
