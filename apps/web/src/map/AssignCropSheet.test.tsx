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

describe("AssignCropSheet greenhouse actions", () => {
  function sheet(
    greenhouse: Parameters<typeof AssignCropSheet>[0]["greenhouse"],
  ) {
    render(
      <AssignCropSheet
        plotId="beginner_3"
        plotNumber={4}
        gardenLevel={7}
        onPick={() => {}}
        onClose={() => {}}
        greenhouse={greenhouse}
      />,
    );
  }

  it("offers 'Mark as Greenhouse' and calls onMark", async () => {
    const onMark = vi.fn();
    sheet({
      marked: false,
      canMark: true,
      onMark,
      onRemove: () => {},
      onOpen: () => {},
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Mark as Greenhouse" }),
    );
    expect(onMark).toHaveBeenCalled();
  });

  it("disables marking at the maximum", () => {
    sheet({
      marked: false,
      canMark: false,
      onMark: () => {},
      onRemove: () => {},
      onOpen: () => {},
    });
    expect(
      screen.getByRole("button", { name: "Mark as Greenhouse" }),
    ).toBeDisabled();
    expect(screen.getByText(/at most 3 Greenhouses/i)).toBeInTheDocument();
  });

  it("requires a second tap to remove a Greenhouse, and can open it", async () => {
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    sheet({ marked: true, canMark: true, onMark: () => {}, onRemove, onOpen });
    await userEvent.click(
      screen.getByRole("button", { name: "Open Greenhouse" }),
    );
    expect(onOpen).toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Greenhouse" }),
    );
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm \u2014 clears its grid" }),
    );
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows no greenhouse actions when the prop is absent", () => {
    sheet(undefined);
    expect(
      screen.queryByRole("button", { name: "Mark as Greenhouse" }),
    ).toBeNull();
  });
});
