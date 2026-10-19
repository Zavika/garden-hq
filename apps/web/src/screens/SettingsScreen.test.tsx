import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { SettingsScreen } from "./SettingsScreen";

function linkedStorage() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u1",
    profileId: "p1",
    profiles: [
      { profileId: "p1", name: "Apple", selected: true },
      { profileId: "p2", name: "Banana", selected: false },
    ],
  });
  return storage;
}

describe("SettingsScreen", () => {
  it("changes the time zone", async () => {
    const storage = linkedStorage();
    renderWithProviders(<SettingsScreen />, { storage });
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), "UTC");
    expect(storage.getSnapshot().timeZone).toBe("UTC");
  });

  it("switches profile", async () => {
    const storage = linkedStorage();
    renderWithProviders(<SettingsScreen />, { storage });
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), "p2");
    expect(storage.getSnapshot().link?.profileId).toBe("p2");
  });

  it("clears local data", async () => {
    const storage = linkedStorage();
    storage.setAssignment("beginner_1", "wheat");
    renderWithProviders(<SettingsScreen />, { storage });
    await userEvent.click(
      screen.getByRole("button", { name: /clear local data/i }),
    );
    expect(storage.getSnapshot().link).toBeNull();
    expect(storage.getSnapshot().assignments).toEqual({});
  });

  it("clearing local data leaves the cloud copy alone", async () => {
    const storage = linkedStorage();
    const { sync } = renderWithProviders(<SettingsScreen />, { storage });
    const deleteCloud = vi.spyOn(sync, "deleteCloud");
    expect(
      screen.getByText(
        "Clears this device only. Your cloud copy stays and reloads on next sync.",
      ),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: /clear local data/i }),
    );
    expect(deleteCloud).not.toHaveBeenCalled();
  });

  it("shows the Cloud save section", () => {
    renderWithProviders(<SettingsScreen />, { storage: linkedStorage() });
    expect(
      screen.getByRole("heading", { name: "Cloud save" }),
    ).toBeInTheDocument();
  });
});
