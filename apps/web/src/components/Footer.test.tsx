import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import { Footer } from "./Footer";

let contestSource: { name: string; url: string } | undefined;
vi.mock("../state/queries", () => ({
  useContests: () => ({
    data: contestSource ? { source: contestSource } : undefined,
  }),
}));

beforeEach(() => {
  contestSource = undefined;
});

describe("Footer", () => {
  it("shows the disclaimer", () => {
    renderWithProviders(<Footer />);
    expect(
      screen.getByText("Not affiliated with Hypixel or Mojang."),
    ).toBeInTheDocument();
  });

  it("links the live contest source when present", () => {
    contestSource = { name: "LiveSource", url: "https://live.example" };
    renderWithProviders(<Footer />);
    expect(screen.getByRole("link", { name: "LiveSource" })).toHaveAttribute(
      "href",
      "https://live.example",
    );
  });

  it("falls back to EliteBot without a source", () => {
    renderWithProviders(<Footer />);
    expect(screen.getByRole("link", { name: "EliteBot" })).toHaveAttribute(
      "href",
      "https://api.elitebot.dev",
    );
  });

  it("has an About landmark with Privacy and Credits links", () => {
    renderWithProviders(<Footer />);
    const nav = screen.getByRole("navigation", { name: "About" });
    expect(within(nav).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(within(nav).getByRole("link", { name: "Credits" })).toHaveAttribute(
      "href",
      "/credits",
    );
  });
});
