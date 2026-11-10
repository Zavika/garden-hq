import { describe, expect, it } from "vitest";
import {
  EMPTY_PROGRESS,
  MAX_PLAYER_LEVEL,
  addQuests,
  compactProgress,
  completeQuest,
  progressOps,
  sanitizeProgress,
  summarizeProgress,
  unlockAchievement,
  type ProgressData,
} from "./progress";
import { getAchievement } from "./achievements";
import { QUEST_KEEP_DAYS, questXp, type QuestRecord } from "./quests";

function rec(day: string, slot: number, done: boolean): QuestRecord {
  return {
    day,
    slot,
    kind: "water_greenhouse",
    params: {},
    baseline: null,
    createdAt: 1,
    expiresAt: 2,
    doneAt: done ? 1 : null,
    xp: 25,
  };
}
function p(over: Partial<ProgressData>): ProgressData {
  return { ...EMPTY_PROGRESS, ...over };
}

describe("sanitizeProgress", () => {
  it("returns empty progress for garbage", () => {
    expect(sanitizeProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(sanitizeProgress("x")).toEqual(EMPTY_PROGRESS);
    expect(sanitizeProgress({ quests: 5 })).toEqual(EMPTY_PROGRESS);
  });

  it("drops invalid records and de-duplicates (day, slot)", () => {
    const good = rec("2026-11-10", 0, false);
    const out = sanitizeProgress({
      quests: [
        good,
        { ...good, slot: 1, kind: "bogus" },
        { ...good, slot: 1, day: "10-11-2026" },
        { ...good, slot: 99 },
        { ...good, slot: 1, createdAt: Number.NaN },
        { ...good, slot: 1, expiresAt: "x" },
        { ...good, slot: 1, doneAt: Infinity },
        { ...good, slot: 1, params: { a: {} } },
        { ...good, slot: 1.5 },
      ],
    });
    expect(out.quests).toHaveLength(1);
    expect(out.quests[0]?.kind).toBe("water_greenhouse");
  });

  it("forces xp from data", () => {
    const out = sanitizeProgress({
      quests: [{ ...rec("2026-11-10", 0, true), xp: 9999 }],
    });
    expect(out.quests[0]?.xp).toBe(questXp("water_greenhouse"));
  });

  it("drops target quests with a non-positive or missing target", () => {
    const base = rec("2026-11-10", 0, false);
    const mk = (slot: number, kind: string, params: object) => ({
      ...base,
      slot,
      kind,
      params,
    });
    const out = sanitizeProgress({
      quests: [
        mk(0, "serve_visitors", {}),
        mk(1, "serve_visitors", { target: 0 }),
        mk(2, "gain_garden_xp", { target: -5 }),
        mk(0, "gain_garden_xp", { target: "5" }),
      ],
    });
    expect(out.quests).toHaveLength(0);
    const ok = sanitizeProgress({
      quests: [mk(0, "serve_visitors", { target: 3 })],
    });
    expect(ok.quests).toHaveLength(1);
  });

  it("keeps the first of duplicate slots", () => {
    const a = { ...rec("2026-11-10", 0, false), createdAt: 11 };
    const b = { ...rec("2026-11-10", 0, false), createdAt: 22 };
    expect(sanitizeProgress({ quests: [a, b] }).quests[0]?.createdAt).toBe(11);
  });

  it("ignores __proto__ and constructor achievement keys without throwing", () => {
    const raw: unknown = JSON.parse(
      '{"achievements":{"__proto__":{"at":1,"xp":5},"constructor":{"at":1,"xp":5}}}',
    );
    const out = sanitizeProgress(raw);
    expect(Object.keys(out.achievements)).toEqual([]);
    expect(Object.getPrototypeOf(out.achievements)).toBe(Object.prototype);
  });

  it("keeps valid achievements and archive, filtering bad ones", () => {
    const out = sanitizeProgress({
      achievements: {
        first_greenhouse: { at: 5, xp: 99999 },
        unknown_id: { at: 5, xp: 50 },
        bad: { at: "x", xp: 1 },
        junk: 4,
      },
      archive: {
        xp: 100,
        doneQuests: 3.7,
        doneDays: ["2026-01-02", "nope", "2026-01-01", "2026-01-02"],
      },
    });
    expect(out.achievements).toEqual({
      first_greenhouse: { at: 5, xp: getAchievement("first_greenhouse")?.xp },
    });
    expect(out.archive).toEqual({
      xp: 100,
      doneQuests: 3,
      doneDays: ["2026-01-01", "2026-01-02"],
    });
    expect(
      sanitizeProgress({ archive: { xp: -4, doneQuests: -1 } }).archive,
    ).toEqual(EMPTY_PROGRESS.archive);
  });

  it("caps doneDays at the 400 newest", () => {
    const days: string[] = [];
    for (let i = 0; i < 450; i++) {
      days.push(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
    }
    const out = sanitizeProgress({ archive: { doneDays: days } });
    expect(out.archive.doneDays).toHaveLength(400);
    expect(out.archive.doneDays[399]).toBe(days[449]);
    expect(out.archive.doneDays[0]).toBe(days[50]);
  });
});

describe("addQuests", () => {
  it("adds new slots and keeps existing ones", () => {
    const base = p({ quests: [rec("2026-11-10", 0, false)] });
    const out = addQuests(base, [
      { ...rec("2026-11-10", 0, true), createdAt: 9 },
      rec("2026-11-10", 1, false),
    ]);
    expect(out.quests).toHaveLength(2);
    expect(out.quests[0]?.createdAt).toBe(1);
    expect(out.quests[0]?.doneAt).toBeNull();
  });
  it("returns the same reference when nothing is added", () => {
    const base = p({ quests: [rec("2026-11-10", 0, false)] });
    expect(addQuests(base, [rec("2026-11-10", 0, false)])).toBe(base);
    expect(addQuests(base, [])).toBe(base);
  });
});

describe("completeQuest", () => {
  it("sets doneAt once", () => {
    const base = p({ quests: [rec("2026-11-10", 0, false)] });
    const out = completeQuest(base, "2026-11-10", 0, 777);
    expect(out.quests[0]?.doneAt).toBe(777);
    expect(base.quests[0]?.doneAt).toBeNull();
    expect(completeQuest(out, "2026-11-10", 0, 999)).toBe(out);
  });
  it("returns the same reference for a missing record", () => {
    const base = p({ quests: [rec("2026-11-10", 0, false)] });
    expect(completeQuest(base, "2026-11-10", 2, 5)).toBe(base);
    expect(completeQuest(base, "2026-11-09", 0, 5)).toBe(base);
  });
});

describe("unlockAchievement", () => {
  it("inserts and keeps the first unlock", () => {
    const a = unlockAchievement(EMPTY_PROGRESS, "x", 10, 50);
    expect(a.achievements.x).toEqual({ at: 10, xp: 50 });
    expect(unlockAchievement(a, "x", 99, 1)).toBe(a);
  });
});

describe("compactProgress", () => {
  const today = "2026-11-30";
  it("has the expected window", () => {
    expect(QUEST_KEEP_DAYS).toBe(14);
  });
  it("folds old done records and drops old undone ones", () => {
    const base = p({
      quests: [
        rec("2026-11-01", 0, true),
        rec("2026-11-01", 1, false),
        rec("2026-11-29", 0, true),
      ],
    });
    const out = compactProgress(base, today);
    expect(out.quests.map((q) => q.day)).toEqual(["2026-11-29"]);
    expect(out.archive.xp).toBe(25);
    expect(out.archive.doneQuests).toBe(1);
    expect(out.archive.doneDays).toEqual(["2026-11-01"]);
  });
  it("returns the same reference when nothing is old", () => {
    const base = p({ quests: [rec("2026-11-29", 0, true)] });
    expect(compactProgress(base, today)).toBe(base);
  });
  it("preserves xp total and streak", () => {
    const base = p({
      quests: [
        rec("2026-11-01", 0, true),
        rec("2026-11-02", 0, true),
        rec("2026-11-29", 0, true),
        rec("2026-11-30", 0, true),
      ],
    });
    const before = summarizeProgress(base, today);
    const after = summarizeProgress(compactProgress(base, today), today);
    expect(after).toEqual(before);
  });
});

describe("summarizeProgress", () => {
  const today = "2026-11-10";
  it("starts at level 1", () => {
    expect(summarizeProgress(EMPTY_PROGRESS, today)).toEqual({
      xp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNext: 80,
      streak: 0,
      bestStreak: 0,
      atRisk: false,
      doneToday: false,
      doneQuests: 0,
    });
  });
  it("sums archive, quests and achievements", () => {
    const s = summarizeProgress(
      p({
        quests: [rec(today, 0, true), rec(today, 1, false)],
        achievements: { a: { at: 1, xp: 7 } },
        archive: { xp: 100, doneQuests: 4, doneDays: [] },
      }),
      today,
    );
    expect(s.xp).toBe(100 + 25 + 7);
    expect(s.doneQuests).toBe(5);
  });
  it("level boundaries", () => {
    const at = (xp: number) =>
      summarizeProgress(
        p({ archive: { xp, doneQuests: 0, doneDays: [] } }),
        today,
      );
    expect(at(79).level).toBe(1);
    const l2 = at(80);
    expect(l2.level).toBe(2);
    expect(l2.xpIntoLevel).toBe(0);
    expect(l2.xpForNext).toBe(100);
    const max = at(10_000_000);
    expect(max.level).toBe(MAX_PLAYER_LEVEL);
    expect(max.xpForNext).toBeNull();
  });
  const days = (...d: string[]) =>
    p({ archive: { xp: 0, doneQuests: 0, doneDays: d } });
  it("counts a streak including today", () => {
    const s = summarizeProgress(
      p({
        quests: [
          rec("2026-11-10", 0, true),
          rec("2026-11-09", 0, true),
          rec("2026-11-08", 0, true),
        ],
      }),
      today,
    );
    expect(s.streak).toBe(3);
    expect(s.doneToday).toBe(true);
    expect(s.atRisk).toBe(false);
  });
  it("is at risk when only yesterday and before are done", () => {
    const s = summarizeProgress(days("2026-11-08", "2026-11-09"), today);
    expect(s.streak).toBe(2);
    expect(s.atRisk).toBe(true);
  });
  it("resets after a gap", () => {
    const s = summarizeProgress(days("2026-11-07", "2026-11-09"), today);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(1);
  });
  it("is zero after two idle days", () => {
    const s = summarizeProgress(days("2026-11-07", "2026-11-08"), today);
    expect(s.streak).toBe(0);
    expect(s.atRisk).toBe(false);
    expect(s.bestStreak).toBe(2);
  });
  it("keeps the longest historic run", () => {
    const s = summarizeProgress(
      days("2026-10-01", "2026-10-02", "2026-10-03", "2026-11-10"),
      today,
    );
    expect(s.bestStreak).toBe(3);
    expect(s.streak).toBe(1);
  });
  it("spans archive and record days", () => {
    const s = summarizeProgress(
      p({
        quests: [rec("2026-11-10", 0, true), rec("2026-11-09", 0, true)],
        archive: {
          xp: 0,
          doneQuests: 2,
          doneDays: ["2026-11-07", "2026-11-08"],
        },
      }),
      today,
    );
    expect(s.streak).toBe(4);
  });
});

describe("progressOps", () => {
  const A = rec("2026-11-10", 0, false);
  it("same reference and unchanged give nothing", () => {
    const x = p({ quests: [A] });
    expect(progressOps(x, x)).toEqual([]);
    expect(progressOps(x, p({ quests: [A] }))).toEqual([]);
  });
  it("new records give one setQuests per day", () => {
    const next = p({
      quests: [A, rec("2026-11-10", 1, false), rec("2026-11-11", 0, false)],
    });
    const ops = progressOps(p({}), next);
    expect(ops.filter((o) => o.t === "setQuests")).toHaveLength(2);
  });
  it("newly done gives completeQuest with kind", () => {
    const done = { ...A, doneAt: 9 };
    expect(progressOps(p({ quests: [A] }), p({ quests: [done] }))).toEqual([
      { t: "completeQuest", day: A.day, slot: 0, kind: A.kind, at: 9 },
    ]);
  });
  it("new achievements give unlockAchievement", () => {
    const next = p({ achievements: { first_greenhouse: { at: 3, xp: 50 } } });
    expect(progressOps(p({}), next)).toEqual([
      { t: "unlockAchievement", id: "first_greenhouse", at: 3, xp: 50 },
    ]);
  });
  it("compaction gives nothing", () => {
    const prev = p({ quests: [A] });
    const next = p({
      quests: [],
      archive: { xp: 25, doneQuests: 1, doneDays: [A.day] },
    });
    expect(progressOps(prev, next)).toEqual([]);
  });
  it("created and done in one diff gives setQuests then completeQuest", () => {
    const done = { ...A, doneAt: 5 };
    const ops = progressOps(p({}), p({ quests: [done] }));
    expect(ops.map((o) => o.t)).toEqual(["setQuests", "completeQuest"]);
  });
});
