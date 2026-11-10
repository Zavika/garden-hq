import {
  ACHIEVEMENTS,
  dayKey,
  summarizeProgress,
  type GardenState,
} from "@garden-hq/core";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { AchievementsScreen } from "./AchievementsScreen";

const garden = vi.fn();
const engine = vi.fn();
const member = vi.fn();
vi.mock("../state/queries", () => ({
  useGarden: () => garden(),
  useMember: () => member(),
}));
vi.mock("../state/progress", () => ({ useProgressEngine: () => engine() }));

const UNLOCKED_AT = Date.UTC(2026, 10, 1, 12, 0, 0);

function gardenState(): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: Array.from({ length: 7 }, (_, i) => `beginner_${i + 1}`),
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
    visitorsServedTotal: 10,
    visitors: [],
    greenhouse: { lockedCells: [] },
  };
}

function storageWith() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u",
    profileId: "p1",
    profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  });
  const crops = [
    "wheat",
    "carrot",
    "potato",
    "pumpkin",
    "melon",
    "cactus",
    "cocoa_beans",
  ];
  crops.forEach((c, i) => storage.setAssignment(`beginner_${i + 1}`, c));
  const p = storage.getSnapshot().progress;
  storage.setProgress({
    ...p,
    achievements: { crops_5: { at: UNLOCKED_AT, xp: 40 } },
  });
  return storage;
}

function item(title: string) {
  const li = screen
    .getAllByRole("listitem")
    .find((el) => within(el).queryByText(title) !== null);
  if (li === undefined) throw new Error(`no item ${title}`);
  return li;
}

describe("AchievementsScreen", () => {
  beforeEach(() => {
    garden.mockReset();
    engine.mockReset();
    member.mockReset();
    member.mockReturnValue({ data: undefined });
  });

  it("renders every achievement, with unlocked and locked states", () => {
    garden.mockReturnValue({ data: { garden: gardenState(), fetchedAt: "" } });
    const storage = storageWith();
    renderWithProviders(<AchievementsScreen />, { storage });

    expect(screen.getAllByRole("listitem")).toHaveLength(ACHIEVEMENTS.length);

    const open = item("Crop sampler");
    expect(open).not.toHaveAttribute("aria-disabled", "true");
    expect(within(open).getByText(/unlocked/i)).toBeInTheDocument();
    expect(
      within(open).getByText(
        new Date(UNLOCKED_AT).toLocaleDateString(undefined, {
          timeZone: storage.getSnapshot().timeZone,
        }),
      ),
    ).toBeInTheDocument();

    const locked = item("Full harvest");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveClass("locked");
    expect(locked).toHaveAttribute("data-locked", "true");
    expect(open).not.toHaveAttribute("data-locked");
    expect(within(locked).getByText(/locked/i)).toBeInTheDocument();
    const progress = within(locked).getByText("7/13");
    expect(progress).toHaveClass("num");
    expect(progress.parentElement).toHaveTextContent("7/13 crops");
  });

  it("shows exact player level, XP into level and best streak", () => {
    garden.mockReturnValue({ data: { garden: gardenState(), fetchedAt: "" } });
    const storage = storageWith();
    const { container } = renderWithProviders(<AchievementsScreen />, {
      storage,
    });
    const snap = storage.getSnapshot();
    const expected = summarizeProgress(
      snap.progress,
      dayKey(Date.now(), snap.timeZone),
    );
    expect(expected.xp).toBe(40);
    const nums = Array.from(
      container.querySelectorAll(".ach-summary .num"),
      (el) => el.textContent,
    );
    expect(nums).toEqual([
      String(expected.level),
      String(expected.xpIntoLevel),
      String(expected.xpForNext),
      String(expected.bestStreak),
    ]);
  });

  it("hides member-based progress numbers while member data is unavailable", () => {
    garden.mockReturnValue({ data: { garden: gardenState(), fetchedAt: "" } });
    renderWithProviders(<AchievementsScreen />, { storage: storageWith() });
    const memberItems = ACHIEVEMENTS.filter(
      (a) =>
        a.check === "mutations_discovered" || a.check === "first_greenhouse",
    );
    expect(memberItems.length).toBeGreaterThan(0);
    for (const def of memberItems) {
      const li = item(def.title);
      expect(within(li).queryByText(/\d+\/\d+/)).toBeNull();
    }
    // Garden-based items still show numbers.
    expect(within(item("Full harvest")).getByText("7/13")).toBeInTheDocument();
  });

  it("shows no progress numbers for locked items before the garden loads", () => {
    garden.mockReturnValue({ data: undefined });
    renderWithProviders(<AchievementsScreen />, { storage: storageWith() });

    const locked = item("Full harvest");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(within(locked).queryByText(/\d+\/\d+/)).toBeNull();
    const open = item("Crop sampler");
    expect(within(open).getByText(/unlocked/i)).toBeInTheDocument();
  });

  it("runs the progress engine and links back to Home", () => {
    garden.mockReturnValue({ data: undefined });
    renderWithProviders(<AchievementsScreen />, { storage: storageWith() });
    expect(engine).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
