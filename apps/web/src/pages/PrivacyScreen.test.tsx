import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import { PrivacyScreen } from "./PrivacyScreen";
import {
  BROWSER_KEYS,
  PRIVACY_CONTACT_URL,
  RECIPIENTS,
  SERVER_TABLES,
} from "./privacy";

vi.mock("../state/queries", () => ({
  useContests: () => ({ data: undefined }),
}));

describe("PrivacyScreen", () => {
  it("shows the heading and last-updated line", () => {
    renderWithProviders(<PrivacyScreen />);
    expect(
      screen.getByRole("heading", { name: "Privacy" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Last updated 2026-11-10")).toBeInTheDocument();
  });

  it("describes every stored table, key and recipient", () => {
    renderWithProviders(<PrivacyScreen />);
    for (const t of SERVER_TABLES) {
      expect(screen.getByText(t.what, { exact: false })).toBeInTheDocument();
    }
    for (const k of BROWSER_KEYS) {
      expect(screen.getByText(k.key)).toBeInTheDocument();
    }
    for (const r of RECIPIENTS) {
      expect(screen.getByText(r.name)).toBeInTheDocument();
    }
  });

  it("links the contact URL in a new tab", () => {
    renderWithProviders(<PrivacyScreen />);
    const link = screen.getByRole("link", { name: PRIVACY_CONTACT_URL });
    expect(link).toHaveAttribute("href", PRIVACY_CONTACT_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("states what we do not do", () => {
    renderWithProviders(<PrivacyScreen />);
    expect(screen.getByText(/No cookies/)).toBeInTheDocument();
    expect(screen.getByText(/No analytics/)).toBeInTheDocument();
    expect(screen.getByText(/No advertising/)).toBeInTheDocument();
  });

  it("explains how to delete data", () => {
    renderWithProviders(<PrivacyScreen />);
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
    expect(screen.getAllByText(/Cloud save/).length).toBeGreaterThan(0);
  });

  it("has a valid https contact URL", () => {
    const url = new URL(PRIVACY_CONTACT_URL);
    expect(url.protocol).toBe("https:");
    expect(url.pathname.length).toBeGreaterThan(1);
  });
});
