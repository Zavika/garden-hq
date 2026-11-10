import {
  EMPTY_PROGRESS,
  applyOps,
  EMPTY_STORED_DATA,
  MAX_OPS_PER_REQUEST,
  type StoredData,
  type StoredLink,
  type SyncOp,
} from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { makeD1 } from "../../test/d1";
import {
  applyOpsToDb,
  createAccount,
  deleteAccount,
  loadAccount,
  readState,
} from "./db";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const LINK: StoredLink = {
  name: "Steve_1",
  uuid: UUID,
  profileId: UUID2,
  profiles: [{ profileId: UUID2, name: "Apple", selected: true }],
};
const LINK2: StoredLink = {
  name: "Alex",
  uuid: UUID2,
  profileId: UUID,
  profiles: [{ profileId: UUID, name: "Pear", selected: false }],
};

async function setup() {
  const db = makeD1();
  await createAccount(db, { id: "a1", codeHash: "h1", link: LINK, now: 1 });
  const state = async () => {
    const acc = await loadAccount(db, "a1");
    if (acc === null) throw new Error("no account");
    return readState(db, acc, 100);
  };
  const apply = (ops: SyncOp[]) => applyOpsToDb(db, "a1", ops, 100);
  const count = async (table: string) =>
    (
      await db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .first<{ n: number }>()
    )?.n;
  return { db, state, apply, count };
}

const gh = (plotId: string): SyncOp => ({ t: "markGreenhouse", plotId });
const cell = (
  plotId: string,
  cellKey: string,
  contentId: string | null,
): SyncOp => ({ t: "setGreenhouseCell", plotId, cellKey, contentId });
const crop = (plotId: string, cropId: string | null): SyncOp => ({
  t: "setAssignment",
  plotId,
  cropId,
});

describe("sync db", () => {
  it("creates an account with an empty state", async () => {
    const { state } = await setup();
    expect(await state()).toEqual({
      link: LINK,
      assignments: {},
      greenhouses: {},
      timeZone: "Europe/Warsaw",
      progress: EMPTY_PROGRESS,
      revision: 0,
    });
  });

  it("sets, overwrites and clears an assignment", async () => {
    const { state, apply } = await setup();
    await apply([crop("beginner_1", "wheat")]);
    expect((await state()).assignments).toEqual({ beginner_1: "wheat" });
    await apply([crop("beginner_1", "carrot")]);
    expect((await state()).assignments).toEqual({ beginner_1: "carrot" });
    await apply([crop("beginner_1", null)]);
    expect((await state()).assignments).toEqual({});
  });

  it("caps Greenhouses at 3 and keeps cells when a mark repeats", async () => {
    const { state, apply, count } = await setup();
    await apply([
      gh("beginner_1"),
      cell("beginner_1", "1,2", "wheat"),
      gh("beginner_2"),
      gh("beginner_3"),
      gh("beginner_4"),
      gh("beginner_1"),
    ]);
    expect(await count("greenhouses")).toBe(3);
    const s = await state();
    expect(Object.keys(s.greenhouses).sort()).toEqual([
      "beginner_1",
      "beginner_2",
      "beginner_3",
    ]);
    expect(s.greenhouses.beginner_1?.cells).toEqual({ "1,2": "wheat" });
  });

  it("sets and clears cells; a missing Greenhouse changes nothing", async () => {
    const { state, apply, count } = await setup();
    await apply([cell("beginner_1", "1,2", "wheat")]);
    expect(await count("greenhouses")).toBe(0);
    await apply([
      gh("beginner_1"),
      cell("beginner_1", "1,2", "wheat"),
      cell("beginner_1", "3,4", "carrot"),
    ]);
    expect((await state()).greenhouses.beginner_1?.cells).toEqual({
      "1,2": "wheat",
      "3,4": "carrot",
    });
    await apply([cell("beginner_1", "1,2", null)]);
    expect((await state()).greenhouses.beginner_1?.cells).toEqual({
      "3,4": "carrot",
    });
  });

  it("handles watering, interval, time zone, link and unmark", async () => {
    const { state, apply } = await setup();
    await apply([
      gh("beginner_1"),
      { t: "markGreenhouseWatered", plotId: "beginner_1", at: 5000 },
      { t: "setWateringInterval", plotId: "beginner_1", hours: 6.5 },
      { t: "setTimeZone", timeZone: "UTC" },
      { t: "setLink", link: LINK2 },
    ]);
    let s = await state();
    expect(s.greenhouses.beginner_1).toEqual({
      cells: {},
      lastWateredAt: 5000,
      wateringIntervalHours: 6.5,
    });
    expect(s.timeZone).toBe("UTC");
    expect(s.link).toEqual(LINK2);
    await apply([
      { t: "setWateringInterval", plotId: "beginner_1", hours: null },
    ]);
    s = await state();
    expect(s.greenhouses.beginner_1?.wateringIntervalHours).toBeNull();
    await apply([{ t: "unmarkGreenhouse", plotId: "beginner_1" }]);
    expect((await state()).greenhouses).toEqual({});
  });

  it("is idempotent and bumps the revision once per call", async () => {
    const { state, apply } = await setup();
    const ops: SyncOp[] = [
      crop("beginner_1", "wheat"),
      gh("beginner_2"),
      cell("beginner_2", "0,0", "wheat"),
      { t: "markGreenhouseWatered", plotId: "beginner_2", at: 9 },
    ];
    await apply(ops);
    const first = await state();
    await apply(ops);
    const second = await state();
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect({ ...second, revision: 0 }).toEqual({ ...first, revision: 0 });
  });

  it("matches core applyOps on a 26-op sequence (oracle)", async () => {
    const { state, apply } = await setup();
    const ops: SyncOp[] = [
      crop("beginner_1", "wheat"),
      crop("beginner_2", "carrot"),
      crop("beginner_1", "potato"),
      crop("beginner_2", null),
      crop("beginner_3", null),
      gh("beginner_1"),
      gh("beginner_2"),
      gh("beginner_3"),
      gh("beginner_4"),
      gh("beginner_1"),
      cell("beginner_1", "1,2", "wheat"),
      cell("beginner_1", "1,2", "carrot"),
      cell("beginner_1", "5,5", "wheat"),
      cell("beginner_1", "5,5", null),
      cell("beginner_4", "0,0", "wheat"),
      { t: "markGreenhouseWatered", plotId: "beginner_2", at: 1234 },
      { t: "markGreenhouseWatered", plotId: "beginner_4", at: 99 },
      { t: "setWateringInterval", plotId: "beginner_2", hours: 12 },
      { t: "setWateringInterval", plotId: "beginner_3", hours: 3 },
      { t: "setWateringInterval", plotId: "beginner_3", hours: null },
      { t: "unmarkGreenhouse", plotId: "beginner_2" },
      { t: "unmarkGreenhouse", plotId: "beginner_4" },
      { t: "setTimeZone", timeZone: "America/New_York" },
      { t: "setLink", link: LINK2 },
      crop("beginner_4", "melon"),
      { t: "setWateringInterval", plotId: "beginner_5", hours: 8 },
    ];
    expect(ops).toHaveLength(26);
    const initial: StoredData = { ...EMPTY_STORED_DATA, link: LINK };
    await apply(ops);
    const { revision, ...actual } = await state();
    expect(revision).toBe(1);
    expect(actual).toEqual(applyOps(initial, ops));
  });

  it("applies a maximum-size request atomically with one revision bump", async () => {
    const { state, apply } = await setup();
    const keys = Array.from(
      { length: MAX_OPS_PER_REQUEST - 1 },
      (_, i) => `${i % 10},${Math.floor(i / 10)}`,
    );
    const ops = [
      gh("beginner_1"),
      ...keys.map((k) => cell("beginner_1", k, "wheat")),
    ];
    expect(ops).toHaveLength(MAX_OPS_PER_REQUEST);
    await apply(ops);
    const s = await state();
    expect(Object.keys(s.greenhouses.beginner_1?.cells ?? {})).toHaveLength(
      MAX_OPS_PER_REQUEST - 1,
    );
    expect(s.revision).toBe(1);
  });

  it("applies nothing and keeps the revision when the batch fails", async () => {
    const { db, state, count } = await setup();
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop === "batch") {
          return (stmts: D1PreparedStatement[]) =>
            target.batch([
              ...stmts,
              target
                .prepare(
                  "INSERT INTO plot_assignments (account_id, plot_id, crop_id, updated_at) VALUES ('ghost','p','c',1)",
                )
                .bind(),
            ]);
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await expect(
      applyOpsToDb(
        failing,
        "a1",
        [crop("beginner_1", "wheat"), { t: "setTimeZone", timeZone: "UTC" }],
        5,
      ),
    ).rejects.toThrow();
    expect(await count("plot_assignments")).toBe(0);
    const s = await state();
    expect(s.revision).toBe(0);
    expect(s.timeZone).toBe("Europe/Warsaw");
  });

  it("does nothing for an empty op list", async () => {
    const { apply, state } = await setup();
    await apply([]);
    expect((await state()).revision).toBe(0);
  });

  it("heals a corrupt cells value on the next cell write", async () => {
    const { db, apply, state } = await setup();
    await apply([gh("beginner_1")]);
    await db
      .prepare("UPDATE greenhouses SET cells = 'not json' WHERE plot_id = ?1")
      .bind("beginner_1")
      .run();
    await apply([cell("beginner_1", "1,2", "wheat")]);
    expect((await state()).greenhouses.beginner_1?.cells).toEqual({
      "1,2": "wheat",
    });
  });

  it("writes nothing for an unknown account", async () => {
    const { db, count } = await setup();
    await expect(
      applyOpsToDb(
        db,
        "ghost",
        [{ t: "setTimeZone", timeZone: "UTC" }, crop("beginner_1", "wheat")],
        1,
      ),
    ).rejects.toThrow();
    expect(await count("plot_assignments")).toBe(0);
    expect(await count("greenhouses")).toBe(0);
    expect(await loadAccount(db, "ghost")).toBeNull();
  });

  it("deleteAccount removes rows from all three tables", async () => {
    const { db, apply, count } = await setup();
    await apply([crop("beginner_1", "wheat"), gh("beginner_2")]);
    await db.batch([
      db.prepare(
        "INSERT INTO alert_settings (account_id, updated_at) VALUES ('a1', 1)",
      ),
      db.prepare(
        "INSERT INTO garden_snapshot (account_id, fetched_at, json) VALUES ('a1', 1, '{}')",
      ),
      db.prepare(
        "INSERT INTO alert_log (account_id, type, key, sent_at) VALUES ('a1', 't', 'k', 1)",
      ),
    ]);
    await deleteAccount(db, "a1");
    expect(await count("accounts")).toBe(0);
    expect(await count("alert_settings")).toBe(0);
    expect(await count("garden_snapshot")).toBe(0);
    expect(await count("alert_log")).toBe(0);
    expect(await count("plot_assignments")).toBe(0);
    expect(await count("greenhouses")).toBe(0);
  });

  it("createAccount logs exactly one creation row with the creation time", async () => {
    const { db, count } = await setup();
    expect(await count("account_creations")).toBe(1);
    const row = await db
      .prepare("SELECT created_at FROM account_creations")
      .first<{ created_at: number }>();
    expect(row?.created_at).toBe(1);
  });

  it("createAccount is atomic: a failed account insert logs nothing", async () => {
    const { db, count } = await setup();
    await expect(
      createAccount(db, { id: "a1", codeHash: "h2", link: LINK, now: 5 }),
    ).rejects.toThrow();
    expect(await count("accounts")).toBe(1);
    expect(await count("account_creations")).toBe(1);
  });

  it("deleteAccount leaves account_creations intact", async () => {
    const { db, count } = await setup();
    await deleteAccount(db, "a1");
    expect(await count("accounts")).toBe(0);
    expect(await count("account_creations")).toBe(1);
  });
});
