import { describe, expect, it } from "vitest";
import { SKYBLOCK_EPOCH_MS, isDaytime, skyblockDate } from "./calendar";

describe("skyblockDate", () => {
  it("is year 1, month 1 (Early Spring), day 1 at the epoch", () => {
    expect(skyblockDate(new Date(SKYBLOCK_EPOCH_MS))).toEqual({
      year: 1,
      month: 1,
      monthName: "Early Spring",
      day: 1,
    });
  });

  it("advances month/day 35 SkyBlock days later", () => {
    const msPerDay = 20 * 60 * 1000;
    const date = new Date(SKYBLOCK_EPOCH_MS + 35 * msPerDay);
    expect(skyblockDate(date)).toEqual({
      year: 1,
      month: 2,
      monthName: "Spring",
      day: 5,
    });
  });
});

describe("isDaytime", () => {
  it("is daytime at the start of a SkyBlock day", () => {
    expect(isDaytime(new Date(SKYBLOCK_EPOCH_MS))).toBe(true);
  });

  it("is nighttime at the halfway point of a SkyBlock day", () => {
    const msPerDay = 20 * 60 * 1000;
    expect(isDaytime(new Date(SKYBLOCK_EPOCH_MS + msPerDay / 2))).toBe(false);
  });
});
