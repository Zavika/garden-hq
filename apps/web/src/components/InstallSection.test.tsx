import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IOS_PUSH_NOTE, type PlatformEnv } from "../pwa/platform";

const hook = vi.hoisted(() => ({
  value: {
    canInstall: false,
    installed: false,
    install: vi.fn(() => Promise.resolve("accepted" as const)),
  },
}));

vi.mock("../pwa/useInstallPrompt", () => ({
  useInstallPrompt: () => hook.value,
}));

import { InstallSection } from "./InstallSection";

const base: PlatformEnv = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/123.0",
  platform: "Win32",
  maxTouchPoints: 0,
  displayModeStandalone: false,
};
const IOS_SAFARI: PlatformEnv = {
  ...base,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};
const IOS_CHROME: PlatformEnv = {
  ...IOS_SAFARI,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) CriOS/123.0 Mobile/15E148 Safari/604.1",
};

beforeEach(() => {
  hook.value = {
    canInstall: false,
    installed: false,
    install: vi.fn(() => Promise.resolve("accepted" as const)),
  };
});

describe("InstallSection", () => {
  it("renders the Install heading", () => {
    render(<InstallSection env={base} />);
    expect(
      screen.getByRole("heading", { name: "Install" }),
    ).toBeInTheDocument();
  });

  it("shows the generic hint on other platforms", () => {
    render(<InstallSection env={base} />);
    expect(
      screen.getByText(
        "Use your browser's Install or Add to Home Screen option.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(IOS_PUSH_NOTE)).toBeNull();
  });

  it("shows Install app and calls install when the prompt is available", async () => {
    hook.value.canInstall = true;
    render(<InstallSection env={base} />);
    await userEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(hook.value.install).toHaveBeenCalledTimes(1);
  });

  it("shows iOS Safari instructions with the exact push note", () => {
    render(<InstallSection env={IOS_SAFARI} />);
    expect(
      screen.getByText("Tap the Share button, then Add to Home Screen."),
    ).toBeInTheDocument();
    expect(screen.getByText(IOS_PUSH_NOTE).textContent).toBe(IOS_PUSH_NOTE);
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("tells iOS Chrome users to open Safari", () => {
    render(<InstallSection env={IOS_CHROME} />);
    expect(
      screen.getByText(
        "Open this page in Safari to add it to the Home Screen.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(IOS_PUSH_NOTE)).toBeInTheDocument();
  });

  it("shows installed copy and no button when standalone", () => {
    hook.value.canInstall = true;
    render(<InstallSection env={{ ...IOS_SAFARI, standaloneNav: true }} />);
    expect(
      screen.getByText("Garden HQ is installed on this device."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
    expect(screen.queryByText(IOS_PUSH_NOTE)).toBeNull();
  });

  it("shows installed copy after appinstalled", () => {
    hook.value.installed = true;
    render(<InstallSection env={base} />);
    expect(
      screen.getByText("Garden HQ is installed on this device."),
    ).toBeInTheDocument();
  });
});
