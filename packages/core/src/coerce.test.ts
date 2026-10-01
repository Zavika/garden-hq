import { describe, expect, it } from "vitest";
import { asArray, asNumber, asRecord, asString } from "./coerce";

describe("coerce helpers", () => {
  it("asRecord returns objects and {} for everything else", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toEqual({});
    expect(asRecord([1, 2])).toEqual({});
    expect(asRecord("x")).toEqual({});
  });

  it("asString returns strings, else the fallback", () => {
    expect(asString("hi")).toBe("hi");
    expect(asString(5)).toBe("");
    expect(asString(undefined, "none")).toBe("none");
  });

  it("asNumber returns finite numbers, else the fallback", () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber(Number.NaN)).toBe(0);
    expect(asNumber("3", 9)).toBe(9);
  });

  it("asArray returns arrays, else []", () => {
    expect(asArray([1])).toEqual([1]);
    expect(asArray({})).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });
});
