import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CropIcon } from "./PixelArt";

describe("CropIcon", () => {
  it("renders the svg fallback when no sprite is present", () => {
    const { container } = render(<CropIcon cropId="wheat" present={[]} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the sprite img when the slot is present", () => {
    const { container } = render(
      <CropIcon cropId="wheat" present={["crop:wheat"]} />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/sprites/crops/wheat.png",
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
