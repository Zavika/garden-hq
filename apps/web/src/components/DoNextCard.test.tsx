import {
  ALL_PLOTS,
  MAX_SHOWN_ACTIONS,
  type Contest,
  type GardenState,
} from "@garden-hq/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { DoNextCard } from "./DoNextCard";

const contests = vi.fn<() => Contest[]>();
vi.mock("../state/queries", () => ({
  useContests: () => ({ data: { contests: contests() } }),
}));

function gardenState(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 1_000_000,
      fuel: 1_000_000,
      compostUnits: 3,
      lastSave: Date.now(),
      upgrades: {
        speed: 0,
        multiDrop: 0,
        fuelCap: 0,
        organicMatterCap: 0,
        costReduction: 0,
      },
    },
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

describe("DoNextCard", () => {
  beforeEach(() => contests.mockReturnValue([]));

  it("lists planned actions, linking the contest to the Contests screen", () => {
    contests.mockReturnValue([
      {
        startsAt: Date.now() + 10 * 60_000,
        crops: ["wheat", "carrot", "potato"],
      },
    ]);
    const storage = createGardenStorage(null);
    storage.setAssignment("beginner_1", "wheat");

    renderWithProviders(
      <DoNextCard
        garden={gardenState({ visitors: [{ id: "a", name: "Jacob" }] })}
      />,
      { storage },
    );

    expect(
      screen.getByRole("link", { name: /Wheat contest in \d+ min/ }),
    ).toHaveAttribute("href", "/contests");
    expect(screen.getByText("1/5 visitors waiting")).toBeInTheDocument();
    expect(screen.getByText(/^Unlock plot \d+$/)).toBeInTheDocument();
  });

  it("shows at most the configured number of actions", () => {
    const storage = createGardenStorage(null);
    for (const id of ["beginner_3", "beginner_4", "intermediate_1"]) {
      storage.markGreenhouse(id);
      storage.setWateringInterval(id, 1);
      storage.markGreenhouseWatered(id, Date.now() - 2 * 3_600_000);
    }
    renderWithProviders(
      <DoNextCard
        garden={gardenState({
          visitors: [{ id: "a", name: "Jacob" }],
          composter: { ...gardenState().composter, fuel: 0 },
        })}
      />,
      { storage },
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(MAX_SHOWN_ACTIONS);
    expect(
      screen.getAllByRole("link", { name: /Water the Greenhouse/ })[0],
    ).toHaveAttribute("href", "/greenhouse");
    expect(screen.queryByRole("link", { name: /Unlock plot/ })).toBeNull();
  });

  it("says there is nothing to do when the planner returns nothing", () => {
    renderWithProviders(
      <DoNextCard
        garden={gardenState({
          level: 15,
          experience: 60_120,
          unlockedPlotIds: ALL_PLOTS.map((plot) => plot.id),
        })}
      />,
    );
    expect(screen.getByText("Nothing to do right now.")).toBeInTheDocument();
  });
});
