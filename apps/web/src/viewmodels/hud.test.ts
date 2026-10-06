import { SKYBLOCK_EPOCH_MS, type Contest, type Mayor } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildHudViewModel, toSlot, type Slot } from "./hud";

const MAYOR: Mayor = {
  key: "finnegan",
  name: "Finnegan",
  perks: [{ name: "Farming Simulator", description: "…" }],
  minister: null,
};

const now = SKYBLOCK_EPOCH_MS;
const SOON: Contest = {
  startsAt: now + 600_000,
  crops: ["wheat", "carrot", "potato"],
};
const LATER: Contest = {
  startsAt: now + 3_600_000,
  crops: ["melon", "cactus", "pumpkin"],
};
const PAST: Contest = { startsAt: now - 1000, crops: ["wheat"] };

const ok = <T>(data: T): Slot<T> => ({ status: "ok", data });
const LOADING = { status: "loading" } as const;
const FAILED = { status: "unavailable" } as const;

describe("buildHudViewModel", () => {
  it("derives date, season and day/night from the clock", () => {
    const vm = buildHudViewModel(now, ok([]), ok(MAYOR), []);
    expect(vm.date).toMatchObject({ year: 1, month: 1, day: 1 });
    expect(vm.season).toBe("Early Spring");
    expect(vm.isDay).toBe(true);
  });

  it("picks the earliest upcoming contest and flags assigned-crop matches", () => {
    const vm = buildHudViewModel(now, ok([LATER, PAST, SOON]), ok(MAYOR), [
      "carrot",
    ]);
    expect(vm.nextContest).toEqual({
      status: "ok",
      startsAt: SOON.startsAt,
      crops: SOON.crops,
      matchesAssigned: true,
    });
  });

  it("reports matchesAssigned=false when no crop overlaps", () => {
    const vm = buildHudViewModel(now, ok([SOON]), ok(MAYOR), ["melon"]);
    expect(vm.nextContest).toMatchObject({
      status: "ok",
      matchesAssigned: false,
    });
  });

  it("distinguishes 'none upcoming', 'loading' and 'unavailable' contests", () => {
    const next = (c: Slot<Contest[]>) =>
      buildHudViewModel(now, c, ok(MAYOR), []).nextContest;
    expect(next(ok([PAST]))).toEqual({ status: "none" });
    expect(next(LOADING)).toEqual({ status: "loading" });
    expect(next(FAILED)).toEqual({ status: "unavailable" });
  });

  it("distinguishes loading, unavailable and loaded mayor", () => {
    const mayor = (m: Slot<Mayor | null>) =>
      buildHudViewModel(now, ok([]), m, []).mayor;
    expect(mayor(ok(MAYOR))).toEqual({ status: "ok", mayor: MAYOR });
    expect(mayor(LOADING)).toEqual({ status: "loading" });
    expect(mayor(FAILED)).toEqual({ status: "unavailable" });
    expect(mayor(ok(null))).toEqual({ status: "unavailable" });
  });
});

describe("toSlot", () => {
  it("is ok when data exists, even if a refetch errored", () => {
    expect(toSlot({ data: 1, isError: true })).toEqual({
      status: "ok",
      data: 1,
    });
  });

  it("is loading until the query errors, then unavailable", () => {
    expect(toSlot({ data: undefined, isError: false })).toEqual({
      status: "loading",
    });
    expect(toSlot({ data: undefined, isError: true })).toEqual({
      status: "unavailable",
    });
  });
});
