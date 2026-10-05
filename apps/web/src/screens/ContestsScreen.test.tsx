import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { ContestsScreen } from "./ContestsScreen";

const contests = vi.fn();
vi.mock("../state/queries", () => ({ useContests: () => contests() }));

const AT = Date.now() + 3_600_000;
const data = {
  contests: [
    { startsAt: AT, crops: ["wheat", "carrot", "potato"] },
    { startsAt: AT + 3_600_000, crops: ["melon", "cactus", "pumpkin"] },
  ],
  source: { name: "Strassburger", url: "https://jacobs.strassburger.dev" },
  fetchedAt: "",
};

describe("ContestsScreen", () => {
  beforeEach(() => contests.mockReset());

  it("shows all contests with a hint when no crops are assigned", () => {
    contests.mockReturnValue({ data });
    renderWithProviders(<ContestsScreen />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/assign crops to your plots/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /strassburger/i })).toHaveAttribute(
      "href",
      "https://jacobs.strassburger.dev",
    );
  });

  it("filters to assigned crops", () => {
    contests.mockReturnValue({ data });
    const storage = createGardenStorage(null);
    storage.setAssignment("beginner_1", "melon");
    renderWithProviders(<ContestsScreen />, { storage });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("shows all contests with a hint when assigned crops are not contest crops", () => {
    contests.mockReturnValue({ data });
    const storage = createGardenStorage(null);
    storage.setAssignment("beginner_1", "sunflower");
    renderWithProviders(<ContestsScreen />, { storage });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByText(/aren.t Jacob.s Contest crops/i),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no upcoming contests", () => {
    contests.mockReturnValue({ data: { ...data, contests: [] } });
    renderWithProviders(<ContestsScreen />);
    expect(screen.getByText("No upcoming contests.")).toBeInTheDocument();
  });

  it("shows a filtered empty state", () => {
    contests.mockReturnValue({
      data: { ...data, contests: [data.contests[0]] },
    });
    const storage = createGardenStorage(null);
    storage.setAssignment("beginner_1", "melon");
    renderWithProviders(<ContestsScreen />, { storage });
    expect(
      screen.getByText("No upcoming contests for your crops."),
    ).toBeInTheDocument();
  });

  it("says so when the schedule is unavailable", () => {
    contests.mockReturnValue({ data: undefined, isError: true });
    renderWithProviders(<ContestsScreen />);
    expect(
      screen.getByText(/contest schedule is unavailable/i),
    ).toBeInTheDocument();
  });
});
