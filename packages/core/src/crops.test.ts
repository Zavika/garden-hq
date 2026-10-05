import { describe, expect, it } from "vitest";
import { ALL_CROPS, getCrop } from "./crops";

describe("crops", () => {
  it("has 13 crops", () => {
    expect(ALL_CROPS).toHaveLength(13);
  });

  it("finds a crop by id", () => {
    expect(getCrop("wheat")?.name).toBe("Wheat");
    expect(getCrop("wheat")?.unlockLevel).toBe(1);
  });

  it("returns undefined for an unknown id", () => {
    expect(getCrop("nope")).toBeUndefined();
  });
});
