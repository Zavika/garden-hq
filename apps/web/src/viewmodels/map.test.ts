import { ALL_PLOTS, BARN_CELL, normalizeGarden } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildMapViewModel, type BarnTile, type PlotTile } from "./map";

function garden(overrides: Record<string, unknown> = {}) {
  return normalizeGarden({
    garden_experience: 0,
    unlocked_plots_ids: ["beginner_1", "beginner_2"],
    active_commissions: { liam: {}, farmer_jon: {} },
    ...overrides,
  });
}

function plots(vm: ReturnType<typeof buildMapViewModel>): PlotTile[] {
  return vm.tiles.filter((t): t is PlotTile => t.kind === "plot");
}

describe("buildMapViewModel", () => {
  it("has 24 plot tiles and one barn tile at the barn cell", () => {
    const vm = buildMapViewModel(garden(), {});
    expect(plots(vm)).toHaveLength(ALL_PLOTS.length);
    const barns = vm.tiles.filter((t): t is BarnTile => t.kind === "barn");
    expect(barns).toHaveLength(1);
    expect(barns[0]).toMatchObject({ x: BARN_CELL.x, y: BARN_CELL.y });
  });

  it("marks locked, unlocked and assigned plots", () => {
    const vm = buildMapViewModel(garden(), { beginner_1: "wheat" });
    const byId = new Map(plots(vm).map((t) => [t.plotId, t]));
    expect(byId.get("beginner_1")).toMatchObject({
      state: "assigned",
      cropId: "wheat",
    });
    expect(byId.get("beginner_2")).toMatchObject({ state: "unlocked" });
    expect(byId.get("beginner_2")?.cropId).toBeUndefined();
    expect(byId.get("beginner_3")).toMatchObject({
      state: "locked",
      lockedCost: 4,
    });
  });

  it("uses the tier ladder by owned count when bought out of order", () => {
    const vm = buildMapViewModel(
      garden({ unlocked_plots_ids: ["beginner_4"] }),
      {},
    );
    const byId = new Map(plots(vm).map((t) => [t.plotId, t]));
    expect(byId.get("beginner_1")?.lockedCost).toBe(2);
    expect(byId.get("beginner_3")?.lockedCost).toBe(2);
  });

  it("ignores an assignment on a still-locked plot", () => {
    const vm = buildMapViewModel(garden(), { beginner_4: "wheat" });
    expect(plots(vm).find((t) => t.plotId === "beginner_4")?.state).toBe(
      "locked",
    );
  });

  it("glows only plots that touch the Barn or an owned plot (real account)", () => {
    const state = garden({
      garden_experience: 100_000,
      unlocked_plots_ids: [
        "beginner_1",
        "beginner_2",
        "beginner_3",
        "beginner_4",
        "intermediate_1",
        "intermediate_2",
        "intermediate_3",
        "intermediate_4",
        "advanced_5",
      ],
    });
    expect(state.level).toBeGreaterThanOrEqual(7);
    const numbers = (availability: PlotTile["availability"]) =>
      plots(buildMapViewModel(state, {}))
        .filter((t) => t.availability === availability)
        .map((t) => t.plotNumber)
        .sort((a, b) => a - b);
    expect(numbers("buyable")).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 23,
    ]);
    expect(numbers("unreachable")).toEqual([21, 22, 24]);
    expect(numbers("owned")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 19]);
  });

  it("marks locked plots buyable only once the garden level reaches their tier", () => {
    const state = garden({ garden_experience: 300 });
    expect(state.level).toBe(4);
    const low = buildMapViewModel(state, {});
    const byId = new Map(plots(low).map((t) => [t.plotId, t]));
    expect(byId.get("beginner_1")?.availability).toBe("owned");
    expect(byId.get("beginner_3")?.availability).toBe("buyable");
    expect(byId.get("intermediate_1")?.availability).toBe("buyable");
    expect(byId.get("advanced_1")?.availability).toBe("unreachable");
    expect(byId.get("expert_1")?.availability).toBe("unreachable");
  });

  it("carries the in-game plot number and the expert ladder cost", () => {
    const vm = buildMapViewModel(garden(), {});
    expect(plots(vm).find((t) => t.plotId === "expert_1")).toMatchObject({
      plotNumber: 21,
      lockedCost: 1280,
    });
    expect(plots(vm).find((t) => t.plotId === "advanced_5")?.plotNumber).toBe(
      19,
    );
  });

  it("puts visitors on the barn and counts overflow past 5", () => {
    const many = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f", "g"].map((k) => [k, {}]),
    );
    const barn = buildMapViewModel(
      garden({ active_commissions: many }),
      {},
    ).tiles.find((t): t is BarnTile => t.kind === "barn");
    expect(barn?.visitors).toHaveLength(5);
    expect(barn?.overflow).toBe(2);
  });

  it("flags unlocked marked plots as greenhouses and ignores locked ones", () => {
    const g = normalizeGarden({
      garden_experience: 0,
      unlocked_plots_ids: ["beginner_1", "beginner_3"],
    });
    const vm = buildMapViewModel(g, {}, new Set(["beginner_3", "beginner_2"]));
    const byId = new Map(plots(vm).map((t) => [t.plotId, t]));
    expect(byId.get("beginner_3")?.greenhouse).toBe(true);
    expect(byId.get("beginner_2")?.greenhouse).toBe(false); // locked
    expect(byId.get("beginner_1")?.greenhouse).toBe(false);
  });
});
