import { describe, expect, it } from "vitest";
import {
  formatSyncCode,
  isSyncCode,
  normalizeSyncCode,
  SYNC_CODE_LENGTH,
} from "./synccode";

describe("sync code helpers", () => {
  it("normalizes case, spaces and dashes", () => {
    expect(normalizeSyncCode("abcd-efgh ijkl")).toBe("ABCDEFGHIJKL");
  });
  it("strips characters outside the base32 alphabet (0, 1, 8, 9)", () => {
    expect(normalizeSyncCode("A0B1C8D9E")).toBe("ABCDE");
  });
  it("accepts exactly 32 base32 characters", () => {
    expect(SYNC_CODE_LENGTH).toBe(32);
    expect(isSyncCode("A2".repeat(16))).toBe(true);
  });
  it("rejects 31, 33 characters and lowercase", () => {
    expect(isSyncCode("A".repeat(31))).toBe(false);
    expect(isSyncCode("A".repeat(33))).toBe(false);
    expect(isSyncCode("a".repeat(32))).toBe(false);
  });
  it("formats in groups of four", () => {
    expect(formatSyncCode("A".repeat(32))).toBe(
      "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA",
    );
  });
});
