import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposterState } from "@garden-hq/core";
import { renderWithProviders } from "../test/renderWithProviders";
import { ComposterPanel } from "./ComposterPanel";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const HOUR = 3_600_000;

function composter(fields: Partial<ComposterState> = {}): ComposterState {
  return {
    organicMatter: 8000,
    fuel: 0,
    compostUnits: 12,
    lastSave: NOW - 30 * HOUR,
    upgrades: {
      speed: 0,
      multiDrop: 0,
      fuelCap: 0,
      organicMatterCap: 0,
      costReduction: 0,
    },
    ...fields,
  };
}

describe("ComposterPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("is idle with the real organic matter when there is no fuel", () => {
    renderWithProviders(<ComposterPanel composter={composter()} />);
    expect(screen.getByText(/composter idle — add fuel/i)).toBeInTheDocument();
    expect(
      screen.getByText("8,000 / 40,000 organic matter"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 / 40,000 fuel")).toBeInTheDocument();
    expect(screen.queryByText(/runs out/i)).not.toBeInTheDocument();
  });

  it("never shows a time in the past once fuel ran out while away", () => {
    renderWithProviders(
      <ComposterPanel composter={composter({ fuel: 2000 })} />,
    );
    expect(screen.getByText(/composter idle — add fuel/i)).toBeInTheDocument();
    expect(screen.queryByText(/lasts until/i)).not.toBeInTheDocument();
  });

  it("shows when a running composter will stop", () => {
    renderWithProviders(
      <ComposterPanel
        composter={composter({
          fuel: 30_000,
          organicMatter: 60_000,
          lastSave: NOW - HOUR / 3,
        })}
      />,
    );
    expect(screen.getByText(/running — fuel lasts until/i)).toBeInTheDocument();
    expect(screen.queryByText(/idle/i)).not.toBeInTheDocument();
  });

  it("asks for organic matter when that is what ran out", () => {
    renderWithProviders(
      <ComposterPanel
        composter={composter({ fuel: 30_000, organicMatter: 0 })}
      />,
    );
    expect(
      screen.getByText(/composter idle — add organic matter/i),
    ).toBeInTheDocument();
  });
});
