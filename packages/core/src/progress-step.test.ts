import { describe, expect, it } from "vitest";
import { EMPTY_PROGRESS, addQuests, summarizeProgress } from "./progress";
import { stepProgress, type StepInput } from "./progress-step";
import {
  ALL_PLOT_IDS,
  EXPIRES,
  NOW,
  PROFILE_ID,
  makeContext,
  makeGarden,
  makeMember,
} from "./quest-fixtures";
import { QUESTS_PER_DAY, questXp, type QuestRecord } from "./quests";

const TODAY = "2026-11-10";

function input(overrides: Partial<StepInput> = {}): StepInput {
  return {
    ...makeContext(),
    progress: EMPTY_PROGRESS,
    assignments: {},
    ...overrides,
  };
}

function serveQuest(day = TODAY): QuestRecord {
  return {
    day,
    slot: 0,
    kind: "serve_visitors",
    params: { target: 5, profileId: PROFILE_ID },
    baseline: 100,
    createdAt: NOW - 60_000,
    expiresAt: EXPIRES,
    doneAt: null,
    xp: questXp("serve_visitors"),
  };
}

describe("stepProgress", () => {
  it("creates quests on a new day without completing any", () => {
    const r = stepProgress(input());
    expect(r.progress.quests).toHaveLength(QUESTS_PER_DAY);
    expect(r.progress.quests.every((q) => q.doneAt === null)).toBe(true);
    expect(r.events.some((e) => e.type === "quest_done")).toBe(false);
  });

  it("creates no quests from a stale garden", () => {
    const r = stepProgress(input({ gardenFetchedAt: NOW - 3_600_000 }));
    expect(r.progress.quests).toHaveLength(0);
  });

  it("is idempotent", () => {
    const first = stepProgress(input());
    const second = stepProgress(input({ progress: first.progress }));
    expect(second.progress).toBe(first.progress);
    expect(second.events).toEqual([]);
  });

  it("completes a serve_visitors quest when the counter passes the target", () => {
    const progress = addQuests(EMPTY_PROGRESS, [serveQuest()]);
    const ctx = makeContext({
      garden: makeGarden({ visitorsServedTotal: 106 }),
    });
    const r = stepProgress({ ...ctx, progress, assignments: {} });
    const q = r.progress.quests[0];
    expect(q?.doneAt).toBe(ctx.gardenFetchedAt);
    expect(r.events.filter((e) => e.type === "quest_done")).toEqual([
      {
        type: "quest_done",
        day: TODAY,
        slot: 0,
        xp: questXp("serve_visitors"),
      },
    ]);
    const achievementXp = Object.values(r.progress.achievements).reduce(
      (sum, a) => sum + a.xp,
      0,
    );
    expect(summarizeProgress(r.progress, TODAY).xp).toBe(
      questXp("serve_visitors") + achievementXp,
    );
  });

  it("does not complete yesterday's quest after the reset", () => {
    const old: QuestRecord = {
      ...serveQuest("2026-11-09"),
      createdAt: NOW - 86_400_000,
      expiresAt: NOW - 43_200_000,
    };
    const progress = addQuests(EMPTY_PROGRESS, [old]);
    const ctx = makeContext({
      garden: makeGarden({ visitorsServedTotal: 500 }),
    });
    const r = stepProgress({ ...ctx, progress, assignments: {} });
    const prev = r.progress.quests.find((q) => q.day === "2026-11-09");
    expect(prev?.doneAt).toBeNull();
    expect(r.events.some((e) => e.type === "quest_done")).toBe(false);
  });

  it("reports a veteran first run as a single backfill with full XP", () => {
    const ctx = makeContext({
      garden: makeGarden({
        level: 15,
        unlockedPlotIds: ALL_PLOT_IDS,
        visitorsServedTotal: 100_000,
      }),
      member: makeMember({
        discoveredMutations: Array.from({ length: 40 }, (_, i) => `m${i}`),
      }),
    });
    const first = stepProgress({
      ...ctx,
      progress: EMPTY_PROGRESS,
      assignments: {},
    });
    const r = first;
    const again = stepProgress({
      ...ctx,
      progress: first.progress,
      assignments: {},
    });
    expect(again.progress).toBe(first.progress);
    expect(again.events).toEqual([]);
    expect(r.events).toHaveLength(1);
    const ev = r.events[0];
    if (ev?.type !== "backfill") throw new Error("expected backfill");
    expect(ev.count).toBeGreaterThan(1);
    const sum = Object.values(r.progress.achievements).reduce(
      (s, a) => s + a.xp,
      0,
    );
    expect(ev.xp).toBe(sum);
    expect(Object.keys(r.progress.achievements)).toHaveLength(ev.count);
    expect(summarizeProgress(r.progress, TODAY).xp).toBe(sum);
  });

  it("emits individual achievement events on a non-first run", () => {
    const base = stepProgress(input());
    const ctx = makeContext({
      garden: makeGarden({ unlockedPlotIds: ALL_PLOT_IDS }),
    });
    const r = stepProgress({
      ...ctx,
      progress: base.progress,
      assignments: {},
    });
    // Fixture: 24 plots at level 3 satisfy only the plot tiers not already held.
    const expectedIds = ["plots_6", "plots_12", "plots_18", "plots_24"];
    const achievementEvents = r.events.flatMap((e) =>
      e.type === "achievement" ? [e] : [],
    );
    expect(achievementEvents.map((e) => e.id)).toEqual(expectedIds);
    for (const e of achievementEvents) {
      expect(e.xp).toBe(r.progress.achievements[e.id]?.xp);
    }
    expect(r.events.some((e) => e.type === "backfill")).toBe(false);
  });

  it("completes water_greenhouse when watered after creation", () => {
    const rec: QuestRecord = {
      day: TODAY,
      slot: 0,
      kind: "water_greenhouse",
      params: { profileId: PROFILE_ID },
      baseline: null,
      createdAt: NOW - 60_000,
      expiresAt: EXPIRES,
      doneAt: null,
      xp: questXp("water_greenhouse"),
    };
    const progress = addQuests(EMPTY_PROGRESS, [rec]);
    const ctx = makeContext({
      greenhouses: { beginner_1: { lastWateredAt: NOW - 1000 } },
    });
    const r = stepProgress({ ...ctx, progress, assignments: {} });
    expect(r.progress.quests[0]?.doneAt).toBe(NOW - 1000);
  });

  it("compacts old done quests into the archive preserving XP", () => {
    const old: QuestRecord = {
      ...serveQuest("2026-10-20"),
      createdAt: NOW - 20 * 86_400_000,
      expiresAt: NOW - 19 * 86_400_000,
      doneAt: NOW - 20 * 86_400_000 + 1000,
    };
    const progress = addQuests(EMPTY_PROGRESS, [old]);
    const r = stepProgress(input({ progress }));
    expect(r.progress.quests.some((q) => q.day === "2026-10-20")).toBe(false);
    expect(r.progress.archive.doneQuests).toBe(1);
    expect(r.progress.archive.xp).toBe(questXp("serve_visitors"));
  });
});
