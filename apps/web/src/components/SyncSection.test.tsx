import { formatSyncCode } from "@garden-hq/core";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { createGardenStorage } from "../state/storage";
import type { SyncEngine, SyncSnapshot } from "../state/sync";
import { renderWithProviders } from "../test/renderWithProviders";
import { SyncSection } from "./SyncSection";

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const FORMATTED = formatSyncCode(CODE);

function fakeEngine(initial: Partial<SyncSnapshot> = {}) {
  let snap: SyncSnapshot = {
    code: null,
    status: "signed_out",
    pending: 0,
    syncedAt: null,
    summary: null,
    error: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const engine = {
    storage: createGardenStorage(null),
    getSnapshot: () => snap,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    enableWithNewAccount: vi.fn(() => Promise.resolve()),
    joinWithCode: vi.fn<(raw: string) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    flush: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(),
    deleteCloud: vi.fn(() => Promise.resolve()),
    start: vi.fn(() => () => undefined),
  };
  const set = (patch: Partial<SyncSnapshot>) => {
    act(() => {
      snap = { ...snap, ...patch };
      listeners.forEach((l) => l());
    });
  };
  return { engine: engine as unknown as SyncEngine, mock: engine, set };
}

function linked() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u1",
    profileId: "p1",
    profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SyncSection signed out", () => {
  it("linked: saves to cloud via a new account", async () => {
    const { engine, mock } = fakeEngine();
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    expect(screen.getByLabelText(/i already have a code/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use code" })).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Save to cloud" }),
    );
    expect(mock.enableWithNewAccount).toHaveBeenCalledTimes(1);
  });

  it("not linked: Save to cloud is disabled with a hint", () => {
    const { engine } = fakeEngine();
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(
      screen.getByRole("button", { name: "Save to cloud" }),
    ).toBeDisabled();
    expect(screen.getByText("Link a Minecraft name first")).toBeInTheDocument();
  });

  it("shows an enable error inline without crashing", async () => {
    const { engine, mock } = fakeEngine();
    mock.enableWithNewAccount.mockRejectedValueOnce(
      new ApiError("network", 0, "x"),
    );
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Save to cloud" }),
    );
    expect(
      await screen.findByText(
        "Can't reach the server. Try again when you're online.",
      ),
    ).toBeInTheDocument();
  });

  it("rejects an invalid pasted code without calling the engine", async () => {
    const { engine, mock } = fakeEngine();
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.type(
      screen.getByLabelText(/i already have a code/i),
      "nope",
    );
    await userEvent.click(screen.getByRole("button", { name: "Use code" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/not a valid code/i);
    expect(mock.joinWithCode).not.toHaveBeenCalled();
  });

  it("joins with a valid code", async () => {
    const { engine, mock } = fakeEngine();
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.type(
      screen.getByLabelText(/i already have a code/i),
      FORMATTED,
    );
    await userEvent.click(screen.getByRole("button", { name: "Use code" }));
    expect(mock.joinWithCode).toHaveBeenCalledWith(FORMATTED);
  });

  it("maps unauthorized and rate_limited join errors", async () => {
    const { engine, mock } = fakeEngine();
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.type(
      screen.getByLabelText(/i already have a code/i),
      FORMATTED,
    );
    mock.joinWithCode.mockRejectedValueOnce(
      new ApiError("unauthorized", 401, "x"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Use code" }));
    expect(
      await screen.findByText("That code was not recognised."),
    ).toBeInTheDocument();
    mock.joinWithCode.mockRejectedValueOnce(
      new ApiError("rate_limited", 429, "x", 42),
    );
    await userEvent.click(screen.getByRole("button", { name: "Use code" }));
    expect(await screen.findByText(/42s/)).toBeInTheDocument();
  });

  it("disables the buttons while an action is running", async () => {
    const { engine, mock } = fakeEngine();
    let resolve: () => void = () => undefined;
    mock.enableWithNewAccount.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Save to cloud" }),
    );
    expect(
      screen.getByRole("button", { name: "Save to cloud" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use code" })).toBeDisabled();
    await act(async () => {
      resolve();
    });
    expect(screen.getByRole("button", { name: "Save to cloud" })).toBeEnabled();
  });
});

describe("SyncSection signed in", () => {
  it("masks the code, reveals it, copies the formatted code", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    const { container } = renderWithProviders(<SyncSection />, {
      storage: linked(),
      sync: engine,
    });
    expect(container.innerHTML).not.toContain(CODE.slice(0, 8));
    expect(container.innerHTML).not.toContain(FORMATTED.slice(0, 9));
    expect(container.textContent).toContain("••••-••••-");
    expect(
      screen.getByText(
        "Save this somewhere safe. It is the only way to restore your data on another device or after clearing your browser. We cannot recover it.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(container.innerHTML).not.toContain(FORMATTED.slice(0, 9));

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(FORMATTED);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("shows the last synced time and pending count", () => {
    const { engine } = fakeEngine({
      code: CODE,
      status: "idle",
      syncedAt: Date.now() - 5 * 60_000,
      pending: 2,
    });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(screen.getByText(/Last synced 5 min ago/)).toBeInTheDocument();
    expect(screen.getByText("2 changes waiting to sync")).toBeInTheDocument();
  });

  it("singular pending", () => {
    const { engine } = fakeEngine({ code: CODE, status: "idle", pending: 1 });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(screen.getByText("1 change waiting to sync")).toBeInTheDocument();
  });

  it("offline: message and Try again now flushes", async () => {
    const { engine, mock } = fakeEngine({ code: CODE, status: "offline" });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(
      screen.getByText(
        "Offline — changes are saved on this device and will sync later.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Try again now" }),
    );
    expect(mock.flush).toHaveBeenCalledTimes(1);
  });

  it("error: shows the text and a retry button", () => {
    const { engine } = fakeEngine({
      code: CODE,
      status: "error",
      error: "Boom happened",
    });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(screen.getByText("Boom happened")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again now" }),
    ).toBeInTheDocument();
  });

  it("no retry button when idle", () => {
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(screen.queryByRole("button", { name: "Try again now" })).toBeNull();
  });

  it("unauthorized: message and prominent forget button, no confirm", async () => {
    const { engine, mock } = fakeEngine({ code: CODE, status: "unauthorized" });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(
      screen.getByText(
        "This code was not recognised. Forget the sync code on this device, then enter your code again.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    );
    expect(mock.signOut).toHaveBeenCalledTimes(1);
  });

  it("forget asks for confirmation; Cancel aborts, Yes signs out once", async () => {
    const { engine, mock } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    );
    expect(mock.signOut).not.toHaveBeenCalled();
    const text =
      "Forget the sync code on this device? Your data stays on this device and in the cloud, but you will need the code to sync again. Make sure you have saved it.";
    const confirmEl = screen.getByText(text);
    expect(confirmEl.textContent).not.toContain(FORMATTED);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(screen.queryByText(text)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, forget" }));
    expect(mock.signOut).toHaveBeenCalledTimes(1);
  });

  it("the confirm text never contains the masked code", async () => {
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    const { container } = renderWithProviders(<SyncSection />, {
      sync: engine,
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    );
    expect(container.textContent).not.toContain(FORMATTED);
    expect(container.textContent).not.toContain(CODE);
  });

  it("there is no separate sign out button", () => {
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("shows the join summary with correct plurals", () => {
    const { engine, set } = fakeEngine({
      code: CODE,
      status: "idle",
      summary: { added: 3, kept: 1 },
    });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(
      screen.getByText(
        "Added 3 items from this device; kept the cloud version for 1.",
      ),
    ).toBeInTheDocument();
    set({ summary: { added: 1, kept: 2 } });
    expect(
      screen.getByText(
        "Added 1 item from this device; kept the cloud version for 2.",
      ),
    ).toBeInTheDocument();
  });

  it("deleting needs a confirming click", async () => {
    const { engine, mock } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Delete cloud data" }),
    );
    expect(mock.deleteCloud).not.toHaveBeenCalled();
    expect(
      screen.getByText("Really delete cloud data? This cannot be undone."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(mock.deleteCloud).toHaveBeenCalledTimes(1);
  });
});

describe("SyncSection fix round", () => {
  const NOT_COPIED = "Could not copy — select the code and copy it manually.";

  it("clipboard missing: no Copied, failure message, code revealed", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.getByText(NOT_COPIED)).toBeInTheDocument();
    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
  });

  it("clipboard rejects: no Copied, failure message, code revealed", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.queryByText("Copied")).toBeNull();
    expect(screen.getByText(NOT_COPIED)).toBeInTheDocument();
    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
  });

  it("clipboard resolves: Copied and formatted code written", async () => {
    const writeText = vi.fn<(t: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(FORMATTED);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(screen.queryByText(NOT_COPIED)).toBeNull();
  });

  it("a new code is masked after reveal -> sign out -> save again", async () => {
    const { engine, mock, set } = fakeEngine({ code: CODE, status: "idle" });
    mock.signOut.mockImplementation(() =>
      set({ code: null, status: "signed_out" }),
    );
    mock.enableWithNewAccount.mockImplementation(() => {
      set({ code: CODE, status: "idle" });
      return Promise.resolve();
    });
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, forget" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Save to cloud" }),
    );
    expect(screen.queryByText(FORMATTED)).toBeNull();
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });

  it("failed delete (code kept) shows an explicit message", async () => {
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Delete cloud data" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(
      await screen.findByText(
        "Couldn't delete the cloud copy. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    ).toBeInTheDocument();
  });

  it("successful delete shows no failure message", async () => {
    const { engine, mock, set } = fakeEngine({ code: CODE, status: "idle" });
    mock.deleteCloud.mockImplementation(() => {
      set({ code: null, status: "signed_out" });
      return Promise.resolve();
    });
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Delete cloud data" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(screen.queryByText(/Couldn't delete/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save to cloud" })).toBeEnabled();
  });

  it("live regions stay mounted", () => {
    const { engine } = fakeEngine({ code: CODE, status: "idle" });
    renderWithProviders(<SyncSection />, { sync: engine });
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(2);
  });

  it("Forget, Delete and Try again are disabled while busy", async () => {
    const { engine, mock } = fakeEngine({ code: CODE, status: "offline" });
    let resolve: () => void = () => undefined;
    mock.deleteCloud.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    renderWithProviders(<SyncSection />, { sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Delete cloud data" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(
      screen.getByRole("button", { name: "Forget sync code on this device" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Delete cloud data" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Try again now" }),
    ).toBeDisabled();
    await act(async () => {
      resolve();
    });
  });

  it("inline error clears on the next attempt", async () => {
    const { engine, mock } = fakeEngine();
    mock.enableWithNewAccount.mockRejectedValueOnce(
      new ApiError("network", 0, "x"),
    );
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.click(
      screen.getByRole("button", { name: "Save to cloud" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Save to cloud" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("join summary appears through the real join flow", async () => {
    const { engine, mock, set } = fakeEngine();
    mock.joinWithCode.mockImplementation(() => {
      set({ code: CODE, status: "idle", summary: { added: 1, kept: 0 } });
      return Promise.resolve();
    });
    renderWithProviders(<SyncSection />, { storage: linked(), sync: engine });
    await userEvent.type(
      screen.getByLabelText(/i already have a code/i),
      FORMATTED,
    );
    await userEvent.click(screen.getByRole("button", { name: "Use code" }));
    expect(
      await screen.findByText(
        "Added 1 item from this device; kept the cloud version for 0.",
      ),
    ).toBeInTheDocument();
  });
});
