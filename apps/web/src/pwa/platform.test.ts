import { describe, expect, it } from "vitest";
import {
  IOS_PUSH_NOTE,
  isIos,
  isIosSafari,
  isStandalone,
  type PlatformEnv,
} from "./platform";

const env = (over: Partial<PlatformEnv>): PlatformEnv => ({
  userAgent: "",
  platform: "",
  maxTouchPoints: 0,
  displayModeStandalone: false,
  ...over,
});

const IPHONE_SAFARI = env({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
});
const IPHONE_CHROME = env({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
});
const IPAD_OS = env({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 5,
});
const MAC_SAFARI = env({ ...IPAD_OS, maxTouchPoints: 0 });
const ANDROID_CHROME = env({
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv81",
  maxTouchPoints: 5,
});
const DESKTOP_CHROME = env({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  platform: "Win32",
});

describe("isIos / isIosSafari", () => {
  it("detects iPhone Safari", () => {
    expect(isIos(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
  });
  it("detects iPhone Chrome as iOS but not Safari", () => {
    expect(isIos(IPHONE_CHROME)).toBe(true);
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
  });
  it("detects other non-Safari iOS browsers", () => {
    for (const tag of ["FxiOS/124.0", "EdgiOS/123.0", "OPiOS/16.0"]) {
      const e = env({ ...IPHONE_SAFARI, userAgent: `iPhone ${tag}` });
      expect(isIosSafari(e)).toBe(false);
    }
  });
  it("detects iPadOS 13+ reporting as MacIntel with touch", () => {
    expect(isIos(IPAD_OS)).toBe(true);
    expect(isIosSafari(IPAD_OS)).toBe(true);
  });
  it("does not treat desktop Mac Safari as iOS", () => {
    expect(isIos(MAC_SAFARI)).toBe(false);
    expect(isIosSafari(MAC_SAFARI)).toBe(false);
  });
  it("does not treat Android or desktop Chrome as iOS", () => {
    expect(isIos(ANDROID_CHROME)).toBe(false);
    expect(isIos(DESKTOP_CHROME)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("is false by default", () => {
    expect(isStandalone(DESKTOP_CHROME)).toBe(false);
    expect(isStandalone(env({ standaloneNav: false }))).toBe(false);
  });
  it("is true for display-mode standalone", () => {
    expect(isStandalone(env({ displayModeStandalone: true }))).toBe(true);
  });
  it("is true for navigator.standalone", () => {
    expect(isStandalone(env({ standaloneNav: true }))).toBe(true);
  });
});

describe("IOS_PUSH_NOTE", () => {
  it("states the Home Screen requirement", () => {
    expect(IOS_PUSH_NOTE).toBe(
      "On iPhone and iPad, web push alerts only work after you add Garden HQ to the Home Screen (iOS 16.4 or later).",
    );
  });
});
