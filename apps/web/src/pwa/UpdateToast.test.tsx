import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  let state = { needRefresh: false, offlineReady: false };
  const subs = new Set<() => void>();
  return {
    applyUpdate: vi.fn(() => Promise.resolve()),
    dismissPwa: vi.fn(),
    getPwaState: () => state,
    subscribePwa: (fn: () => void) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(next: { needRefresh: boolean; offlineReady: boolean }) {
      state = next;
      subs.forEach((f) => f());
    },
  };
});

vi.mock("./register", () => store);

import { UpdateToast } from "./UpdateToast";

describe("UpdateToast", () => {
  beforeEach(() => {
    store.applyUpdate.mockClear();
    store.dismissPwa.mockClear();
    act(() => store.set({ needRefresh: false, offlineReady: false }));
  });

  it("renders nothing by default", () => {
    const { container } = render(<UpdateToast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Reload and Later when an update is waiting", async () => {
    render(<UpdateToast />);
    act(() => store.set({ needRefresh: true, offlineReady: false }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "New version available",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(store.applyUpdate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(store.dismissPwa).toHaveBeenCalledTimes(1);
  });

  it("announces offline readiness with a dismiss", async () => {
    render(<UpdateToast />);
    act(() => store.set({ needRefresh: false, offlineReady: true }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ready to work offline",
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(store.dismissPwa).toHaveBeenCalledTimes(1);
  });
});
