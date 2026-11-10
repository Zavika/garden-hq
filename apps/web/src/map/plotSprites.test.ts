import { describe, expect, it } from "vitest";
import type { PlotTile } from "../viewmodels/map";
import type { SpriteSlot } from "../sprites/slots";
import { plotSpriteSlots } from "./plotSprites";

function tile(over: Partial<PlotTile> = {}): PlotTile {
  return {
    kind: "plot",
    plotId: "beginner_1",
    plotNumber: 1,
    x: 0,
    y: 0,
    state: "unlocked",
    availability: "owned",
    lockedCost: null,
    greenhouse: false,
    ...over,
  };
}

const all = new Set<SpriteSlot>(["soil", "locked", "greenhouse", "crop:wheat"]);
const has = (s: SpriteSlot): boolean => all.has(s);
const none = (): boolean => false;

describe("plotSpriteSlots", () => {
  const locked = tile({ state: "locked", availability: "buyable" });

  it("uses the locked base when present", () => {
    expect(plotSpriteSlots(locked, has)).toEqual({
      base: "locked",
      overlay: null,
    });
  });
  it("falls back to the placeholder for a locked tile", () => {
    expect(plotSpriteSlots(locked, none)).toEqual({
      base: null,
      overlay: null,
    });
  });
  it("uses soil for an empty unlocked tile, or null when absent", () => {
    expect(plotSpriteSlots(tile(), has)).toEqual({
      base: "soil",
      overlay: null,
    });
    expect(plotSpriteSlots(tile(), none)).toEqual({
      base: null,
      overlay: null,
    });
  });
  it("returns the crop overlay when present, null when absent", () => {
    const t = tile({ state: "assigned", cropId: "wheat" });
    expect(plotSpriteSlots(t, has)).toEqual({
      base: "soil",
      overlay: "crop:wheat",
    });
    expect(plotSpriteSlots(t, (s) => s === "soil").overlay).toBeNull();
  });
  it("returns the greenhouse overlay and never a crop for greenhouse tiles", () => {
    const t = tile({ state: "assigned", cropId: "wheat", greenhouse: true });
    expect(plotSpriteSlots(t, has).overlay).toBe("greenhouse");
    expect(plotSpriteSlots(t, (s) => s !== "greenhouse").overlay).toBeNull();
  });
  it("returns no overlay when assigned without a cropId", () => {
    expect(
      plotSpriteSlots(tile({ state: "assigned" }), has).overlay,
    ).toBeNull();
  });
  it("still returns the crop overlay when soil is absent", () => {
    const t = tile({ state: "assigned", cropId: "wheat" });
    expect(plotSpriteSlots(t, (s) => s === "crop:wheat")).toEqual({
      base: null,
      overlay: "crop:wheat",
    });
  });
});
