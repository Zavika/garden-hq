import type { GardenState, QuestRecord } from "@garden-hq/core";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProgressEvents } from "../state/progressEvents";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { QuestCard } from "./QuestCard";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const EXPIRES = Date.UTC(2026, 10, 11, 0, 0, 0);

function garden(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: ["beginner_1"],
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
    visitorsServedTotal: 102,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

function quest(over: Partial<QuestRecord>): QuestRecord {
  return {
    day: "2026-11-10",
    slot: 0,
    kind: "serve_visitors",
    params: { target: 4 },
    baseline: 100,
    createdAt: NOW - 60_000,
    expiresAt: EXPIRES,
    doneAt: null,
    xp: 25,
    ...over,
  };
}

function withQuests(quests: QuestRecord[]) {
  const storage = createGardenStorage(null);
  const p = storage.getSnapshot().progress;
  storage.setProgress({ ...p, quests });
  return storage;
}

describe("QuestCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    useProgressEvents.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it("renders title numbers, progress and xp in the num class", () => {
    const storage = withQuests([quest({})]);
    const { container } = renderWithProviders(<QuestCard garden={garden()} />, {
      storage,
    });
    const nums = Array.from(container.querySelectorAll(".num")).map(
      (e) => e.textContent,
    );
    expect(nums).toContain("4");
    expect(nums).toContain("2/4");
    expect(nums).toContain("25");
    expect(screen.getByText(/XP/)).toBeInTheDocument();
    expect(screen.getByText(/Resets in/)).toBeInTheDocument();
  });

  it("marks done quests for screen readers and hides progress", () => {
    const storage = withQuests([quest({ doneAt: NOW - 1000 })]);
    renderWithProviders(<QuestCard garden={garden()} />, { storage });
    expect(screen.getByText("done")).toHaveClass("sr-only");
    expect(screen.queryByText("2/4")).toBeNull();
  });

  it("lets the player log watering", () => {
    const storage = withQuests([
      quest({ kind: "water_greenhouse", params: {}, baseline: null }),
    ]);
    storage.markGreenhouse("beginner_1");
    renderWithProviders(<QuestCard garden={garden()} />, { storage });
    fireEvent.click(screen.getByRole("button", { name: "I watered it" }));
    expect(storage.getSnapshot().greenhouses["beginner_1"]?.lastWateredAt).toBe(
      NOW,
    );
  });

  it("has no watering button once the quest is done", () => {
    const storage = withQuests([
      quest({
        kind: "water_greenhouse",
        params: {},
        baseline: null,
        doneAt: NOW,
      }),
    ]);
    storage.markGreenhouse("beginner_1");
    renderWithProviders(<QuestCard garden={garden()} />, { storage });
    expect(screen.queryByRole("button", { name: "I watered it" })).toBeNull();
  });

  it("says all done only when every quest is done", () => {
    const done = (slot: number) => quest({ slot, doneAt: NOW - 1000 });
    const all = withQuests([done(0), done(1), done(2)]);
    const first = renderWithProviders(<QuestCard garden={garden()} />, {
      storage: all,
    });
    expect(
      screen.getByText(/All done — see you tomorrow\./),
    ).toBeInTheDocument();
    first.unmount();
    const open = withQuests([done(0), done(1), quest({ slot: 2 })]);
    renderWithProviders(<QuestCard garden={garden()} />, { storage: open });
    expect(screen.queryByText(/All done/)).toBeNull();
  });

  it("always renders an empty status region", () => {
    renderWithProviders(<QuestCard garden={garden()} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows an empty state", () => {
    renderWithProviders(<QuestCard garden={garden()} />);
    expect(
      screen.getByText(
        "No quests yet today. They appear when your Garden syncs.",
      ),
    ).toBeInTheDocument();
  });

  it("shows engine events and dismisses them", () => {
    renderWithProviders(<QuestCard garden={garden()} />);
    act(() =>
      useProgressEvents.getState().push([
        { type: "backfill", count: 3, xp: 150 },
        { type: "quest_done", day: "2026-11-10", slot: 0, xp: 25 },
      ]),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/3 achievements already earned/);
    expect(status).toHaveTextContent(/Quest done: \+25 XP/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(useProgressEvents.getState().events).toEqual([]);
  });

  it("never writes progress on mount", () => {
    const storage = withQuests([quest({})]);
    const spy = vi.spyOn(storage, "setProgress");
    renderWithProviders(<QuestCard garden={garden()} />, { storage });
    expect(spy).not.toHaveBeenCalled();
  });
});
