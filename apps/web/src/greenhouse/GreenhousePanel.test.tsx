import type { GardenMemberState } from "@garden-hq/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { LOCKED_CELLS } from "../test/greenhouseFixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { GreenhousePanel } from "./GreenhousePanel";

// getByRole over ~150 buttons is slow in jsdom, especially with parallel workers.
vi.setConfig({ testTimeout: 30_000 });

function setup(
  options: { member?: GardenMemberState; memberError?: boolean } = {},
) {
  const storage = createGardenStorage(null);
  storage.markGreenhouse("beginner_3");
  renderWithProviders(
    <GreenhousePanel
      plotId="beginner_3"
      lockedCells={LOCKED_CELLS}
      member={options.member}
      memberError={options.memberError}
    />,
    { storage },
  );
  return { storage, user: userEvent.setup() };
}

describe("GreenhousePanel", () => {
  it("is titled with the plot and shows locked cells as disabled", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: /Plot 4 \(beginner_3\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cell 0,0: locked/ }),
    ).toBeDisabled();
    expect(
      screen.getAllByText(/expand with Ethereal Vines/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Cell 4,4: empty" }),
    ).toBeEnabled();
  });

  it("places the selected crop on an unlocked cell and updates the bonus", async () => {
    const { storage, user } = setup();
    expect(screen.getByText(/0\/12 unique crops/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wheat" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,4: empty" }));
    expect(storage.getSnapshot().greenhouses.beginner_3?.cells).toEqual({
      "4,4": "wheat",
    });
    expect(
      screen.getByRole("button", { name: "Cell 4,4: Wheat" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1\/12 unique crops/)).toBeInTheDocument();
    expect(screen.getByText(/\+3%/)).toBeInTheDocument();
  });

  it("does nothing on a cell tap until a palette entry is chosen, and the eraser clears", async () => {
    const { storage, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cell 4,4: empty" }));
    expect(storage.getSnapshot().greenhouses.beginner_3?.cells).toEqual({});
    await user.click(screen.getByRole("button", { name: "Carrot" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,4: empty" }));
    await user.click(screen.getByRole("button", { name: "Clear cell" }));
    await user.click(screen.getByRole("button", { name: "Cell 4,4: Carrot" }));
    expect(storage.getSnapshot().greenhouses.beginner_3?.cells).toEqual({});
  });

  it("shows mutation progress and chip levels from the API", () => {
    setup({
      member: {
        discoveredMutations: [
          "ashwreath",
          "shadevine",
          "dead_plant",
          "dustgrain",
          "lonelily",
        ],
        analyzedMutations: ["ashwreath", "shadevine", "dustgrain"],
        chips: { cropshot: 5, quickdraw: 2 },
        hasGreenhouse: true,
        contestEntries: [],
      },
    });
    expect(
      screen.getByText("Discovered 4/40 · Analysed 3/40"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cropshot Lv 5")).toBeInTheDocument();
    expect(screen.getByText("Quickdraw Lv 2")).toBeInTheDocument();
  });

  it("says progress is unavailable when the member request failed", () => {
    setup({ memberError: true });
    expect(screen.getByText(/progress unavailable/i)).toBeInTheDocument();
  });

  it("highlights the cells where the chosen recipe is satisfied", async () => {
    const { user } = setup();
    const palette = within(
      screen.getByText(/Pick something/).closest(".gh-palette") as HTMLElement,
    );
    await user.click(palette.getByRole("button", { name: "Wheat" }));
    await user.click(screen.getByLabelText("Cell 4,3: empty"));
    await user.click(screen.getByLabelText("Cell 5,3: empty"));
    await user.selectOptions(
      screen.getByLabelText("Target mutation"),
      "dustgrain",
    );
    expect(
      screen.getByLabelText("Cell 4,4: empty (recipe satisfied here)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Recipe satisfied at cell/)).toBeInTheDocument();
  });

  it("stores a watering reminder interval and clears it", async () => {
    const { storage, user } = setup();
    const input = screen.getByLabelText(/remind me every/i);
    await user.type(input, "8");
    expect(
      storage.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours,
    ).toBe(8);
    await user.clear(input);
    expect(
      storage.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours,
    ).toBeNull();
  });

  it("records a manual watering time and shows its age", async () => {
    const { storage, user } = setup();
    expect(screen.getByText("Not watered yet")).toBeInTheDocument();
    await user.click(screen.getByText("I watered it"));
    const at = storage.getSnapshot().greenhouses.beginner_3?.lastWateredAt;
    expect(typeof at).toBe("number");
    expect(screen.getByText("Watered just now")).toBeInTheDocument();
    expect(screen.queryByText(/countdown|dries out|decays/i)).toBeNull();
  });

  it("removes the Greenhouse only after a second, confirming tap", async () => {
    const { storage, user } = setup();
    await user.click(screen.getByText("Remove Greenhouse"));
    expect(storage.getSnapshot().greenhouses.beginner_3).toBeDefined();
    expect(screen.getByText(/Confirm/)).toBeInTheDocument();
    await user.click(screen.getByText(/Confirm/));
    expect(storage.getSnapshot().greenhouses.beginner_3).toBeUndefined();
  });

  it("shows how many more cells a recipe needs on the owner's 12 unlocked cells", async () => {
    const { user } = setup();
    const target = screen.getByLabelText("Target mutation");
    await user.selectOptions(target, "coalroot");
    expect(screen.getByText("Needs 1 more unlocked cell.")).toBeInTheDocument();
    await user.selectOptions(target, "noctilume");
    expect(
      screen.getByText("Needs 4 more unlocked cells."),
    ).toBeInTheDocument();
    await user.selectOptions(target, "dustgrain");
    expect(screen.queryByText(/more unlocked cell/)).toBeNull();
  });
});
