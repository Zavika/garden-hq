import { describe, expect, it } from "vitest";
import { evaluateQuests } from "./quest-eval";
import type { QuestRecord } from "./quests";
import {
  EXPIRES,
  makeContext,
  makeGarden,
  makeMember,
  NOW,
  PROFILE_ID,
} from "./quest-fixtures";

const DAY = "2026-11-10";
const CREATED = NOW - 3_600_000;

function rec(over: Partial<QuestRecord> = {}): QuestRecord {
  return {
    day: DAY,
    slot: 0,
    kind: "serve_visitors",
    params: { target: 4, profileId: PROFILE_ID },
    baseline: 100,
    createdAt: CREATED,
    expiresAt: EXPIRES,
    doneAt: null,
    xp: 25,
    ...over,
  };
}

const garden = (over: Parameters<typeof makeGarden>[0]) =>
  makeContext({ garden: makeGarden(over) });

describe("evaluateQuests serve_visitors", () => {
  it("is not done below the target", () => {
    expect(
      evaluateQuests([rec()], garden({ visitorsServedTotal: 103 })),
    ).toEqual([]);
  });
  it("completes at the target with the snapshot time", () => {
    expect(
      evaluateQuests([rec()], garden({ visitorsServedTotal: 104 })),
    ).toEqual([{ day: DAY, slot: 0, at: NOW - 60_000 }]);
  });
  it("ignores a lower counter", () => {
    expect(
      evaluateQuests([rec()], garden({ visitorsServedTotal: 99 })),
    ).toEqual([]);
  });
  it("missing or invalid target means not done", () => {
    const badParams: QuestRecord["params"][] = [
      {},
      { target: Number.NaN },
      { target: 0 },
    ];
    for (const params of badParams) {
      expect(
        evaluateQuests(
          [rec({ params }), rec({ params, kind: "gain_garden_xp", slot: 1 })],
          makeContext({
            garden: makeGarden({
              visitorsServedTotal: 10_000,
              experience: 1_000_000,
            }),
          }),
        ),
      ).toEqual([]);
    }
  });
  it("missing baseline means not done", () => {
    expect(
      evaluateQuests(
        [rec({ baseline: null })],
        garden({ visitorsServedTotal: 500 }),
      ),
    ).toEqual([]);
  });
});

describe("evaluateQuests timing", () => {
  const done = { visitorsServedTotal: 104 };
  it("clamps at to createdAt for an older snapshot", () => {
    const ctx = makeContext({
      garden: makeGarden(done),
      gardenFetchedAt: CREATED - 1000,
    });
    expect(evaluateQuests([rec()], ctx)).toEqual([
      { day: DAY, slot: 0, at: CREATED },
    ]);
  });
  it("tolerates a snapshot slightly in the future and clamps at to now", () => {
    const ctx = makeContext({
      garden: makeGarden(done),
      gardenFetchedAt: NOW + 2 * 60_000,
    });
    expect(evaluateQuests([rec()], ctx)).toEqual([
      { day: DAY, slot: 0, at: NOW },
    ]);
  });
  it("rejects a snapshot beyond the clock skew tolerance", () => {
    const ctx = makeContext({
      garden: makeGarden(done),
      gardenFetchedAt: NOW + 6 * 60_000,
    });
    expect(evaluateQuests([rec()], ctx)).toEqual([]);
  });
  it("never credits a record from another profile", () => {
    expect(
      evaluateQuests(
        [
          rec({ params: { target: 4, profileId: "other" } }),
          rec({ slot: 1, params: { target: 4 } }),
        ],
        makeContext({ garden: makeGarden(done) }),
      ),
    ).toEqual([]);
  });
  it("never credits a record whose day is not today's key", () => {
    expect(
      evaluateQuests(
        [rec({ day: "2026-11-11" })],
        makeContext({ garden: makeGarden(done) }),
      ),
    ).toEqual([]);
  });
  it("rejects a snapshot fetched at/after expiry", () => {
    const ctx = makeContext({
      now: EXPIRES - 1,
      garden: makeGarden(done),
      gardenFetchedAt: EXPIRES,
    });
    expect(evaluateQuests([rec()], ctx)).toEqual([]);
  });
  it("skips already done records", () => {
    expect(evaluateQuests([rec({ doneAt: 5 })], garden(done))).toEqual([]);
  });
  it("never credits expired quests", () => {
    const ctx = makeContext({
      now: EXPIRES,
      garden: makeGarden(done),
      gardenFetchedAt: EXPIRES - 1,
    });
    expect(evaluateQuests([rec()], ctx)).toEqual([]);
  });
  it("skips quests not yet created", () => {
    expect(evaluateQuests([rec({ createdAt: NOW + 1 })], garden(done))).toEqual(
      [],
    );
  });
});

describe("evaluateQuests gain_garden_xp", () => {
  const r = rec({
    kind: "gain_garden_xp",
    params: { target: 300, profileId: PROFILE_ID },
    baseline: 1000,
  });
  it("is not done at 1299", () => {
    expect(evaluateQuests([r], garden({ experience: 1299 }))).toEqual([]);
  });
  it("is done at 1300", () => {
    expect(evaluateQuests([r], garden({ experience: 1300 }))).toEqual([
      { day: DAY, slot: 0, at: NOW - 60_000 },
    ]);
  });
});

describe("evaluateQuests unlock_plot", () => {
  const r = rec({
    kind: "unlock_plot",
    params: { plotId: "beginner_3", profileId: PROFILE_ID },
    baseline: null,
  });
  it("is not done without the plot", () => {
    expect(evaluateQuests([r], garden({}))).toEqual([]);
  });
  it("is done with the plot", () => {
    expect(
      evaluateQuests(
        [r],
        garden({ unlockedPlotIds: ["beginner_1", "beginner_3"] }),
      ),
    ).toEqual([{ day: DAY, slot: 0, at: NOW - 60_000 }]);
  });
});

describe.each([
  ["discover_mutation", "discoveredMutations"],
  ["analyze_mutation", "analyzedMutations"],
] as const)("evaluateQuests %s", (kind, field) => {
  const r = rec({ kind, params: { profileId: PROFILE_ID }, baseline: 2 });
  const withCount = (n: number) =>
    makeContext({
      member: makeMember({
        [field]: Array.from({ length: n }, (_, i) => `m${i}`),
      }),
    });
  it("is not done at the baseline", () => {
    expect(evaluateQuests([r], withCount(2))).toEqual([]);
  });
  it("is done above the baseline at memberFetchedAt", () => {
    expect(evaluateQuests([r], withCount(3))).toEqual([
      { day: DAY, slot: 0, at: NOW - 60_000 },
    ]);
  });
  it("is not done without a member", () => {
    expect(evaluateQuests([r], makeContext({ member: null }))).toEqual([]);
  });
  it("is not done without memberFetchedAt", () => {
    expect(
      evaluateQuests([r], { ...withCount(3), memberFetchedAt: null }),
    ).toEqual([]);
  });
});

describe("evaluateQuests water_greenhouse", () => {
  const r = rec({
    kind: "water_greenhouse",
    params: { profileId: PROFILE_ID },
    baseline: null,
  });
  const gh = (...times: (number | null)[]) =>
    makeContext({
      greenhouses: Object.fromEntries(
        times.map((t, i) => [`p${i}`, { lastWateredAt: t }]),
      ),
    });
  it("ignores watering before createdAt", () => {
    expect(evaluateQuests([r], gh(CREATED - 1))).toEqual([]);
  });
  it("ignores watering after now", () => {
    expect(evaluateQuests([r], gh(NOW + 1))).toEqual([]);
  });
  it("completes at the watering time", () => {
    expect(evaluateQuests([r], gh(CREATED + 10))).toEqual([
      { day: DAY, slot: 0, at: CREATED + 10 },
    ]);
  });
  it("counts watering exactly at createdAt and exactly at now", () => {
    expect(evaluateQuests([r], gh(CREATED))).toEqual([
      { day: DAY, slot: 0, at: CREATED },
    ]);
    expect(evaluateQuests([r], gh(NOW))).toEqual([
      { day: DAY, slot: 0, at: NOW },
    ]);
  });
  it("uses the earliest qualifying watering", () => {
    expect(evaluateQuests([r], gh(CREATED + 500, CREATED + 10, null))).toEqual([
      { day: DAY, slot: 0, at: CREATED + 10 },
    ]);
  });
});

describe("evaluateQuests contest_crop", () => {
  const r = rec({
    kind: "contest_crop",
    params: { profileId: PROFILE_ID },
    baseline: null,
  });
  const entry = {
    startsAt: CREATED + 1_000,
    apiCropId: "MELON",
    cropId: "melon" as string | null,
    collected: 8000,
  };
  const withEntry = (over: Partial<typeof entry>) =>
    makeContext({
      member: makeMember({ contestEntries: [{ ...entry, ...over }] }),
    });
  it("ignores contests before createdAt", () => {
    expect(evaluateQuests([r], withEntry({ startsAt: CREATED - 1 }))).toEqual(
      [],
    );
  });
  it("counts a contest starting exactly at createdAt", () => {
    expect(evaluateQuests([r], withEntry({ startsAt: CREATED }))).toEqual([
      { day: DAY, slot: 0, at: NOW - 60_000 },
    ]);
  });
  it("ignores zero collected", () => {
    expect(evaluateQuests([r], withEntry({ collected: 0 }))).toEqual([]);
  });
  it("ignores unmapped crops", () => {
    expect(evaluateQuests([r], withEntry({ cropId: null }))).toEqual([]);
  });
  it("ignores contests starting at/after expiry", () => {
    expect(evaluateQuests([r], withEntry({ startsAt: EXPIRES }))).toEqual([]);
  });
  it("completes with a valid entry at memberFetchedAt", () => {
    expect(evaluateQuests([r], withEntry({}))).toEqual([
      { day: DAY, slot: 0, at: NOW - 60_000 },
    ]);
  });
});

describe("evaluateQuests multiple records", () => {
  it("returns only qualifying ones in record order", () => {
    const ctx = makeContext({
      garden: makeGarden({ visitorsServedTotal: 104 }),
    });
    const records = [
      rec({ slot: 0 }),
      rec({ slot: 1, params: { target: 50, profileId: PROFILE_ID } }),
      rec({ slot: 2, params: { target: 1, profileId: PROFILE_ID } }),
    ];
    expect(evaluateQuests(records, ctx)).toEqual([
      { day: DAY, slot: 0, at: NOW - 60_000 },
      { day: DAY, slot: 2, at: NOW - 60_000 },
    ]);
  });
});
