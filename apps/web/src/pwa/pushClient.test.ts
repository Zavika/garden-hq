import { describe, expect, it, vi } from "vitest";
import {
  currentSubscription,
  PushPermissionError,
  pushSupported,
  subscribeThisDevice,
  unsubscribeThisDevice,
  urlBase64ToUint8Array,
  type PushBrowser,
} from "./pushClient";

function browser(over: Partial<PushBrowser> = {}) {
  const sub = {
    endpoint: "https://push.example/abc",
    toJSON: () => ({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  const manager = {
    getSubscription: vi.fn(() => Promise.resolve(null as typeof sub | null)),
    subscribe: vi.fn(() => Promise.resolve(sub)),
  };
  const b = {
    permission: vi.fn(() => "default" as NotificationPermission),
    requestPermission: vi.fn(() =>
      Promise.resolve("granted" as NotificationPermission),
    ),
    registration: vi.fn(() => Promise.resolve({ pushManager: manager })),
    ...over,
  } as unknown as PushBrowser;
  return { b, sub, manager };
}

describe("urlBase64ToUint8Array", () => {
  it("decodes url-safe base64 with - and _ and no padding", () => {
    // bytes 0xfb 0xff 0xbf -> "+/+/" standard, "-_-_" url-safe
    expect(Array.from(urlBase64ToUint8Array("-_-_"))).toEqual([
      0xfb, 0xff, 0xbf,
    ]);
  });
  it("handles all padding cases", () => {
    expect(Array.from(urlBase64ToUint8Array("AQ"))).toEqual([1]);
    expect(Array.from(urlBase64ToUint8Array("AQI"))).toEqual([1, 2]);
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("AQID="))).toEqual([1, 2, 3]);
  });
});

describe("pushSupported", () => {
  it("requires service worker, PushManager and Notification", () => {
    expect(
      pushSupported({
        serviceWorker: true,
        pushManager: true,
        notification: true,
      }),
    ).toBe(true);
    expect(
      pushSupported({
        serviceWorker: true,
        pushManager: false,
        notification: true,
      }),
    ).toBe(false);
  });
});

describe("subscribeThisDevice", () => {
  it("requests permission once and subscribes with the key", async () => {
    const { b, manager } = browser();
    const json = await subscribeThisDevice("AQID", b);
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    const arg = (
      manager.subscribe.mock.calls[0] as unknown as [
        { userVisibleOnly: boolean; applicationServerKey: Uint8Array },
      ]
    )[0];
    expect(arg.userVisibleOnly).toBe(true);
    expect(Array.from(arg.applicationServerKey)).toEqual([1, 2, 3]);
    expect(json.endpoint).toBe("https://push.example/abc");
  });

  it("does not re-request when already granted", async () => {
    const { b } = browser({
      permission: vi.fn(() => "granted" as NotificationPermission),
    });
    await subscribeThisDevice("AQID", b);
    expect(b.requestPermission).not.toHaveBeenCalled();
  });

  it("rejects with a typed error when permission is denied", async () => {
    const { b, manager } = browser({
      requestPermission: vi.fn(() =>
        Promise.resolve("denied" as NotificationPermission),
      ),
    });
    await expect(subscribeThisDevice("AQID", b)).rejects.toBeInstanceOf(
      PushPermissionError,
    );
    expect(manager.subscribe).not.toHaveBeenCalled();
  });
});

describe("currentSubscription / unsubscribeThisDevice", () => {
  it("returns the existing subscription", async () => {
    const { b, manager, sub } = browser();
    manager.getSubscription.mockResolvedValue(sub);
    expect(await currentSubscription(b)).toBe(sub);
  });

  it("unsubscribes and returns the endpoint", async () => {
    const { b, manager, sub } = browser();
    manager.getSubscription.mockResolvedValue(sub);
    expect(await unsubscribeThisDevice(b)).toBe("https://push.example/abc");
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it("returns null when there is nothing to unsubscribe", async () => {
    const { b } = browser();
    expect(await unsubscribeThisDevice(b)).toBeNull();
  });
});
