import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import { renderWithProviders } from "../test/renderWithProviders";
import { LinkScreen } from "./LinkScreen";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, link: vi.fn() } };
});

const link = vi.mocked(api.link);

function renderLink() {
  return renderWithProviders(
    <Routes>
      <Route path="/link" element={<LinkScreen />} />
      <Route path="/" element={<p>HOME</p>} />
      <Route path="/settings" element={<p>SETTINGS</p>} />
    </Routes>,
    { route: "/link" },
  );
}

const ONE = {
  uuid: "u1",
  name: "Steve",
  profileId: "p1",
  profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  fetchedAt: "2026-10-05T10:00:00.000Z",
};

describe("LinkScreen", () => {
  beforeEach(() => {
    link.mockReset();
  });

  it("offers a way to restore from a sync code", async () => {
    renderLink();
    await userEvent.click(
      screen.getByRole("link", { name: /restore from a sync code/i }),
    );
    expect(await screen.findByText("SETTINGS")).toBeInTheDocument();
  });

  it("links a single-profile player, stores the link and goes home", async () => {
    link.mockResolvedValue(ONE);
    const { storage } = renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));
    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(storage.getSnapshot().link).toMatchObject({
      uuid: "u1",
      profileId: "p1",
    });
    expect(link).toHaveBeenCalledWith("Steve");
  });

  it("shows a picker for several profiles with the selected one preselected", async () => {
    link.mockResolvedValue({
      ...ONE,
      profileId: "p2",
      profiles: [
        { profileId: "p1", name: "Apple", selected: false },
        { profileId: "p2", name: "Banana", selected: true },
      ],
    });
    const { storage } = renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));

    const banana = await screen.findByRole("radio", { name: /banana/i });
    expect(banana).toBeChecked();
    expect(storage.getSnapshot().link).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: /apple/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(storage.getSnapshot().link?.profileId).toBe("p1");
  });

  it.each([
    [new ApiError("bad_request", 400, "x"), /valid minecraft username/i],
    [new ApiError("unknown_player", 404, "x"), /couldn.t find that player/i],
    [new ApiError("no_garden", 404, "x"), /no skyblock garden/i],
    [new ApiError("not_found", 404, "x"), /couldn.t find that player/i],
    [new ApiError("internal", 500, "x"), /something went wrong on our side/i],
    [
      new ApiError("bad_response", 502, "x"),
      /something went wrong on our side/i,
    ],
    [new ApiError("upstream_down", 502, "x"), /hypixel is unavailable/i],
    [new ApiError("network", 0, "x"), /couldn.t reach the server/i],
    [new ApiError("rate_limited", 429, "x", 30), /too many requests.*30/i],
  ])("shows an inline error for %o", async (error, message) => {
    link.mockRejectedValue(error);
    renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(message),
    );
  });

  it("shows a developer hint for missing_api_key only in dev builds", async () => {
    link.mockRejectedValue(new ApiError("missing_api_key", 500, "x"));
    renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/temporarily unavailable/i);
    // vitest runs with import.meta.env.DEV === true
    expect(alert).toHaveTextContent(/HYPIXEL_API_KEY/);
  });
});
