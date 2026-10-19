import { isSyncCode } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBase32, generateSyncCode, hashSyncCode } from "./synccode";

afterEach(() => vi.restoreAllMocks());

describe("encodeBase32", () => {
  it("encodes zero bytes as A", () => {
    expect(encodeBase32(new Uint8Array(20))).toBe("A".repeat(32));
  });

  it("encodes 0xff bytes as 7", () => {
    expect(encodeBase32(new Uint8Array(20).fill(0xff))).toBe("7".repeat(32));
  });

  it("matches the RFC 4648 vector", () => {
    expect(encodeBase32(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("generateSyncCode", () => {
  it("produces valid, distinct codes", () => {
    const a = generateSyncCode();
    expect(isSyncCode(a)).toBe(true);
    expect(generateSyncCode()).not.toBe(a);
  });

  it("draws 20 random bytes", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    generateSyncCode();
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]?.[0] as Uint8Array;
    expect(arg.length).toBe(20);
  });
});

describe("hashSyncCode", () => {
  const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  it("is 64 lowercase hex chars and stable", async () => {
    const h = await hashSyncCode(code);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSyncCode(code)).toBe(h);
  });

  it("differs for a one-character change", async () => {
    expect(await hashSyncCode(code)).not.toBe(
      await hashSyncCode("B" + code.slice(1)),
    );
  });
});
