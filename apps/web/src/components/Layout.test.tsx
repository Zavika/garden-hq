import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { SettingsScreen } from "../screens/SettingsScreen";
import { Layout } from "./Layout";

vi.mock("../state/queries", () => ({
  useContests: () => ({ data: undefined }),
}));

function linkedStorage() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u",
    profileId: "p1",
    profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  });
  return storage;
}

function routes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<p>HOME</p>} />
        <Route path="/link" element={<p>LINK</p>} />
        <Route path="/settings" element={<p>SETTINGS</p>} />
      </Route>
    </Routes>
  );
}

describe("Layout with the real SettingsScreen", () => {
  it("renders Settings (cloud save join) for an unlinked user without redirecting", () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/link" element={<p>LINK</p>} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Route>
      </Routes>,
      { route: "/settings" },
    );
    expect(screen.queryByText("LINK")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /cloud save/i }),
    ).toBeInTheDocument();
  });
});

describe("Layout", () => {
  it("redirects an unlinked user at / to /link", () => {
    renderWithProviders(routes(), { route: "/" });
    expect(screen.getByText("LINK")).toBeInTheDocument();
    expect(screen.queryByText("HOME")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("does not redirect /settings for an unlinked user (restore from a code)", () => {
    renderWithProviders(routes(), { route: "/settings" });
    expect(screen.getByText("SETTINGS")).toBeInTheDocument();
    expect(screen.queryByText("LINK")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("hides the tab bar on /link for a linked user", () => {
    renderWithProviders(routes(), { route: "/link", storage: linkedStorage() });
    expect(screen.getByText("LINK")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("shows the tab bar for a linked user at /", () => {
    renderWithProviders(routes(), { route: "/", storage: linkedStorage() });
    expect(screen.getByText("HOME")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });
});
