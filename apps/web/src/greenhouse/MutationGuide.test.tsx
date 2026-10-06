import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MutationGuide } from "./MutationGuide";

const base = {
  discovered: new Set(["ashwreath", "dustgrain"]),
  analyzed: new Set(["dustgrain"]),
  best: undefined,
  extraCells: 0 as number | null,
};

describe("MutationGuide", () => {
  it("lists mutations with progress and reports the choice", async () => {
    const onSelect = vi.fn();
    render(
      <MutationGuide {...base} selectedId={undefined} onSelect={onSelect} />,
    );
    const select = screen.getByLabelText("Target mutation");
    expect(
      screen.getByRole("option", { name: "Dustgrain (analysed)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Ashwreath (discovered)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Coalroot" }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(select, "dustgrain");
    expect(onSelect).toHaveBeenCalledWith("dustgrain");
  });

  it("shows the recipe for a neighbour mutation, including the unverified note", () => {
    render(
      <MutationGuide {...base} selectedId="dustgrain" onSelect={() => {}} />,
    );
    expect(screen.getByText("2× Wheat")).toBeInTheDocument();
    expect(screen.getByText(/Harvest Boost/)).toBeInTheDocument();
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
  });

  it("flags non-placeable ingredients", () => {
    render(
      <MutationGuide {...base} selectedId="ashwreath" onSelect={() => {}} />,
    );
    expect(screen.getByText(/2× fire/i)).toHaveTextContent(/not checked/i);
  });

  it("shows text-only recipes", () => {
    render(
      <MutationGuide
        {...base}
        selectedId="godseed"
        onSelect={() => {}}
        extraCells={1}
      />,
    );
    expect(
      screen.getByText("Needs all positive crop effects."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Needs a free 3×3 block/)).toBeInTheDocument();
  });

  it("shows how many more cells to unlock when the recipe does not fit", () => {
    const { rerender } = render(
      <MutationGuide
        {...base}
        selectedId="coalroot"
        onSelect={() => {}}
        extraCells={1}
      />,
    );
    expect(screen.getByText("Needs 1 more unlocked cell.")).toBeInTheDocument();

    rerender(
      <MutationGuide
        {...base}
        selectedId="noctilume"
        onSelect={() => {}}
        extraCells={4}
      />,
    );
    expect(
      screen.getByText("Needs 4 more unlocked cells."),
    ).toBeInTheDocument();

    rerender(
      <MutationGuide
        {...base}
        selectedId="noctilume"
        onSelect={() => {}}
        extraCells={null}
      />,
    );
    expect(screen.getByText("Can't fit in a 10×10 grid.")).toBeInTheDocument();
  });

  it("reports the best spot when the recipe fits", () => {
    const { rerender } = render(
      <MutationGuide
        {...base}
        selectedId="dustgrain"
        onSelect={() => {}}
        best={{
          x: 4,
          z: 4,
          status: { satisfied: true, missing: 0, required: 2, ingredients: [] },
        }}
      />,
    );
    expect(
      screen.getByText(/Recipe satisfied at cell 4,4/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/more unlocked cell/)).toBeNull();

    rerender(
      <MutationGuide
        {...base}
        selectedId="dustgrain"
        onSelect={() => {}}
        best={{
          x: 4,
          z: 5,
          status: {
            satisfied: false,
            missing: 1,
            required: 2,
            ingredients: [],
          },
        }}
      />,
    );
    expect(
      screen.getByText(/Closest spot: cell 4,5 — missing 1/),
    ).toBeInTheDocument();
  });
});
