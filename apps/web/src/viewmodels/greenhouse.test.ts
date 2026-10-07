import type { Candidate } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { LOCKED_CELLS } from "../test/greenhouseFixtures";
import {
  buildGreenhouseViewModel,
  buildHighlights,
  formatAge,
  swatchColour,
} from "./greenhouse";

describe("buildGreenhouseViewModel", () => {
  it("builds a 10x10 grid of locked/empty/filled cells", () => {
    const vm = buildGreenhouseViewModel(
      {
        cells: { "4,4": "wheat" },
        lastWateredAt: null,
        wateringIntervalHours: null,
      },
      LOCKED_CELLS,
    );
    expect(vm.rows).toHaveLength(10);
    expect(vm.rows.every((row) => row.length === 10)).toBe(true);
    const at = (x: number, z: number) => vm.rows[z]?.[x];
    expect(at(0, 0)?.state).toBe("locked");
    expect(at(4, 3)?.state).toBe("empty");
    expect(at(4, 4)).toMatchObject({
      state: "filled",
      contentId: "wheat",
      key: "4,4",
    });
    expect(vm.unlocked.size).toBe(12);
    expect(vm.cells).toEqual({ "4,4": "wheat" });
  });

  it("drops saved content on cells that are locked and computes the bonus", () => {
    const vm = buildGreenhouseViewModel(
      {
        cells: { "0,0": "wheat", "4,4": "carrot", "4,5": "potato" },
        lastWateredAt: null,
        wateringIntervalHours: null,
      },
      LOCKED_CELLS,
    );
    expect(vm.rows[0]?.[0]?.state).toBe("locked");
    expect(vm.cells).toEqual({ "4,4": "carrot", "4,5": "potato" });
    expect(vm.bonus).toMatchObject({ unique: 2, percent: 6 });
  });
});

describe("swatchColour", () => {
  it("is deterministic and an hsl colour", () => {
    expect(swatchColour("wheat")).toBe(swatchColour("wheat"));
    expect(swatchColour("wheat")).toMatch(/^hsl\(\d+ 55% 62%\)$/);
    expect(swatchColour("wheat")).not.toBe(swatchColour("carrot"));
  });
});

describe("formatAge", () => {
  it("formats minutes, hours and days", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(30_000)).toBe("just now");
    expect(formatAge(5 * 60_000)).toBe("5 min ago");
    expect(formatAge(119 * 60_000)).toBe("119 min ago");
    expect(formatAge(3 * 3_600_000)).toBe("3 h ago");
    expect(formatAge(50 * 3_600_000)).toBe("2 d ago");
    expect(formatAge(-5)).toBe("just now");
  });
});

describe("buildHighlights", () => {
  const status = (missing: number, required: number) => ({
    satisfied: missing === 0,
    missing,
    required,
    ingredients: [],
  });

  it("marks satisfied cells ok, partly filled cells near, and ignores the rest", () => {
    const candidates: Candidate[] = [
      { x: 4, z: 4, status: status(0, 2) },
      { x: 4, z: 5, status: status(1, 2) },
      { x: 5, z: 4, status: status(2, 2) },
    ];
    const map = buildHighlights(candidates);
    expect(map.get("4,4")).toEqual({ kind: "ok", missing: 0 });
    expect(map.get("4,5")).toEqual({ kind: "near", missing: 1 });
    expect(map.has("5,4")).toBe(false);
  });
});
