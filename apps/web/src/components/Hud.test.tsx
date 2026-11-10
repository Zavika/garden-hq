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

const PENDING = { data: undefined, isError: false };
const FAILED = { data: undefined, isError: true };

describe("Hud", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(SKYBLOCK_EPOCH_MS);
    contests.mockReset();
    mayor.mockReset();
  });

  it("shows date, season, next contest crops and the mayor", () => {
    contests.mockReturnValue({
      isError: false,
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
      isError: false,
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
    expect(screen.getByText(/wheat, carrot, potato/i)).toBeInTheDocument();
    expect(screen.getByText("Finnegan")).toBeInTheDocument();
    expect(screen.getByText(/your crop/i)).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Player XP" }),
    ).toBeInTheDocument();
  });

  it("strips Minecraft colour codes from the mayor name", () => {
    contests.mockReturnValue(PENDING);
    mayor.mockReturnValue({
      isError: false,
      data: {
        mayor: { key: "marina", name: "§bMarina", perks: [], minister: null },
        fetchedAt: "",
      },
    });
    renderWithProviders(<Hud assignedCropIds={[]} />);
    expect(screen.getByText("Marina")).toBeInTheDocument();
    expect(screen.queryByText(/§/)).not.toBeInTheDocument();
  });

  it("says loading while contests and mayor are still being fetched", () => {
    contests.mockReturnValue(PENDING);
    mayor.mockReturnValue(PENDING);
    renderWithProviders(<Hud assignedCropIds={[]} />);
    expect(screen.getByText(/contest: loading/i)).toBeInTheDocument();
    expect(screen.getByText(/mayor: loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByText(/early spring/i)).toBeInTheDocument();
  });

  it("says unavailable only after a fetch fails", () => {
    contests.mockReturnValue(FAILED);
    mayor.mockReturnValue(FAILED);
    renderWithProviders(<Hud assignedCropIds={[]} />);
    expect(screen.getAllByText(/unavailable/i)).toHaveLength(2);
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("degrades per slot", () => {
    contests.mockReturnValue(FAILED);
    mayor.mockReturnValue(PENDING);
    renderWithProviders(<Hud assignedCropIds={[]} />);
    expect(screen.getByText(/contest: unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/mayor: loading/i)).toBeInTheDocument();
  });
});
