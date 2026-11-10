import { describe, expect, it } from "vitest";
import {
  applyOp,
  applyOps,
  DEFAULT_TIME_ZONE,
  EMPTY_STORED_DATA,
  enqueueOp,
  MAX_GREENHOUSES,
  MAX_OPS_PER_REQUEST,
  opKey,
  parseOps,
  parseOpsLenient,
  planJoin,
  seedOps,
  type StoredData,
  type StoredLink,
  type SyncOp,
} from "./sync";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const LINK: StoredLink = {
  name: "Steve_1",
  uuid: UUID,
  profileId: UUID2,
  profiles: [{ profileId: UUID2, name: "Apple", selected: true }],
};

function data(partial: Partial<StoredData> = {}): StoredData {
  return { ...EMPTY_STORED_DATA, ...partial };
}

function withGh(plots: string[]): StoredData {
  const greenhouses: StoredData["greenhouses"] = {};
  for (const p of plots) {
    greenhouses[p] = {
      cells: {},
      lastWateredAt: null,
      wateringIntervalHours: null,
    };
  }
  return data({ greenhouses });
}

function parseOne(op: unknown) {
  return parseOps([op]);
}

describe("applyOp", () => {
  it("setAssignment sets and clears", () => {
    const a = applyOp(data(), {
      t: "setAssignment",
      plotId: "beginner_1",
      cropId: "wheat",
    });
    expect(a.assignments).toEqual({ beginner_1: "wheat" });
    const b = applyOp(a, {
      t: "setAssignment",
      plotId: "beginner_1",
      cropId: null,
    });
    expect(b.assignments).toEqual({});
  });

  it("setAssignment returns the same object on no-ops", () => {
    const a = data({ assignments: { beginner_1: "wheat" } });
    expect(
      applyOp(a, { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" }),
    ).toBe(a);
    expect(
      applyOp(a, { t: "setAssignment", plotId: "beginner_2", cropId: null }),
    ).toBe(a);
  });

  it("markGreenhouse creates an empty save and is idempotent", () => {
    const a = applyOp(data(), { t: "markGreenhouse", plotId: "beginner_1" });
    expect(a.greenhouses).toEqual({
      beginner_1: {
        cells: {},
        lastWateredAt: null,
        wateringIntervalHours: null,
      },
    });
    expect(applyOp(a, { t: "markGreenhouse", plotId: "beginner_1" })).toBe(a);
  });

  it("markGreenhouse is a no-op at the maximum", () => {
    const full = withGh(["beginner_1", "beginner_2", "beginner_3"]);
    expect(Object.keys(full.greenhouses)).toHaveLength(MAX_GREENHOUSES);
    expect(applyOp(full, { t: "markGreenhouse", plotId: "beginner_4" })).toBe(
      full,
    );
  });

  it("markGreenhouse is a no-op for an unknown plot", () => {
    const d = data();
    expect(applyOp(d, { t: "markGreenhouse", plotId: "nope_1" })).toBe(d);
  });

  it("unmarkGreenhouse removes, and is a no-op when absent", () => {
    const d = withGh(["beginner_1"]);
    const r = applyOp(d, { t: "unmarkGreenhouse", plotId: "beginner_1" });
    expect(r.greenhouses).toEqual({});
    expect(r).not.toBe(d);
    expect(applyOp(r, { t: "unmarkGreenhouse", plotId: "beginner_1" })).toBe(r);
  });

  it("setGreenhouseCell sets and clears a cell", () => {
    const d = withGh(["beginner_1"]);
    const a = applyOp(d, {
      t: "setGreenhouseCell",
      plotId: "beginner_1",
      cellKey: "1,2",
      contentId: "wheat",
    });
    expect(a.greenhouses.beginner_1?.cells).toEqual({ "1,2": "wheat" });
    const b = applyOp(a, {
      t: "setGreenhouseCell",
      plotId: "beginner_1",
      cellKey: "1,2",
      contentId: null,
    });
    expect(b.greenhouses.beginner_1?.cells).toEqual({});
  });

  it("setGreenhouseCell ignores a missing Greenhouse, bad key, bad content", () => {
    const d = withGh(["beginner_1"]);
    expect(
      applyOp(d, {
        t: "setGreenhouseCell",
        plotId: "beginner_2",
        cellKey: "1,2",
        contentId: "wheat",
      }),
    ).toBe(d);
    expect(
      applyOp(d, {
        t: "setGreenhouseCell",
        plotId: "beginner_1",
        cellKey: "10,1",
        contentId: "wheat",
      }),
    ).toBe(d);
    expect(
      applyOp(d, {
        t: "setGreenhouseCell",
        plotId: "beginner_1",
        cellKey: "1,1",
        contentId: "not_a_thing",
      }),
    ).toBe(d);
  });

  it("markGreenhouseWatered sets lastWateredAt", () => {
    const d = withGh(["beginner_1"]);
    const r = applyOp(d, {
      t: "markGreenhouseWatered",
      plotId: "beginner_1",
      at: 1234,
    });
    expect(r.greenhouses.beginner_1?.lastWateredAt).toBe(1234);
    expect(
      applyOp(d, { t: "markGreenhouseWatered", plotId: "beginner_2", at: 1 }),
    ).toBe(d);
  });

  it("setWateringInterval accepts 1, 720, null", () => {
    const d = withGh(["beginner_1"]);
    for (const hours of [1, 720]) {
      const r = applyOp(d, {
        t: "setWateringInterval",
        plotId: "beginner_1",
        hours,
      });
      expect(r.greenhouses.beginner_1?.wateringIntervalHours).toBe(hours);
    }
    const set = applyOp(d, {
      t: "setWateringInterval",
      plotId: "beginner_1",
      hours: 5,
    });
    const cleared = applyOp(set, {
      t: "setWateringInterval",
      plotId: "beginner_1",
      hours: null,
    });
    expect(cleared.greenhouses.beginner_1?.wateringIntervalHours).toBeNull();
  });

  it("setWateringInterval rejects 0, 721 and NaN", () => {
    const d = withGh(["beginner_1"]);
    for (const hours of [0, 721, NaN]) {
      expect(
        applyOp(d, { t: "setWateringInterval", plotId: "beginner_1", hours }),
      ).toBe(d);
    }
  });

  it("setTimeZone and setLink", () => {
    expect(
      applyOp(data(), { t: "setTimeZone", timeZone: "UTC" }).timeZone,
    ).toBe("UTC");
    expect(applyOp(data(), { t: "setLink", link: LINK }).link).toEqual(LINK);
  });

  it("applyOps folds in order", () => {
    const r = applyOps(data(), [
      { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
      { t: "setAssignment", plotId: "beginner_1", cropId: "carrot" },
    ]);
    expect(r.assignments).toEqual({ beginner_1: "carrot" });
  });
});

describe("parseOps", () => {
  it("accepts a valid mixed list and returns normalized copies", () => {
    const raw = [
      { t: "setAssignment", plotId: "beginner_1", cropId: "wheat", extra: 1 },
      { t: "setAssignment", plotId: "beginner_2", cropId: null },
      { t: "markGreenhouse", plotId: "beginner_1" },
      { t: "unmarkGreenhouse", plotId: "beginner_1" },
      {
        t: "setGreenhouseCell",
        plotId: "beginner_1",
        cellKey: "0,9",
        contentId: "wheat",
      },
      { t: "markGreenhouseWatered", plotId: "beginner_1", at: 1000 },
      { t: "setWateringInterval", plotId: "beginner_1", hours: 24 },
      { t: "setWateringInterval", plotId: "beginner_1", hours: null },
      { t: "setTimeZone", timeZone: "Europe/Warsaw" },
      { t: "setLink", link: { ...LINK, junk: true } },
    ];
    const r = parseOps(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toHaveLength(raw.length);
    expect(r.ops[0]).toEqual({
      t: "setAssignment",
      plotId: "beginner_1",
      cropId: "wheat",
    });
    expect(r.ops[9]).toEqual({ t: "setLink", link: LINK });
  });

  it("rejects a non-array", () => {
    expect(parseOps({}).ok).toBe(false);
    expect(parseOps(null).ok).toBe(false);
  });

  it("rejects more than MAX_OPS_PER_REQUEST", () => {
    const op = { t: "setTimeZone", timeZone: "UTC" };
    expect(parseOps(Array(MAX_OPS_PER_REQUEST).fill(op)).ok).toBe(true);
    expect(parseOps(Array(MAX_OPS_PER_REQUEST + 1).fill(op)).ok).toBe(false);
  });

  it("rejects an unknown op type and non-objects", () => {
    expect(parseOne({ t: "explode" }).ok).toBe(false);
    expect(parseOne("x").ok).toBe(false);
    expect(parseOne(null).ok).toBe(false);
  });

  it("reports the index and reason", () => {
    const r = parseOps([
      { t: "markGreenhouse", plotId: "beginner_1" },
      { t: "markGreenhouse", plotId: "beginner_2" },
      { t: "markGreenhouse", plotId: "beginner_3" },
      { t: "markGreenhouse", plotId: "nope_1" },
    ]);
    expect(r).toEqual({ ok: false, error: "op 3: unknown plot" });
  });

  it("rejects an unknown plot id", () => {
    expect(
      parseOne({ t: "setAssignment", plotId: "nope_1", cropId: "wheat" }).ok,
    ).toBe(false);
  });

  it("rejects an unknown crop", () => {
    expect(
      parseOne({ t: "setAssignment", plotId: "beginner_1", cropId: "kale" }).ok,
    ).toBe(false);
  });

  it("rejects a bad cell key and non-placeable content", () => {
    const base = { t: "setGreenhouseCell", plotId: "beginner_1" };
    expect(parseOne({ ...base, cellKey: "10,1", contentId: "wheat" }).ok).toBe(
      false,
    );
    expect(
      parseOne({ ...base, cellKey: "1,1", contentId: "not_a_thing" }).ok,
    ).toBe(false);
    expect(parseOne({ ...base, cellKey: "1,1", contentId: null }).ok).toBe(
      true,
    );
  });

  it("rejects a bad `at`", () => {
    const base = { t: "markGreenhouseWatered", plotId: "beginner_1" };
    for (const at of [NaN, Infinity, -1, 8.64e15 + 1, "5", undefined]) {
      expect(parseOne({ ...base, at }).ok).toBe(false);
    }
    expect(parseOne({ ...base, at: 0 }).ok).toBe(true);
    expect(parseOne({ ...base, at: 8.64e15 }).ok).toBe(true);
  });

  it("rejects an out-of-range interval", () => {
    const base = { t: "setWateringInterval", plotId: "beginner_1" };
    for (const hours of [0, 721, -3, NaN, "4"]) {
      expect(parseOne({ ...base, hours }).ok).toBe(false);
    }
  });

  it("rejects bad time zones", () => {
    for (const timeZone of ["", "x".repeat(65), "Not/AZone", 5]) {
      expect(parseOne({ t: "setTimeZone", timeZone }).ok).toBe(false);
    }
  });

  it("rejects bad links", () => {
    const bad = (patch: Record<string, unknown>) =>
      parseOne({ t: "setLink", link: { ...LINK, ...patch } }).ok;
    expect(bad({ uuid: "nope" })).toBe(false);
    expect(bad({ profileId: "nope" })).toBe(false);
    expect(bad({ name: "has space" })).toBe(false);
    expect(bad({ name: "" })).toBe(false);
    expect(bad({ name: "a".repeat(17) })).toBe(false);
    expect(
      bad({
        profiles: Array.from({ length: 21 }, (_, i) => ({
          profileId: String(i),
          name: "n",
          selected: false,
        })),
      }),
    ).toBe(false);
    expect(
      bad({ profiles: [{ profileId: 1, name: "n", selected: true }] }),
    ).toBe(false);
    expect(bad({})).toBe(true);
  });
});

describe("parseOpsLenient", () => {
  it("skips invalid ops, keeps valid ones in order and counts rejections", () => {
    const r = parseOpsLenient([
      { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
      { t: "setAssignment", plotId: "nope_99", cropId: "wheat" },
      "junk",
      { t: "setTimeZone", timeZone: "UTC" },
    ]);
    expect(r).toEqual({
      ok: true,
      ops: [
        { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
        { t: "setTimeZone", timeZone: "UTC" },
      ],
      rejected: 2,
    });
  });

  it("still fails structurally for a non-array or too many ops", () => {
    expect(parseOpsLenient({}).ok).toBe(false);
    const op = { t: "setTimeZone", timeZone: "UTC" };
    expect(parseOpsLenient(Array(MAX_OPS_PER_REQUEST + 1).fill(op)).ok).toBe(
      false,
    );
  });
});

describe("opKey", () => {
  it("builds keys", () => {
    expect(
      opKey({ t: "setAssignment", plotId: "beginner_1", cropId: null }),
    ).toBe("a:beginner_1");
    expect(
      opKey({
        t: "setGreenhouseCell",
        plotId: "beginner_1",
        cellKey: "1,2",
        contentId: null,
      }),
    ).toBe("c:beginner_1:1,2");
    expect(
      opKey({ t: "markGreenhouseWatered", plotId: "beginner_1", at: 1 }),
    ).toBe("w:beginner_1");
    expect(
      opKey({ t: "setWateringInterval", plotId: "beginner_1", hours: 1 }),
    ).toBe("i:beginner_1");
    expect(opKey({ t: "setTimeZone", timeZone: "UTC" })).toBe("tz");
    expect(opKey({ t: "setLink", link: LINK })).toBe("link");
    expect(opKey({ t: "markGreenhouse", plotId: "beginner_1" })).toBe(
      "g:beginner_1",
    );
    expect(opKey({ t: "unmarkGreenhouse", plotId: "beginner_1" })).toBe(
      "g:beginner_1",
    );
  });
});

describe("enqueueOp", () => {
  const assign = (plotId: string, cropId: string): SyncOp => ({
    t: "setAssignment",
    plotId,
    cropId,
  });
  const cell = (plotId: string, contentId: string | null): SyncOp => ({
    t: "setGreenhouseCell",
    plotId,
    cellKey: "1,1",
    contentId,
  });

  it("collapses two setAssignment for one plot to the last", () => {
    const q = enqueueOp(
      [assign("beginner_1", "wheat")],
      assign("beginner_1", "carrot"),
    );
    expect(q).toEqual([assign("beginner_1", "carrot")]);
  });

  it("keeps ops for different plots", () => {
    const q = enqueueOp(
      [assign("beginner_1", "wheat")],
      assign("beginner_2", "wheat"),
    );
    expect(q).toHaveLength(2);
  });

  it("collapses the same cell", () => {
    const q = enqueueOp(
      [cell("beginner_1", "wheat")],
      cell("beginner_1", null),
    );
    expect(q).toEqual([cell("beginner_1", null)]);
  });

  it("does not collapse across an unmark/mark barrier for the same plot", () => {
    const start: SyncOp[] = [
      cell("beginner_1", "wheat"),
      { t: "unmarkGreenhouse", plotId: "beginner_1" },
      { t: "markGreenhouse", plotId: "beginner_1" },
    ];
    const q = enqueueOp(start, cell("beginner_1", "carrot"));
    expect(q).toHaveLength(4);
    expect(q[0]).toEqual(cell("beginner_1", "wheat"));
  });

  it("does not collapse mark/unmark themselves", () => {
    let q: SyncOp[] = [];
    q = enqueueOp(q, { t: "markGreenhouse", plotId: "beginner_1" });
    q = enqueueOp(q, { t: "unmarkGreenhouse", plotId: "beginner_1" });
    q = enqueueOp(q, { t: "markGreenhouse", plotId: "beginner_1" });
    expect(q).toHaveLength(3);
  });

  it("never mutates the input", () => {
    const input: SyncOp[] = [assign("beginner_1", "wheat")];
    const copy = [...input];
    const out = enqueueOp(input, assign("beginner_1", "carrot"));
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
  });
});

describe("seedOps", () => {
  it("round-trips through applyOps", () => {
    const x = data({
      assignments: { beginner_1: "wheat", beginner_2: "carrot" },
      greenhouses: {
        beginner_3: {
          cells: { "0,0": "wheat", "5,5": "carrot" },
          lastWateredAt: 5000,
          wateringIntervalHours: 12,
        },
      },
      timeZone: "UTC",
    });
    const ops = seedOps(x);
    expect(applyOps(EMPTY_STORED_DATA, ops)).toEqual(x);
    const markIdx = ops.findIndex((o) => o.t === "markGreenhouse");
    const cellIdx = ops.findIndex((o) => o.t === "setGreenhouseCell");
    expect(markIdx).toBeLessThan(cellIdx);
  });

  it("omits the link", () => {
    const ops = seedOps(data({ link: LINK }));
    expect(ops.some((o) => o.t === "setLink")).toBe(false);
  });
});

describe("planJoin", () => {
  it("returns nothing for empty local", () => {
    expect(
      planJoin(
        EMPTY_STORED_DATA,
        data({ assignments: { beginner_1: "wheat" } }),
      ),
    ).toEqual({ ops: [], added: 0, kept: 0 });
  });

  it("adds only assignments missing on the server", () => {
    const local = data({
      assignments: { beginner_1: "wheat", beginner_2: "carrot" },
    });
    const server = data({
      assignments: { beginner_1: "potato", beginner_3: "wheat" },
    });
    const r = planJoin(local, server);
    expect(r.ops).toEqual([
      { t: "setAssignment", plotId: "beginner_2", cropId: "carrot" },
    ]);
    expect(r.added).toBe(1);
    expect(r.kept).toBe(1);
  });

  it("adds a local-only Greenhouse when the server has room", () => {
    const r = planJoin(withGh(["beginner_1"]), withGh(["beginner_2"]));
    expect(r.ops[0]).toEqual({ t: "markGreenhouse", plotId: "beginner_1" });
    expect(r.added).toBe(1);
    expect(r.kept).toBe(0);
  });

  it("skips a local-only Greenhouse when the server already has 3", () => {
    const server = withGh(["beginner_2", "beginner_3", "beginner_4"]);
    expect(planJoin(withGh(["beginner_1"]), server)).toEqual({
      ops: [],
      added: 0,
      kept: 1,
    });
  });

  it("merges a Greenhouse present on both sides", () => {
    const local = data({
      greenhouses: {
        beginner_1: {
          cells: { "0,0": "wheat", "1,1": "carrot", "2,2": "potato" },
          lastWateredAt: 99,
          wateringIntervalHours: 6,
        },
      },
    });
    const server = data({
      greenhouses: {
        beginner_1: {
          cells: { "0,0": "wheat", "1,1": "wheat" },
          lastWateredAt: null,
          wateringIntervalHours: null,
        },
      },
    });
    const r = planJoin(local, server);
    expect(r.ops).toEqual([
      {
        t: "setGreenhouseCell",
        plotId: "beginner_1",
        cellKey: "2,2",
        contentId: "potato",
      },
      { t: "markGreenhouseWatered", plotId: "beginner_1", at: 99 },
      { t: "setWateringInterval", plotId: "beginner_1", hours: 6 },
    ]);
    // added: new cell, watered, interval. kept: the differing cell 1,1.
    expect(r.added).toBe(3);
    expect(r.kept).toBe(1);
  });

  it("keeps the server watered/interval values when it has them", () => {
    const mk = (w: number, h: number) =>
      data({
        greenhouses: {
          beginner_1: { cells: {}, lastWateredAt: w, wateringIntervalHours: h },
        },
      });
    const r = planJoin(mk(1, 2), mk(3, 4));
    expect(r.ops).toEqual([]);
    expect(r.kept).toBe(2);
  });

  it("never produces timeZone or link ops", () => {
    const r = planJoin(
      data({ link: LINK, timeZone: "UTC" }),
      data({ timeZone: DEFAULT_TIME_ZONE }),
    );
    expect(r).toEqual({ ops: [], added: 0, kept: 0 });
  });
});

describe("generic applyOp/applyOps", () => {
  it("preserves extra properties on the input", () => {
    const input = { ...EMPTY_STORED_DATA, extra: 1 };
    const out = applyOp(input, { t: "setTimeZone", timeZone: "UTC" });
    expect(out.extra).toBe(1);
    expect(out.timeZone).toBe("UTC");
    const many = applyOps(input, [{ t: "setTimeZone", timeZone: "UTC" }]);
    expect(many.extra).toBe(1);
  });
});
