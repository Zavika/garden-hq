import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import creditsJson from "../../../../data/credits.json";
import { renderWithProviders } from "../test/renderWithProviders";
import { CreditsScreen } from "./CreditsScreen";

let contestSource: { name: string; url: string } | undefined;
vi.mock("../state/queries", () => ({
  useContests: () => ({
    data: contestSource ? { source: contestSource } : undefined,
  }),
}));

beforeEach(() => {
  contestSource = undefined;
});

describe("CreditsScreen", () => {
  it("shows the heading and disclaimer", () => {
    renderWithProviders(<CreditsScreen />);
    expect(
      screen.getByRole("heading", { name: "Credits" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not affiliated with Hypixel or Mojang."),
    ).toBeInTheDocument();
  });

  it("links every source in a new tab", () => {
    renderWithProviders(<CreditsScreen />);
    for (const s of creditsJson.sources) {
      const link = screen.getByRole("link", { name: s.name });
      expect(link).toHaveAttribute("href", s.url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("lists the libraries", () => {
    renderWithProviders(<CreditsScreen />);
    for (const l of creditsJson.libraries) {
      expect(screen.getByRole("link", { name: l.name })).toHaveAttribute(
        "href",
        l.url,
      );
    }
  });

  it("omits Sprites by when spriteArtist is empty", () => {
    renderWithProviders(<CreditsScreen />);
    expect(screen.queryByText(/Sprites by/)).not.toBeInTheDocument();
  });

  it("shows Sprites by when a name is injected", () => {
    renderWithProviders(
      <CreditsScreen data={{ ...creditsJson, spriteArtist: "Alice" }} />,
    );
    expect(screen.getByText("Sprites by Alice")).toBeInTheDocument();
  });

  it("shows the live contest source when present", () => {
    contestSource = { name: "LiveSource", url: "https://live.example" };
    renderWithProviders(<CreditsScreen />);
    expect(screen.getByRole("link", { name: "LiveSource" })).toHaveAttribute(
      "href",
      "https://live.example",
    );
  });
});
