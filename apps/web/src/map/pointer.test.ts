import { describe, expect, it } from "vitest";
import { tracksHover } from "./pointer";

describe("tracksHover", () => {
  it("ignores touch but follows mouse and pen", () => {
    expect(tracksHover("touch")).toBe(false);
    expect(tracksHover("mouse")).toBe(true);
    expect(tracksHover("pen")).toBe(true);
  });
});
