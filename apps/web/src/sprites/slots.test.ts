// @vitest-environment node
/// <reference types="node" />
import fs from "node:fs";
import { ALL_CROPS } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { fileSlot, slotFile, slotsFor, slotUrl } from "./slots";

const cropIds = ALL_CROPS.map((c) => c.id);

describe("slots", () => {
  it("lists fixed slots then one per crop", () => {
    expect(slotsFor(["wheat", "carrot"])).toEqual([
      "soil",
      "locked",
      "greenhouse",
      "barn",
      "crop:wheat",
      "crop:carrot",
    ]);
  });

  it("maps slots to files and urls", () => {
    expect(slotFile("crop:sugar_cane")).toBe("crops/sugar_cane.png");
    expect(slotUrl("soil")).toBe("/sprites/soil.png");
  });

  it("maps files back to slots", () => {
    expect(fileSlot("crops/wheat.png", ["wheat"])).toBe("crop:wheat");
    expect(fileSlot("soil.png", [])).toBe("soil");
    expect(fileSlot("crops/nope.png", ["wheat"])).toBeNull();
    expect(fileSlot("other.png", [])).toBeNull();
    expect(fileSlot("soil.PNG", [])).toBeNull();
    expect(fileSlot("crops/wheat.png", [])).toBeNull();
  });

  it("has 17 slots for the real crop data", () => {
    expect(slotsFor(cropIds)).toHaveLength(17);
  });

  it("documents every expected file in the sprites README", () => {
    const readme = fs.readFileSync(
      new URL("../../public/sprites/README.md", import.meta.url),
      "utf8",
    );
    for (const slot of slotsFor(cropIds)) {
      expect(readme).toContain(slotFile(slot));
    }
  });
});
