import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Outcome = "accepted" | "dismissed";

function fakePromptEvent(outcome: Outcome = "accepted") {
  const e = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { e, prompt };
}

async function load() {
  vi.resetModules();
  const store = await import("./installStore");
  const hook = await import("./useInstallPrompt");
  return { ...store, ...hook };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("install capture", () => {
  it("is unavailable with no stashed event", async () => {
    const m = await load();
    m.startInstallCapture();
    expect(await m.install()).toBe("unavailable");
  });

  it("captures the event before any hook mounts and prevents default", async () => {
    const m = await load();
    m.startInstallCapture();
    const { e } = fakePromptEvent();
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const { result } = renderHook(() => m.useInstallPrompt());
    expect(result.current.canInstall).toBe(true);
  });

  it("registers listeners only once", async () => {
    const m = await load();
    const add = vi.spyOn(window, "addEventListener");
    m.startInstallCapture();
    m.startInstallCapture();
    const names: string[] = add.mock.calls.map((c) => String(c[0]));
    expect(names.filter((n) => n === "beforeinstallprompt")).toHaveLength(1);
    expect(names.filter((n) => n === "appinstalled")).toHaveLength(1);
  });

  it.each(["accepted", "dismissed"] as const)(
    "install returns %s and clears the stash",
    async (outcome) => {
      const m = await load();
      m.startInstallCapture();
      const { e, prompt } = fakePromptEvent(outcome);
      window.dispatchEvent(e);
      const { result } = renderHook(() => m.useInstallPrompt());
      let res: string | undefined;
      await act(async () => {
        res = await result.current.install();
      });
      expect(res).toBe(outcome);
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(result.current.canInstall).toBe(false);
      expect(await m.install()).toBe("unavailable");
    },
  );

  it("appinstalled sets installed and clears canInstall", async () => {
    const m = await load();
    m.startInstallCapture();
    window.dispatchEvent(fakePromptEvent().e);
    const { result } = renderHook(() => m.useInstallPrompt());
    expect(result.current.canInstall).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current).toMatchObject({
      canInstall: false,
      installed: true,
    });
    expect(await m.install()).toBe("unavailable");
  });

  it("keeps a stable snapshot and stops notifying after unsubscribe", async () => {
    const m = await load();
    m.startInstallCapture();
    const before = m.getInstallSnapshot();
    expect(m.getInstallSnapshot()).toBe(before);
    const fn = vi.fn();
    const off = m.subscribeInstall(fn);
    window.dispatchEvent(fakePromptEvent().e);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new Event("appinstalled"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
