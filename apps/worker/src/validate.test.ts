import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { parseName, parseUuid, toDashedUuid } from "./validate";

const DASHED = "11111111-2222-3333-4444-555555555555";

describe("parseName", () => {
  it("accepts valid Minecraft names", () => {
    expect(parseName("Test_Farmer1")).toBe("Test_Farmer1");
    expect(parseName("a")).toBe("a");
    expect(parseName("a".repeat(16))).toHaveLength(16);
  });

  it.each([
    undefined,
    "",
    "a".repeat(17),
    "bad name",
    "bad-name",
    "bad.name",
    "名前",
  ])("rejects %j with bad_request", (value) => {
    expect(() => parseName(value)).toThrowError(AppError);
    try {
      parseName(value);
    } catch (err) {
      expect((err as AppError).code).toBe("bad_request");
    }
  });
});

describe("parseUuid / toDashedUuid", () => {
  it("accepts dashed and undashed UUIDs and returns canonical dashed lowercase", () => {
    expect(parseUuid(DASHED)).toBe(DASHED);
    expect(parseUuid("11111111222233334444555555555555".toUpperCase())).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it.each([
    undefined,
    "",
    "not-a-uuid",
    "1111111-2222-3333-4444-555555555555",
    `${DASHED}0`,
    "zzzzzzzz-2222-3333-4444-555555555555",
    "11111111-22223333-4444-555555555555",
  ])("rejects %j with bad_request", (value) => {
    expect(() => parseUuid(value)).toThrowError(AppError);
  });

  it("toDashedUuid returns null instead of throwing", () => {
    expect(toDashedUuid("11111111222233334444555555555555")).toBe(DASHED);
    expect(toDashedUuid("nope")).toBeNull();
  });
});
