import { describe, expect, it } from "vitest";
import {
  DAYS_PER_MONTH,
  MS_PER_SKYBLOCK_DAY,
  SKYBLOCK_EPOCH_MS,
  contestStartMs,
  isDaytime,
  seasonOf,
  skyblockDate,
} from "./calendar";

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

describe("seasonOf", () => {
  const expected = [
    "Early Spring",
    "Spring",
    "Late Spring",
    "Early Summer",
    "Summer",
    "Late Summer",
    "Early Autumn",
    "Autumn",
    "Late Autumn",
    "Early Winter",
    "Winter",
    "Late Winter",
  ];

  it.each(expected.map((name, i) => [i + 1, name] as const))(
    "month %i is %s",
    (month, name) => {
      const now = new Date(
        SKYBLOCK_EPOCH_MS + (month - 1) * DAYS_PER_MONTH * MS_PER_SKYBLOCK_DAY,
      );
      expect(seasonOf(skyblockDate(now))).toBe(name);
    },
  );
});

describe("contestStartMs", () => {
  it("is the inverse of skyblockDate at the start of a SkyBlock day", () => {
    const ms = contestStartMs(516, 3, 3);
    expect(skyblockDate(new Date(ms))).toMatchObject({
      year: 516,
      month: 3,
      day: 3,
    });
    expect(skyblockDate(new Date(ms - 1))).toMatchObject({
      year: 516,
      month: 3,
      day: 2,
    });
  });
  it("year 1, month 1, day 1 is the epoch", () => {
    expect(contestStartMs(1, 1, 1)).toBe(SKYBLOCK_EPOCH_MS);
  });
});
