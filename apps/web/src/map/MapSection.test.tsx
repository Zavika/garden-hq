import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { normalizeGarden } from "@garden-hq/core";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import { useUi } from "../state/ui";
import { MapSection } from "./MapSection";

// jsdom has no WebGL. Stub the lazily-imported scene so mounting fails fast and
// silently (the real Pixi chunk is ~250 kB and its jsdom failure is noisy and slow).
vi.mock("./MapScene", () => ({
  MapScene: class {
    mount(): Promise<void> {
      return Promise.reject(new Error("WebGL unavailable"));
    }
    setHandlers(): void {}
    update(): void {}
    resize(): void {}
    destroy(): void {}
  },
}));

const garden = normalizeGarden({
  garden_experience: 0,
  unlocked_plots_ids: ["beginner_1"],
});

describe("MapSection", () => {
  it("assigns a crop through the DOM plot list and persists it", async () => {
    useUi.setState({ selectedPlotId: null, hoveredPlotId: null });
    const { storage } = renderWithProviders(
      <MapSection garden={garden} assignments={{}} />,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /beginner_1/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Wheat" }));
    expect(storage.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the compost cost of a locked plot in the list", async () => {
    renderWithProviders(<MapSection garden={garden} assignments={{}} />);
    expect(
      await screen.findByText(/beginner_2.*2 compost/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^expert_1 .*cost unknown/i)).toBeInTheDocument();
  });
});
