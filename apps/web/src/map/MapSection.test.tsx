import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { normalizeGarden } from "@garden-hq/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import { useUi } from "../state/ui";
import { createGardenStorage } from "../state/storage";
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
  beforeEach(() => {
    useUi.setState({ selectedPlotId: null, hoveredPlotId: null });
  });

  it("falls back to an open plot list when the scene cannot mount", async () => {
    const { container } = renderWithProviders(
      <MapSection garden={garden} assignments={{}} />,
    );
    await waitFor(() => expect(container.querySelector("canvas")).toBeNull());
    expect(screen.getByText("Plot list").closest("details")).toHaveAttribute(
      "open",
    );
  });

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
      await screen.findByText(/^Plot 1 \(beginner_2\).*2 compost/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^Plot 21 \(expert_1\).*1280 compost/i),
    ).toBeInTheDocument();
  });

  it("marks the selected plot as a Greenhouse from the sheet", async () => {
    const storage = createGardenStorage(null);
    const g = normalizeGarden({
      garden_experience: 0,
      unlocked_plots_ids: ["beginner_1", "beginner_3"],
    });
    renderWithProviders(
      <MapSection garden={g} assignments={{}} greenhousePlotIds={[]} />,
      { storage },
    );
    useUi.setState({ selectedPlotId: "beginner_3" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Mark as Greenhouse" }),
    );
    expect(Object.keys(storage.getSnapshot().greenhouses)).toEqual([
      "beginner_3",
    ]);
  });

  it("does not carry an armed Remove confirmation over to another plot", async () => {
    const storage = createGardenStorage(null);
    storage.markGreenhouse("beginner_1");
    storage.markGreenhouse("beginner_3");
    const g = normalizeGarden({
      garden_experience: 0,
      unlocked_plots_ids: ["beginner_1", "beginner_3"],
    });
    renderWithProviders(
      <MapSection
        garden={g}
        assignments={{}}
        greenhousePlotIds={["beginner_1", "beginner_3"]}
      />,
      { storage },
    );
    useUi.setState({ selectedPlotId: "beginner_1" });
    await userEvent.click(await screen.findByText("Remove Greenhouse"));
    expect(screen.getByText(/Confirm/)).toBeInTheDocument();
    useUi.setState({ selectedPlotId: "beginner_3" });
    expect(await screen.findByText("Remove Greenhouse")).toBeInTheDocument();
    expect(screen.queryByText(/Confirm/)).toBeNull();
  });
});
