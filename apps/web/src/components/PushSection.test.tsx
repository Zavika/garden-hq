import type { AlertsStateResponse } from "@garden-hq/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type PushApi } from "../api/client";
import { IOS_PUSH_NOTE, type PlatformEnv } from "../pwa/platform";
import {
  NoServiceWorkerError,
  type PushBrowser,
  type PushSupportEnv,
} from "../pwa/pushClient";
import { PushSection } from "./PushSection";

const pwa = vi.hoisted(() => ({
  state: { needRefresh: false, offlineReady: false },
  applyUpdate: vi.fn(() => Promise.resolve()),
}));
vi.mock("../pwa/register", () => ({
  getPwaState: () => pwa.state,
  subscribePwa: () => () => undefined,
  applyUpdate: pwa.applyUpdate,
}));

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
type Push = AlertsStateResponse["push"];
const ON: Push = {
  available: true,
  publicKey: "AQID",
  devices: 0,
  pushOk: null,
};

const DESKTOP: PlatformEnv = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
  platform: "Win32",
  maxTouchPoints: 0,
  displayModeStandalone: false,
};
const IPHONE: PlatformEnv = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari",
  platform: "iPhone",
  maxTouchPoints: 5,
  displayModeStandalone: false,
};
const FULL: PushSupportEnv = {
  serviceWorker: true,
  pushManager: true,
  notification: true,
};

function state(push: Push): AlertsStateResponse {
  return {
    hasWebhook: false,
    webhookLast4: null,
    webhookOk: null,
    rules: null,
    push,
  };
}

function setup(
  over: {
    push?: Push;
    env?: PlatformEnv;
    support?: PushSupportEnv;
    permission?: NotificationPermission;
    existing?: boolean;
    testResult?: "sent" | "failed" | "dead";
    putFails?: boolean;
    noSw?: boolean;
  } = {},
) {
  const push = over.push ?? ON;
  const sub = {
    endpoint: "https://push.example/abc",
    toJSON: () => ({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  let current: typeof sub | null = over.existing ? sub : null;
  const manager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn(() => {
      current = sub;
      return Promise.resolve(sub);
    }),
  };
  let permission: NotificationPermission = over.permission ?? "default";
  const browser = {
    permission: vi.fn(() => permission),
    requestPermission: vi.fn(() => {
      permission = "granted";
      return Promise.resolve(permission);
    }),
    registration: vi.fn(() =>
      over.noSw
        ? Promise.reject(new NoServiceWorkerError())
        : Promise.resolve({ pushManager: manager }),
    ),
  } as unknown as PushBrowser;
  const client = {
    putPush: vi.fn(() =>
      over.putFails
        ? Promise.reject(new ApiError("network", 0, "x"))
        : Promise.resolve(state({ ...push, devices: 1, pushOk: null })),
    ),
    // The real DELETE answers 204 with no body.
    deletePush: vi.fn(() => Promise.resolve()),
    getAlerts: vi.fn(() => Promise.resolve(state({ ...push, devices: 0 }))),
    testPush: vi.fn(() =>
      Promise.resolve({
        ...state({ ...push, devices: 1, pushOk: true }),
        test: over.testResult ?? ("sent" as const),
      }),
    ),
  } as unknown as PushApi & { [K in keyof PushApi]: ReturnType<typeof vi.fn> };
  const onState = vi.fn();
  const view = render(
    <PushSection
      code={CODE}
      push={push}
      client={client}
      onState={onState}
      env={over.env ?? DESKTOP}
      supportEnv={over.support ?? FULL}
      browser={browser}
    />,
  );
  return { browser, client, onState, sub, manager, view };
}

describe("PushSection", () => {
  it("says push isn't set up when the server has no keys", () => {
    setup({
      push: { available: false, publicKey: null, devices: 0, pushOk: null },
    });
    expect(
      screen.getByText("Push alerts aren't set up on this server yet."),
    ).toBeInTheDocument();
  });

  it("explains an unsupported browser", () => {
    setup({ support: { ...FULL, pushManager: false } });
    expect(
      screen.getByText("This browser doesn't support push notifications."),
    ).toBeInTheDocument();
  });

  it("tells iPhone Safari users to add to Home Screen first", () => {
    const { browser, client } = setup({
      env: IPHONE,
      support: { serviceWorker: true, pushManager: false, notification: false },
    });
    expect(screen.getByText("Add to Home Screen first")).toBeInTheDocument();
    expect(screen.getByText(IOS_PUSH_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/install section above/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /turn on push/i }),
    ).not.toBeInTheDocument();
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(client.putPush).not.toHaveBeenCalled();
  });

  it("shows the blocked message when permission is denied", () => {
    setup({ permission: "denied" });
    expect(
      screen.getByText(
        "Notifications are blocked for this site. Allow them in your browser or system settings, then try again.",
      ),
    ).toBeInTheDocument();
  });

  it("never requests permission on mount; only after the click", async () => {
    const { browser, client, onState, manager } = setup();
    const button = await screen.findByRole("button", {
      name: "Turn on push on this device",
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(browser.requestPermission).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(manager.subscribe).toHaveBeenCalled();
    expect(client.putPush).toHaveBeenCalledWith(CODE, {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(onState).toHaveBeenCalled();
    expect(
      await screen.findByText("Push is on for this device"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/press send test notification/i),
    ).toBeInTheDocument();
  });

  it("shows blocked when the player refuses the prompt", async () => {
    const { browser } = setup();
    (browser.requestPermission as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        (browser.permission as ReturnType<typeof vi.fn>).mockReturnValue(
          "denied",
        );
        return Promise.resolve("denied");
      },
    );
    const button = await screen.findByRole("button", {
      name: "Turn on push on this device",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(
      await screen.findByText(/notifications are blocked/i),
    ).toBeInTheDocument();
  });

  it("silently re-registers an existing subscription on mount without prompting", async () => {
    const { browser, client } = setup({
      existing: true,
      permission: "granted",
      push: { ...ON, devices: 1, pushOk: true },
    });
    await waitFor(() => expect(client.putPush).toHaveBeenCalledTimes(1));
    expect(browser.requestPermission).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Push is on for this device"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 device will get alerts")).toBeInTheDocument();
  });

  it("sends a test notification and reports the outcome", async () => {
    const { client, onState } = setup({
      existing: true,
      permission: "granted",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Send test notification" }),
    );
    expect(client.testPush).toHaveBeenCalledWith(CODE);
    expect(onState).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ test: expect.anything() }),
    );
    expect(
      await screen.findByText(/test notification sent/i),
    ).toBeInTheDocument();
  });

  it("reports a failed test", async () => {
    setup({ existing: true, permission: "granted", testResult: "failed" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Send test notification" }),
    );
    expect(await screen.findByText(/couldn't send/i)).toBeInTheDocument();
  });

  it("reports a dead registration and offers to turn on again", async () => {
    const { sub } = setup({
      existing: true,
      permission: "granted",
      testResult: "dead",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Send test notification" }),
    );
    expect(
      await screen.findByText(/registration has expired/i),
    ).toBeInTheDocument();
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(
      await screen.findByRole("button", {
        name: "Turn on push on this device",
      }),
    ).toBeInTheDocument();
  });

  it("turning off deletes the endpoint server-side", async () => {
    const { client, sub, onState } = setup({
      existing: true,
      permission: "granted",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Turn off" }),
    );
    await waitFor(() => expect(client.getAlerts).toHaveBeenCalledWith(CODE));
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({ devices: 0 }),
      }),
    );
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(client.deletePush).toHaveBeenCalledWith(
      CODE,
      "https://push.example/abc",
    );
    expect(
      await screen.findByRole("button", {
        name: "Turn on push on this device",
      }),
    ).toBeInTheDocument();
  });

  it("unsubscribes locally and shows the error when the server save fails", async () => {
    const { sub } = setup({ putFails: true });
    const button = await screen.findByRole("button", {
      name: "Turn on push on this device",
    });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(
      await screen.findByText(/can't reach the server/i),
    ).toBeInTheDocument();
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Turn on push on this device" }),
    ).toBeInTheDocument();
  });

  it("shows blocked with a Turn off button when permission is revoked but a subscription lingers", async () => {
    const { client } = setup({ existing: true, permission: "denied" });
    expect(screen.getByText(/notifications are blocked/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Push is on for this device"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: "Turn off" }),
    );
    await waitFor(() => expect(client.deletePush).toHaveBeenCalled());
  });

  it("explains a missing service worker instead of a dead button", async () => {
    setup({ noSw: true });
    expect(
      await screen.findByText(/needs the installed app or a production build/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /turn on push/i }),
    ).not.toBeInTheDocument();
  });

  it("asks for a reload first while an update is waiting", async () => {
    pwa.state = { needRefresh: true, offlineReady: false };
    try {
      setup();
      expect(screen.getByText("Reload to update first")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /turn on push/i }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(pwa.applyUpdate).toHaveBeenCalled();
    } finally {
      pwa.state = { needRefresh: false, offlineReady: false };
    }
  });
});
