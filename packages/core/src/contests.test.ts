import { describe, expect, it } from "vitest";
import elitebot from "../fixtures/contests-elitebot.sample.json";
import strassburger from "../fixtures/contests-strassburger.sample.json";
import { normalizeContests } from "./contests";

const EXPECTED = [
  { startsAt: 1790812800000, crops: ["wheat", "cactus", "pumpkin"] },
  {
    startsAt: 1790819300000,
    crops: ["cocoa_beans", "sugar_cane", "nether_wart"],
  },
];

describe("normalizeContests", () => {
  it("normalizes the array shape (EliteBot) to ms + crop ids", () => {
    expect(normalizeContests(elitebot)).toEqual(EXPECTED);
  });

  it("normalizes the map-by-timestamp shape (Strassburger), sorted ascending", () => {
    expect(normalizeContests(strassburger)).toEqual(EXPECTED);
  });

  it("leaves millisecond timestamps alone", () => {
    expect(
      normalizeContests({
        contests: [{ timestamp: 1790812800000, crops: ["Wheat"] }],
      }),
    ).toEqual([{ startsAt: 1790812800000, crops: ["wheat"] }]);
  });

  it("drops unknown crop names and contests with no recognised crops", () => {
    expect(
      normalizeContests({
        contests: [
          { timestamp: 1790812800, crops: ["Wheat", "Dirt"] },
          { timestamp: 1790819300, crops: ["Dirt"] },
        ],
      }),
    ).toEqual([{ startsAt: 1790812800000, crops: ["wheat"] }]);
  });

  it("returns [] for malformed input and skips bad timestamps", () => {
    expect(normalizeContests(null)).toEqual([]);
    expect(normalizeContests({ contests: "x" })).toEqual([]);
    expect(normalizeContests({ contests: { nope: ["Wheat"] } })).toEqual([]);
    expect(normalizeContests({ contests: [{ crops: ["Wheat"] }] })).toEqual([]);
  });
});
