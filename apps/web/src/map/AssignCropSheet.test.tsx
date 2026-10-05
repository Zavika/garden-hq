import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssignCropSheet } from "./AssignCropSheet";

describe("AssignCropSheet", () => {
  it("offers the crops unlocked at the garden level and reports the pick", async () => {
    const onPick = vi.fn();
    render(
      <AssignCropSheet
        plotId="beginner_1"
        gardenLevel={2}
        onPick={onPick}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: /beginner_1/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wheat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carrot" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Potato" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Carrot" }));
    expect(onPick).toHaveBeenCalledWith("carrot");
  });

  it("can clear the assignment and closes on Escape", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <AssignCropSheet
        plotId="beginner_1"
        currentCropId="wheat"
        gardenLevel={1}
        onPick={onPick}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onPick).toHaveBeenCalledWith(null);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
