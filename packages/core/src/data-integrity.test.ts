import { describe, expect, it } from "vitest";
import gardenLevels from "../../../data/garden-levels.json";

describe("data/garden-levels.json", () => {
  it("has 15 levels with correct cumulative XP", () => {
    expect(gardenLevels).toHaveLength(15);

    let running = 0;
    for (const entry of gardenLevels) {
      running += entry.xpRequired;
      expect(entry.cumulativeXp).toBe(running);
    }
    expect(gardenLevels.at(-1)?.cumulativeXp).toBe(60120);
  });
});
