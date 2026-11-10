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

describe("AssignCropSheet value hints", () => {
  it("shows the sell-offer value per 160 crops when provided", () => {
    render(
      <AssignCropSheet
        plotId="beginner_1"
        gardenLevel={2}
        onPick={() => {}}
        onClose={() => {}}
        cropValueHints={{ wheat: 12345.6, carrot: null }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Wheat.*12,346 coins.*160/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carrot" })).toBeInTheDocument();
    expect(screen.getByText(/not per hour/i)).toBeInTheDocument();
  });
});

describe("AssignCropSheet header", () => {
  it("titles the sheet with the in-game plot number only and closes from the header", async () => {
    const onClose = vi.fn();
    render(
      <AssignCropSheet
        plotId="intermediate_1"
        plotNumber={5}
        gardenLevel={10}
        onPick={() => {}}
        onClose={onClose}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Plot 5" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/intermediate_1/)).toBeNull();
    // The internal id remains available to assistive tech.
    expect(
      screen.getByRole("dialog", { name: /intermediate_1/ }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
