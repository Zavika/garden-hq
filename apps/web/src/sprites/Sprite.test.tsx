import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sprite } from "./Sprite";

const fallback = <span data-testid="fb">fb</span>;

describe("Sprite", () => {
  it("renders the fallback for an absent slot", () => {
    const { container } = render(
      <Sprite slot="crop:wheat" present={[]} fallback={fallback} />,
    );
    expect(screen.getByTestId("fb")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders an img for a present slot at the given scale", () => {
    const { container } = render(
      <Sprite
        slot="crop:wheat"
        present={["crop:wheat"]}
        scale={2}
        fallback={fallback}
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/sprites/crops/wheat.png");
    expect(img?.getAttribute("width")).toBe("32");
    expect(img?.getAttribute("height")).toBe("32");
    expect(img?.classList.contains("sprite")).toBe(true);
    expect(screen.queryByTestId("fb")).toBeNull();
  });

  it("swaps to the fallback on image error", () => {
    const { container } = render(
      <Sprite slot="soil" present={["soil"]} fallback={fallback} />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByTestId("fb")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not carry a failure over to a different slot", () => {
    const { container, rerender } = render(
      <Sprite slot="soil" present={["soil", "barn"]} fallback={fallback} />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    rerender(
      <Sprite slot="barn" present={["soil", "barn"]} fallback={fallback} />,
    );
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("clamps scale to an integer >= 1", () => {
    const { container, rerender } = render(
      <Sprite slot="soil" present={["soil"]} scale={1.6} fallback={fallback} />,
    );
    expect(container.querySelector("img")?.getAttribute("width")).toBe("32");
    rerender(
      <Sprite slot="soil" present={["soil"]} scale={0} fallback={fallback} />,
    );
    expect(container.querySelector("img")?.getAttribute("width")).toBe("16");
  });
});
