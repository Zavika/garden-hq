import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKYBLOCK_EPOCH_MS } from "@garden-hq/core";
import { renderWithProviders } from "../test/renderWithProviders";
import { Hud } from "./Hud";

const contests = vi.fn();
const mayor = vi.fn();
vi.mock("../state/queries", () => ({
  useContests: () => contests(),
  useMayor: () => mayor(),
}));

describe("Hud", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(SKYBLOCK_EPOCH_MS);
    contests.mockReset();
    mayor.mockReset();
  });

  it("shows date, season, next contest crops and the mayor", () => {
    contests.mockReturnValue({
      data: {
        contests: [
          {
            startsAt: SKYBLOCK_EPOCH_MS + 600_000,
            crops: ["wheat", "carrot", "potato"],
          },
        ],
        source: { name: "EliteBot", url: "https://x" },
        fetchedAt: "",
      },
    });
    mayor.mockReturnValue({
      data: {
        mayor: {
          key: "finnegan",
          name: "Finnegan",
          perks: [{ name: "Farming Simulator", description: "x" }],
          minister: null,
        },
        fetchedAt: "",
      },
    });
    renderWithProviders(<Hud assignedCropIds={["carrot"]} />);
    expect(screen.getByText(/early spring/i)).toBeInTheDocument();
    expect(screen.getByText(/wheat/i)).toBeInTheDocument();
    expect(
      screen.getByText(/finnegan \(farming simulator\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/you have a plot for this/i)).toBeInTheDocument();
  });

  it("degrades per slot when contests or mayor are unavailable", () => {
    contests.mockReturnValue({ data: undefined });
    mayor.mockReturnValue({ data: undefined });
    renderWithProviders(<Hud assignedCropIds={[]} />);
    expect(screen.getAllByText(/unavailable/i)).toHaveLength(2);
    expect(screen.getByText(/early spring/i)).toBeInTheDocument();
  });
});
