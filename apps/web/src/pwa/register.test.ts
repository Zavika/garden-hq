import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sw = vi.hoisted(() => ({
  updateSW: vi.fn(() => Promise.resolve()),
  registerSW: vi.fn(),
}));

vi.mock("virtual:pwa-register", () => ({
  registerSW: (opts: unknown) => {
    sw.registerSW(opts);
    return sw.updateSW;
  },
}));

interface Opts {
  onNeedRefresh: () => void;
  onOfflineReady: () => void;
}

async function load() {
  vi.resetModules();
  return import("./register");
}

beforeEach(() => {
  // jsdom has no serviceWorker; registerPwa requires it.
  vi.stubGlobal("navigator", { ...navigator, serviceWorker: {} });
  sw.updateSW.mockClear();
  sw.registerSW.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("register store", () => {
  it("starts with both flags false", async () => {
    const r = await load();
    expect(r.getPwaState()).toEqual({
      needRefresh: false,
      offlineReady: false,
    });
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    vi.stubEnv("PROD", true);
    const r = await load();
    const fn = vi.fn();
    const off = r.subscribePwa(fn);
    r.registerPwa();
    const opts = sw.registerSW.mock.calls[0]?.[0] as Opts;
    opts.onNeedRefresh();
    expect(fn).toHaveBeenLastCalledWith({
      needRefresh: true,
      offlineReady: false,
    });
    off();
    opts.onOfflineReady();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.getPwaState()).toEqual({ needRefresh: true, offlineReady: true });
  });

  it("dismissPwa resets both flags", async () => {
    vi.stubEnv("PROD", true);
    const r = await load();
    r.registerPwa();
    const opts = sw.registerSW.mock.calls[0]?.[0] as Opts;
    opts.onNeedRefresh();
    opts.onOfflineReady();
    r.dismissPwa();
    expect(r.getPwaState()).toEqual({
      needRefresh: false,
      offlineReady: false,
    });
  });

  it("registerPwa does nothing when not PROD", async () => {
    vi.stubEnv("PROD", false);
    const r = await load();
    r.registerPwa();
    expect(sw.registerSW).not.toHaveBeenCalled();
  });

  it("applyUpdate calls updateSW(true) after registering", async () => {
    vi.stubEnv("PROD", true);
    const r = await load();
    r.registerPwa();
    await r.applyUpdate();
    expect(sw.updateSW).toHaveBeenCalledWith(true);
  });

  it("applyUpdate is a no-op before registration", async () => {
    const r = await load();
    await r.applyUpdate();
    expect(sw.updateSW).not.toHaveBeenCalled();
  });
});
