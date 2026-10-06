import { normalizeGarden } from "@garden-hq/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { LOCKED_CELLS } from "../test/greenhouseFixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { GreenhouseScreen } from "./GreenhouseScreen";

const mocks = vi.hoisted(() => ({
  useGarden: vi.fn(),
  useMember: vi.fn(),
}));
vi.mock("../state/queries", () => mocks);

const LINK = {
  name: "Steve",
  uuid: "u1",
  profileId: "p1",
  profiles: [{ profileId: "p1", name: "Apple", selected: true }],
};

function gardenAt(level: number) {
  const garden = normalizeGarden({
    garden_experience: level >= 7 ? 5000 : 0,
    unlocked_plots_ids: ["beginner_3"],
  });
  return { ...garden, greenhouse: { lockedCells: LOCKED_CELLS } };
}

beforeEach(() => {
  mocks.useGarden.mockReset();
  mocks.useMember.mockReset();
  mocks.useMember.mockReturnValue({ data: undefined, isError: false });
});

describe("GreenhouseScreen", () => {
  it("explains how to mark a Greenhouse when none is marked", () => {
    mocks.useGarden.mockReturnValue({
      data: { garden: gardenAt(7), fetchedAt: "x" },
      isError: false,
    });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByText(/No Greenhouse marked yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /map/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders one panel per marked plot once the garden has loaded", () => {
    mocks.useGarden.mockReturnValue({
      data: { garden: gardenAt(7), fetchedAt: "x" },
      isError: false,
    });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    storage.markGreenhouse("beginner_3");
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByRole("heading", { name: /Plot 4/ })).toBeInTheDocument();
  });

  it("does not draw a grid before the locked cells are known", () => {
    mocks.useGarden.mockReturnValue({ data: undefined, isError: false });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    storage.markGreenhouse("beginner_3");
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByText(/Loading your Garden/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cell 4,4/ })).toBeNull();
  });

  it("notes the level-7 requirement when below it and no Greenhouse is built", () => {
    mocks.useGarden.mockReturnValue({
      data: { garden: gardenAt(1), fetchedAt: "x" },
      isError: false,
    });
    const storage = createGardenStorage(null);
    storage.setLink(LINK);
    renderWithProviders(<GreenhouseScreen />, { storage });
    expect(screen.getByText(/unlocks at Garden Level 7/i)).toBeInTheDocument();
  });
});
