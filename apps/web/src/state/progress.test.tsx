import { ALL_PLOTS, type GardenState } from "@garden-hq/core";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import { useProgressEngine } from "./progress";
import { useProgressEvents } from "./progressEvents";
import { createGardenStorage } from "./storage";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

const garden = vi.fn();
const member = vi.fn();
const contests = vi.fn();
vi.mock("./queries", () => ({
  useGarden: () => garden(),
  useMember: () => member(),
  useContests: () => contests(),
}));

function gardenState(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 0,
      fuel: 0,
      compostUnits: 0,
      lastSave: 0,
      upgrades: {
        speed: 0,
        multiDrop: 0,
        fuelCap: 0,
        organicMatterCap: 0,
        costReduction: 0,
      },
    },
    visitorsServedTotal: 100,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

function gardenResponse(
  over: Partial<GardenState> = {},
  fetchedAt = NOW - 60_000,
) {
  return {
    data: {
      garden: gardenState(over),
      fetchedAt: new Date(fetchedAt).toISOString(),
    },
  };
}

function linked() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u-1",
    profileId: "p1",
    profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  });
  return storage;
}

function Probe() {
  useProgressEngine();
  return null;
}

describe("useProgressEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    garden.mockReset();
    member.mockReset();
    member.mockReturnValue({ data: undefined });
    contests.mockReset();
    contests.mockReturnValue({ data: undefined, isPending: false });
    useProgressEvents.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it("generates quests on mount without completing any, idempotently", () => {
    garden.mockReturnValue(gardenResponse());
    const storage = linked();
    const spy = vi.spyOn(storage, "setProgress");
    renderWithProviders(<Probe />, { storage });
    const { quests } = storage.getSnapshot().progress;
    expect(quests).toHaveLength(3);
    expect(quests.every((q) => q.doneAt === null)).toBe(true);
    const calls = spy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(spy.mock.calls.length).toBe(calls);
    expect(storage.getSnapshot().progress.quests).toHaveLength(3);
  });

  it("writes nothing without garden data", () => {
    garden.mockReturnValue({ data: undefined });
    const storage = linked();
    const spy = vi.spyOn(storage, "setProgress");
    renderWithProviders(<Probe />, { storage });
    expect(spy).not.toHaveBeenCalled();
    expect(storage.getSnapshot().progress.quests).toHaveLength(0);
  });

  it("completes a counting quest when a later snapshot reaches the target", () => {
    garden.mockReturnValue(gardenResponse());
    const storage = linked();
    renderWithProviders(<Probe />, { storage });
    const counting = storage
      .getSnapshot()
      .progress.quests.find(
        (q) => q.kind === "serve_visitors" || q.kind === "gain_garden_xp",
      );
    expect(counting).toBeDefined();
    if (counting === undefined) return;
    garden.mockReturnValue(
      gardenResponse(
        { visitorsServedTotal: 10_000, experience: 1_000_000 },
        NOW + 30_000,
      ),
    );
    act(() => {
      vi.setSystemTime(NOW + 60_000);
      vi.advanceTimersByTime(30_000);
    });
    const done = storage
      .getSnapshot()
      .progress.quests.find((q) => q.slot === counting.slot);
    expect(done?.doneAt).not.toBeNull();
    expect(
      useProgressEvents.getState().events.some((e) => e.type === "quest_done"),
    ).toBe(true);
  });

  it("does not write again when progress is replaced by an equal copy", () => {
    garden.mockReturnValue(gardenResponse());
    const storage = linked();
    renderWithProviders(<Probe />, { storage });
    const spy = vi.spyOn(storage, "setProgress");
    const p = storage.getSnapshot().progress;
    act(() => {
      // Same content, new reference (what a sync pull produces).
      storage.setProgress(JSON.parse(JSON.stringify(p)));
    });
    // Only our own call; the hook must not respond with another write.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  describe("waiting for member and contest data", () => {
    // Level 15 with every plot leaves only serve_visitors plus member kinds
    // eligible (gain_garden_xp needs a next level), so 3 quests need a member.
    const maxedGarden = () =>
      gardenResponse({
        level: 15,
        unlockedPlotIds: ALL_PLOTS.map((plot) => plot.id),
      });
    const memberResponse = () => ({
      isPending: false,
      data: {
        member: {
          discoveredMutations: ["a", "b"],
          analyzedMutations: ["a"],
          chips: {},
          hasGreenhouse: true,
          contestEntries: [],
        },
        fetchedAt: new Date(NOW - 60_000).toISOString(),
      },
    });

    it("writes no quests while the member query is pending, then generates with member kinds", () => {
      garden.mockReturnValue(maxedGarden());
      member.mockReturnValue({ data: undefined, isPending: true });
      const storage = linked();
      const spy = vi.spyOn(storage, "setProgress");
      renderWithProviders(<Probe />, { storage });
      expect(spy).not.toHaveBeenCalled();
      expect(storage.getSnapshot().progress.quests).toHaveLength(0);
      member.mockReturnValue(memberResponse());
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      const kinds = storage.getSnapshot().progress.quests.map((q) => q.kind);
      expect(kinds).toHaveLength(3);
      expect(kinds).toContain("discover_mutation");
      expect(kinds).toContain("analyze_mutation");
    });

    it("waits for the contests query too", () => {
      garden.mockReturnValue(maxedGarden());
      member.mockReturnValue(memberResponse());
      contests.mockReturnValue({ data: undefined, isPending: true });
      const storage = linked();
      renderWithProviders(<Probe />, { storage });
      expect(storage.getSnapshot().progress.quests).toHaveLength(0);
    });

    it("proceeds without member kinds when the member query errored", () => {
      garden.mockReturnValue(maxedGarden());
      member.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
      });
      const storage = linked();
      renderWithProviders(<Probe />, { storage });
      const kinds = storage.getSnapshot().progress.quests.map((q) => q.kind);
      expect(kinds).toEqual(["serve_visitors"]);
    });

    it("stamps the linked profile on generated quests", () => {
      garden.mockReturnValue(gardenResponse());
      const storage = linked();
      renderWithProviders(<Probe />, { storage });
      for (const q of storage.getSnapshot().progress.quests) {
        expect(q.params.profileId).toBe("p1");
      }
    });
  });
});
