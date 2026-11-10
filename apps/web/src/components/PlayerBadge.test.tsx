import {
  dayKey,
  summarizeProgress,
  type ProgressData,
  type QuestRecord,
} from "@garden-hq/core";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { PlayerBadge } from "./PlayerBadge";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const DAY_MS = 86_400_000;

function doneQuest(day: string, xp: number): QuestRecord {
  return {
    day,
    slot: 0,
    kind: "serve_visitors",
    params: { target: 4 },
    baseline: 100,
    createdAt: NOW - 60_000,
    expiresAt: NOW + DAY_MS,
    doneAt: NOW - 1000,
    xp,
  };
}

function setup(
  build: (p: ProgressData, today: string, yesterday: string) => ProgressData,
) {
  const storage = createGardenStorage(null);
  const snap = storage.getSnapshot();
  const today = dayKey(NOW, snap.timeZone);
  const yesterday = dayKey(NOW - DAY_MS, snap.timeZone);
  storage.setProgress(build(snap.progress, today, yesterday));
  const summary = summarizeProgress(storage.getSnapshot().progress, today);
  return { storage, summary };
}

describe("PlayerBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("shows level, xp progress bar and streak in num spans", () => {
    const { storage, summary } = setup((p, today, yesterday) => ({
      ...p,
      quests: [doneQuest(today, 30), doneQuest(yesterday, 30)],
    }));
    const { container } = renderWithProviders(<PlayerBadge />, { storage });
    const nums = Array.from(container.querySelectorAll(".num")).map(
      (e) => e.textContent,
    );
    expect(screen.getByText(/Lv/)).toBeInTheDocument();
    expect(nums).toContain(String(summary.level));
    expect(nums).toContain(`${summary.xpIntoLevel}/${summary.xpForNext}`);
    expect(summary.streak).toBe(2);
    expect(summary.level).toBe(1);
    expect(container.querySelector(".streak .num")).toHaveTextContent("2");
    expect(
      screen.getByRole("link", { name: /Level 1, .*streak 2 days/ }),
    ).not.toHaveAccessibleName(/at risk/);
    const bar = screen.getByRole("progressbar", { name: "Player XP" });
    expect(bar).toHaveAttribute("aria-valuenow", String(summary.xpIntoLevel));
    expect(bar).toHaveAttribute("aria-valuemax", String(summary.xpForNext));
    expect(screen.queryByText(/streak at risk/)).toBeNull();
  });

  it("flags a streak at risk when nothing is done today", () => {
    const { storage } = setup((p, _today, yesterday) => ({
      ...p,
      quests: [doneQuest(yesterday, 30)],
    }));
    const { container } = renderWithProviders(<PlayerBadge />, { storage });
    expect(container.querySelector(".streak")).toHaveClass("at-risk");
    expect(screen.getByText(/streak at risk/)).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: /at risk/i })).toBeInTheDocument();
    expect(container.querySelector(".streak")).toHaveAttribute(
      "title",
      "Streak at risk: complete a quest today",
    );
  });

  it("shows level 1 and no streak without progress", () => {
    const { container } = renderWithProviders(<PlayerBadge />);
    const nums = Array.from(container.querySelectorAll(".num")).map(
      (e) => e.textContent,
    );
    expect(nums[0]).toBe("1");
    expect(nums).toContain("0");
    expect(screen.queryByText(/streak at risk/)).toBeNull();
    expect(container.querySelector(".streak")).not.toHaveClass("at-risk");
  });

  it("links to the achievements page", () => {
    renderWithProviders(<PlayerBadge />);
    expect(
      screen.getByRole("link", { name: /Level 1, .*streak 0 days/ }),
    ).toHaveAttribute("href", "/achievements");
  });

  it("fills the bar and drops the slash at max level", () => {
    const { storage } = setup((p) => ({
      ...p,
      achievements: { big: { at: NOW, xp: 10_000_000 } },
    }));
    const { container } = renderWithProviders(<PlayerBadge />, { storage });
    expect(container.querySelectorAll(".xp-bar i.on")).toHaveLength(10);
    expect(container.textContent).not.toContain("/");
    const bar = screen.getByRole("progressbar", { name: "Player XP" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "1");
    expect(bar).toHaveAttribute("aria-valuetext", "Max level");
  });
});
