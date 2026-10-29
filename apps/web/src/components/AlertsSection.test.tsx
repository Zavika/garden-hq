import { defaultAlertRules, type AlertsStateResponse } from "@garden-hq/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type AlertsApi } from "../api/client";
import { createGardenStorage } from "../state/storage";
import type { SyncEngine, SyncSnapshot } from "../state/sync";
import { renderWithProviders } from "../test/renderWithProviders";
import { AlertsSection } from "./AlertsSection";

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const EMPTY: AlertsStateResponse = {
  hasWebhook: false,
  webhookLast4: null,
  webhookOk: null,
  rules: null,
};
const UNTESTED: AlertsStateResponse = {
  ...EMPTY,
  hasWebhook: true,
  webhookLast4: "-123",
};
const VERIFIED: AlertsStateResponse = {
  ...UNTESTED,
  webhookOk: true,
  rules: defaultAlertRules(true),
};

function client(over: Partial<Record<keyof AlertsApi, unknown>> = {}) {
  return {
    getAlerts: vi.fn(() => Promise.resolve(EMPTY)),
    putWebhook: vi.fn(() => Promise.resolve(UNTESTED)),
    deleteWebhook: vi.fn(() => Promise.resolve()),
    testWebhook: vi.fn(() =>
      Promise.resolve({ ...VERIFIED, test: "sent" as const }),
    ),
    putRules: vi.fn(() => Promise.resolve(VERIFIED)),
    ...over,
  } as unknown as AlertsApi & {
    [K in keyof AlertsApi]: ReturnType<typeof vi.fn>;
  };
}

function fakeEngine(code: string | null): SyncEngine {
  const snap: SyncSnapshot = {
    code,
    status: code === null ? "signed_out" : "idle",
    pending: 0,
    syncedAt: null,
    summary: null,
    error: null,
  };
  return {
    storage: createGardenStorage(null),
    getSnapshot: () => snap,
    subscribe: () => () => undefined,
    start: () => () => undefined,
  } as unknown as SyncEngine;
}

function renderAlerts(c: AlertsApi, opts: { code: string | null }) {
  return renderWithProviders(<AlertsSection client={c} />, {
    sync: fakeEngine(opts.code),
  });
}

describe("AlertsSection", () => {
  it("asks the player to turn on Cloud save when signed out, and calls nothing", () => {
    const c = client();
    renderAlerts(c, { code: null });
    expect(screen.getByText(/turn on cloud save/i)).toBeInTheDocument();
    expect(c.getAlerts).not.toHaveBeenCalled();
  });

  it("shows the webhook form, saves it, and never shows the URL back", async () => {
    const c = client();
    renderAlerts(c, { code: CODE });
    await userEvent.type(
      await screen.findByLabelText(/discord webhook url/i),
      "https://discord.com/api/webhooks/1/abc",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save webhook/i }),
    );
    expect(c.putWebhook).toHaveBeenCalledWith(
      CODE,
      "https://discord.com/api/webhooks/1/abc",
    );
    expect(await screen.findByText(/ending in -123/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/discord\.com\/api\/webhooks/),
    ).not.toBeInTheDocument();
  });

  it("explains that an untested webhook sends nothing, and the test unlocks the rules", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(UNTESTED)) });
    renderAlerts(c, { code: CODE });
    expect(
      await screen.findByText(/send a test message to turn alerts on/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /send test message/i }),
    );
    expect(c.testWebhook).toHaveBeenCalledWith(CODE);
    expect(await screen.findAllByRole("checkbox")).toHaveLength(5);
  });

  it("reports a dead webhook and a failed test distinctly", async () => {
    const dead = client({
      getAlerts: vi.fn(() => Promise.resolve(UNTESTED)),
      testWebhook: vi.fn(() =>
        Promise.resolve({
          ...UNTESTED,
          webhookOk: false,
          test: "dead" as const,
        }),
      ),
    });
    const first = renderAlerts(dead, { code: CODE });
    await userEvent.click(
      await screen.findByRole("button", { name: /send test message/i }),
    );
    expect(
      (
        await screen.findAllByText(
          /discord says this webhook no longer exists/i,
        )
      ).length,
    ).toBeGreaterThanOrEqual(1);
    first.unmount();

    const failed = client({
      getAlerts: vi.fn(() => Promise.resolve(UNTESTED)),
      testWebhook: vi.fn(() =>
        Promise.resolve({ ...UNTESTED, test: "failed" as const }),
      ),
    });
    renderAlerts(failed, { code: CODE });
    await userEvent.click(
      await screen.findByRole("button", { name: /send test message/i }),
    );
    expect(
      await screen.findByText(/couldn't reach discord/i),
    ).toBeInTheDocument();
  });

  it("toggling a rule sends only that rule", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /jacob's contest/i }),
    );
    expect(c.putRules).toHaveBeenCalledWith(CODE, {
      contest_soon: { enabled: false },
    });
  });

  it("commits a threshold on blur, within bounds", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    const lead = await screen.findByLabelText(
      /contest.*minutes before it starts/i,
    );
    await userEvent.clear(lead);
    await userEvent.type(lead, "10");
    await userEvent.tab();
    expect(c.putRules).toHaveBeenCalledWith(CODE, {
      contest_soon: { leadMinutes: 10 },
    });
  });

  it("does not send an out-of-range threshold", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    const lead = await screen.findByLabelText(
      /contest.*minutes before it starts/i,
    );
    await userEvent.clear(lead);
    await userEvent.type(lead, "0");
    await userEvent.tab();
    expect(c.putRules).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/enter a whole number from 5 to 120/i),
    ).toBeInTheDocument();
  });

  it("removing the webhook asks for confirmation first", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    await userEvent.click(
      await screen.findByRole("button", { name: /remove webhook/i }),
    );
    expect(c.deleteWebhook).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /yes, remove/i }));
    await waitFor(() => expect(c.deleteWebhook).toHaveBeenCalledWith(CODE));
  });

  it("shows a friendly message when the server is full or unreachable", async () => {
    const full = client({
      putWebhook: vi.fn(() =>
        Promise.reject(
          new ApiError(
            "rate_limited",
            429,
            "Alerts are full right now — the free server only handles a few players.",
            3600,
          ),
        ),
      ),
    });
    const first = renderAlerts(full, { code: CODE });
    await userEvent.type(
      await screen.findByLabelText(/discord webhook url/i),
      "https://discord.com/api/webhooks/1/abc",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save webhook/i }),
    );
    expect(
      await screen.findByText(/alerts are full right now/i),
    ).toBeInTheDocument();
    first.unmount();

    const offline = client({
      getAlerts: vi.fn(() =>
        Promise.reject(new ApiError("network", 0, "Network request failed")),
      ),
    });
    renderAlerts(offline, { code: CODE });
    expect(
      await screen.findByText(/can't reach the server/i),
    ).toBeInTheDocument();
  });
});
