import {
  QUEST_KEEP_DAYS,
  SKEW_MS,
  addDays,
  dayKey,
  questXp,
  type QuestRecord,
  type SyncOp,
} from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { makeD1 } from "../../test/d1";
import {
  applyOpsToDb,
  createAccount,
  deleteAccount,
  filterProgressOps,
  loadAccount,
  readState,
} from "./db";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const TODAY = dayKey(NOW, "Europe/Warsaw");

function quest(
  day: string,
  slot: number,
  over: Partial<QuestRecord> = {},
): QuestRecord {
  return {
    day,
    slot,
    kind: "unlock_plot",
    params: { plot: "beginner_1", n: 2 },
    baseline: null,
    createdAt: NOW,
    expiresAt: NOW + 86_400_000,
    doneAt: null,
    xp: questXp("unlock_plot"),
    ...over,
  };
}

async function setup() {
  const db = makeD1();
  await createAccount(db, {
    id: "a1",
    codeHash: "h1",
    link: {
      name: "Steve_1",
      uuid: UUID,
      profileId: UUID2,
      profiles: [{ profileId: UUID2, name: "Apple", selected: true }],
    },
    now: 1,
  });
  const state = async () => {
    const acc = await loadAccount(db, "a1");
    if (acc === null) throw new Error("no account");
    return readState(db, acc, NOW);
  };
  const apply = (ops: SyncOp[]) => applyOpsToDb(db, "a1", ops, NOW);
  const count = async (table: string) =>
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .first<{ n: number }>()
    )?.n;
  return { db, state, apply, count };
}

describe("progress persistence", () => {
  it("setQuests inserts, first write wins, one statement per op", async () => {
    const { db, state, apply, count } = await setup();
    const sizes: number[] = [];
    const orig = db.batch.bind(db);
    db.batch = ((stmts: D1PreparedStatement[]) => {
      sizes.push(stmts.length);
      return orig(stmts);
    }) as typeof db.batch;
    const qs = [
      quest(TODAY, 0, { baseline: 1.5 }),
      quest(TODAY, 1, { baseline: null }),
    ];
    await apply([{ t: "setQuests", day: TODAY, quests: qs }]);
    expect(sizes).toEqual([2]); // one op + revision bump
    expect((await state()).progress.quests).toEqual(qs);
    await apply([{ t: "setQuests", day: TODAY, quests: qs }]);
    await apply([
      {
        t: "setQuests",
        day: TODAY,
        quests: [quest(TODAY, 0, { params: { plot: "x", n: 9 } })],
      },
    ]);
    expect(await count("quest_log")).toBe(2);
    expect((await state()).progress.quests).toEqual(qs);
  });

  it("completeQuest sets done_at once and checks kind and row", async () => {
    const { state, apply } = await setup();
    await apply([{ t: "setQuests", day: TODAY, quests: [quest(TODAY, 0)] }]);
    const done = (at: number, kind = "unlock_plot", slot = 0): SyncOp =>
      ({ t: "completeQuest", day: TODAY, slot, kind, at }) as SyncOp;
    await apply([done(500, "discover_mutation")]);
    await apply([done(500, "unlock_plot", 2)]);
    expect((await state()).progress.quests[0]?.doneAt).toBeNull();
    await apply([done(500)]);
    await apply([done(900)]);
    expect((await state()).progress.quests[0]?.doneAt).toBe(500);
  });

  it("unlockAchievement is first-wins", async () => {
    const { state, apply } = await setup();
    const un = (at: number): SyncOp => ({
      t: "unlockAchievement",
      id: "first_greenhouse",
      at,
      xp: 50,
    });
    await apply([un(10)]);
    await apply([un(20)]);
    expect((await state()).progress.achievements).toEqual({
      first_greenhouse: { at: 10, xp: 50 },
    });
  });

  it("readState windows quests and builds the archive", async () => {
    const { state, apply } = await setup();
    const old1 = addDays(TODAY, -QUEST_KEEP_DAYS - 1);
    const old2 = addDays(TODAY, -QUEST_KEEP_DAYS - 3);
    const edge = addDays(TODAY, -QUEST_KEEP_DAYS);
    await apply([
      {
        t: "setQuests",
        day: old1,
        quests: [quest(old1, 0, { doneAt: 5 }), quest(old1, 1, { doneAt: 6 })],
      },
      {
        t: "setQuests",
        day: old2,
        quests: [quest(old2, 0, { doneAt: 5 }), quest(old2, 1)],
      },
      { t: "setQuests", day: edge, quests: [quest(edge, 0)] },
    ]);
    const p = (await state()).progress;
    expect(p.quests.map((q) => q.day)).toEqual([edge]);
    expect(p.archive).toEqual({
      xp: 3 * questXp("unlock_plot"),
      doneQuests: 3,
      doneDays: [old2, old1],
    });
  });

  it("deleteAccount removes quest_log and achievements", async () => {
    const { db, apply, count } = await setup();
    await apply([
      { t: "setQuests", day: TODAY, quests: [quest(TODAY, 0)] },
      { t: "unlockAchievement", id: "first_greenhouse", at: 1, xp: 50 },
    ]);
    expect(await count("quest_log")).toBe(1);
    await deleteAccount(db, "a1");
    expect(await count("quest_log")).toBe(0);
    expect(await count("achievements")).toBe(0);
  });
});

describe("filterProgressOps", () => {
  const sq = (day: string, over: Partial<QuestRecord> = {}): SyncOp => ({
    t: "setQuests",
    day,
    quests: [quest(day, 0, over)],
  });
  const cq = (day: string, at = NOW): SyncOp => ({
    t: "completeQuest",
    day,
    slot: 0,
    kind: "unlock_plot",
    at,
  });
  const keep: SyncOp = {
    t: "setAssignment",
    plotId: "beginner_1",
    cropId: null,
  };

  it("keeps ops inside the day window and drops outside it", () => {
    const lo = addDays(TODAY, -QUEST_KEEP_DAYS);
    const hi = addDays(TODAY, 1);
    const ops = [sq(lo), cq(hi), sq(addDays(lo, -1)), cq(addDays(hi, 1)), keep];
    const out = filterProgressOps(ops, NOW, "Europe/Warsaw");
    expect(out.ops).toEqual([ops[0], ops[1], ops[4]]);
    expect(out.rejected).toBe(2);
  });

  it("clamps future timestamps beyond the skew to now", () => {
    const ops: SyncOp[] = [
      cq(TODAY, NOW + SKEW_MS),
      cq(TODAY, NOW + SKEW_MS + 1),
      sq(TODAY, { createdAt: NOW + SKEW_MS + 1, doneAt: NOW + SKEW_MS + 1 }),
      {
        t: "unlockAchievement",
        id: "first_greenhouse",
        at: NOW + SKEW_MS + 1,
        xp: 50,
      },
    ];
    const out = filterProgressOps(ops, NOW, "Europe/Warsaw");
    expect(out.rejected).toBe(0);
    expect(out.ops[0]).toEqual(ops[0]);
    expect(out.ops[1]).toEqual(cq(TODAY, NOW));
    const q = out.ops[2];
    if (q?.t !== "setQuests") throw new Error("expected setQuests");
    expect(q.quests[0]?.createdAt).toBe(NOW);
    expect(q.quests[0]?.doneAt).toBe(NOW);
    expect(out.ops[3]).toMatchObject({ t: "unlockAchievement", at: NOW });
  });

  it("depends on the account time zone", () => {
    const now = Date.UTC(2026, 9, 1, 23, 30, 0); // Oct 2 01:30 in Warsaw
    expect(dayKey(now, "UTC")).toBe("2026-10-01");
    expect(dayKey(now, "Europe/Warsaw")).toBe("2026-10-02");
    // 2026-10-03 is today+1 in Warsaw but today+2 in UTC.
    const op = sq("2026-10-03", { createdAt: now });
    expect(filterProgressOps([op], now, "Europe/Warsaw").rejected).toBe(0);
    expect(filterProgressOps([op], now, "UTC").rejected).toBe(1);
  });
});
