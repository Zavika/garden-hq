import { render, screen } from "@testing-library/react";
import { normalizeGarden } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMapViewModel } from "../viewmodels/map";
import { MapCanvas } from "./MapCanvas";

// Controls when the stubbed scene finishes mounting (jsdom has no WebGL).
const mountGate = vi.hoisted(() => ({
  resolve: null as (() => void) | null,
}));

vi.mock("./MapScene", () => ({
  MapScene: class {
    mount(): Promise<void> {
      return new Promise<void>((resolve) => {
        mountGate.resolve = resolve;
      });
    }
    setHandlers(): void {}
    update(): void {}
    resize(): number {
      return 64;
    }
    destroy(): void {}
  },
}));

const viewModel = buildMapViewModel(
  normalizeGarden({ garden_experience: 0, unlocked_plots_ids: ["beginner_1"] }),
  {},
);
const handlers = { onPlotTap: () => {}, onPlotHover: () => {} };

function renderCanvas() {
  return render(
    <MapCanvas
      viewModel={viewModel}
      handlers={handlers}
      onUnavailable={() => {}}
    />,
  );
}

describe("MapCanvas", () => {
  afterEach(() => {
    mountGate.resolve = null;
  });

  it("shows a placeholder and no plot badges until the scene has mounted", async () => {
    const { container } = renderCanvas();
    expect(screen.getByRole("status")).toHaveTextContent("Loading map");
    expect(container.querySelector(".plot-badges")).toBeNull();
    expect(container.querySelector(".map-frame")).toHaveClass("is-loading");

    await vi.waitFor(() => expect(mountGate.resolve).not.toBeNull());
    mountGate.resolve?.();

    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".map-frame")).not.toHaveClass("is-loading");
  });

  it("sizes the frame before the scene loads", () => {
    const { container } = renderCanvas();
    const frame = container.querySelector<HTMLElement>(".map-frame");
    // jsdom reports 0 width, so the frame falls back to one logical tile per cell.
    expect(frame?.style.width).toBe("80px");
    expect(frame?.style.height).toBe("80px");
  });
});
