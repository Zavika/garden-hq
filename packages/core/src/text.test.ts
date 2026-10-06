import { describe, expect, it } from "vitest";
import { stripFormatting } from "./text";

describe("stripFormatting", () => {
  it("removes colour and format codes", () => {
    expect(stripFormatting("§6Farming Simulator")).toBe("Farming Simulator");
    expect(stripFormatting("§7Gain §a+25§r crops")).toBe("Gain +25 crops");
    expect(stripFormatting("§l§nBold underline§r")).toBe("Bold underline");
  });

  it("is case-insensitive and drops a dangling section sign", () => {
    expect(stripFormatting("§AGreen§")).toBe("Green");
  });

  it("leaves text without codes (and multi-line text) untouched", () => {
    expect(stripFormatting("Plain text")).toBe("Plain text");
    expect(stripFormatting("a\nb")).toBe("a\nb");
    expect(stripFormatting("")).toBe("");
  });
});
