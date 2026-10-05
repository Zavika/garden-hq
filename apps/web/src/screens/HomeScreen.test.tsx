import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { HomeScreen } from "./HomeScreen";

const garden = vi.fn();
vi.mock("../state/queries", () => ({
  useGarden: () => garden(),
  useContests: () => ({ data: undefined }),
  useMayor: () => ({ data: undefined }),
}));

function linkedStorage() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u",
    profileId: "p1",
    profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  });
  return storage;
}

function errored(error: Error) {
  return {
    data: undefined,
    error,
    isError: true,
    isFetching: false,
    errorUpdatedAt: 0,
    refetch: vi.fn(),
  };
}

describe("HomeScreen error card", () => {
  beforeEach(() => garden.mockReset());

  it("offers no retry while rate limited", () => {
    garden.mockReturnValue(
      errored(new ApiError("rate_limited", 429, "Slow down", 30)),
    );
    renderWithProviders(<HomeScreen />, { storage: linkedStorage() });
    expect(screen.getByText(/couldn.t load your garden/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry for other errors", () => {
    garden.mockReturnValue(errored(new ApiError("upstream_down", 502, "Down")));
    renderWithProviders(<HomeScreen />, { storage: linkedStorage() });
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });
});
