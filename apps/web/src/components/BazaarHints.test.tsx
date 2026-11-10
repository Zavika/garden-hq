import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOST_ID, LOOSE_COMPOST_MAX_COST } from "@garden-hq/core";
import { renderWithProviders } from "../test/renderWithProviders";
import { BazaarHints } from "./BazaarHints";

const bazaar = vi.fn();
vi.mock("../state/queries", () => ({ useBazaar: () => bazaar() }));

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

const data = {
  prices: {
    ENCHANTED_CARROT: { sellOffer: 1000, instantSell: 900 },
    CARROT_ITEM: { sellOffer: 3, instantSell: 2 },
    [COMPOST_ID]: { sellOffer: 2500, instantSell: 2400 },
  },
  lastUpdated: NOW - 4 * 60_000,
  fetchedAt: new Date(NOW - 2 * 60_000).toISOString(),
};

describe("BazaarHints", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    bazaar.mockReset();
  });

  it("shows a loading state", () => {
    bazaar.mockReturnValue({ data: undefined, isError: false });
    renderWithProviders(<BazaarHints />);
    expect(screen.getByText(/loading bazaar prices/i)).toBeInTheDocument();
  });

  it("shows a non-blocking message on error without data", () => {
    bazaar.mockReturnValue({ data: undefined, isError: true });
    renderWithProviders(<BazaarHints />);
    expect(screen.getByText(/bazaar prices unavailable/i)).toBeInTheDocument();
  });

  it("lists crops best first with formatted prices, caption and freshness", () => {
    bazaar.mockReturnValue({ data, isError: false });
    renderWithProviders(<BazaarHints />);
    expect(
      screen.getByText(/coins per 160 crops, not per hour/i),
    ).toBeInTheDocument();
    const items = screen.getAllByRole("row").slice(1);
    // Carrot (1000 per 160 raw/160 per enchanted) is the only crop with data.
    expect(within(items[0] as HTMLElement).getByText("Carrot")).toBeVisible();
    expect(within(items[0] as HTMLElement).getByText("1,000")).toBeVisible();
    expect(within(items[0] as HTMLElement).getByText("900")).toBeVisible();
    expect(within(items[0] as HTMLElement).getByText(/best/i)).toBeVisible();
    // A crop without prices says so.
    expect(screen.getAllByText(/no data/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/prices as of 4 min ago/i)).toBeInTheDocument();
  });

  it("shows the Compost price and the next plot's coin cost", () => {
    bazaar.mockReturnValue({ data, isError: false });
    renderWithProviders(<BazaarHints nextPlot={{ plotNumber: 6, cost: 16 }} />);
    expect(screen.getByText(/coins each/i).textContent).toMatch(
      /Compost:\s*2,500/,
    );
    expect(screen.getByText(/next plot \(plot 6\)/i).textContent).toMatch(
      /16 Compost ~ 40,000 coins/,
    );
  });

  it("omits the next plot row without a plot", () => {
    bazaar.mockReturnValue({ data, isError: false });
    renderWithProviders(<BazaarHints />);
    expect(screen.queryByText(/next plot/i)).toBeNull();
  });

  it("shows the next plot at the loose-Compost threshold but not above it", () => {
    bazaar.mockReturnValue({ data, isError: false });
    const { unmount } = renderWithProviders(
      <BazaarHints
        nextPlot={{ plotNumber: 9, cost: LOOSE_COMPOST_MAX_COST }}
      />,
    );
    expect(screen.getByText(/next plot/i)).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <BazaarHints
        nextPlot={{ plotNumber: 9, cost: LOOSE_COMPOST_MAX_COST + 32 }}
      />,
    );
    expect(screen.queryByText(/next plot/i)).toBeNull();
  });

  it("hides Compost-dependent rows when Compost has no price", () => {
    const prices = { ...data.prices } as Record<string, unknown>;
    delete prices[COMPOST_ID];
    bazaar.mockReturnValue({ data: { ...data, prices }, isError: false });
    renderWithProviders(<BazaarHints nextPlot={{ plotNumber: 6, cost: 16 }} />);
    expect(screen.queryByText(/coins each/i)).toBeNull();
    expect(screen.queryByText(/next plot/i)).toBeNull();
  });
});
