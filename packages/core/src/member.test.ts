import { describe, expect, it } from "vitest";
import member from "../fixtures/member-greenhouse.real.sample.json";
import contestFixture from "../fixtures/member-contests.real.sample.json";
import { contestStartMs } from "./calendar";
import { findProfileMember, normalizeGardenMember } from "./member";

describe("normalizeGardenMember", () => {
  it("reads mutation progress, chip levels and the greenhouse flag from the real capture", () => {
    expect(normalizeGardenMember(member)).toEqual({
      discoveredMutations: [
        "ashwreath",
        "shadevine",
        "dead_plant",
        "dustgrain",
        "lonelily",
      ],
      analyzedMutations: ["ashwreath", "shadevine", "dustgrain"],
      chips: { cropshot: 5, quickdraw: 2 },
      hasGreenhouse: true,
      contestEntries: [],
    });
  });

  it("returns empty values for missing or malformed data", () => {
    const empty = {
      discoveredMutations: [],
      analyzedMutations: [],
      chips: {},
      hasGreenhouse: false,
      contestEntries: [],
    };
    expect(normalizeGardenMember(undefined)).toEqual(empty);
    expect(normalizeGardenMember({})).toEqual(empty);
    expect(
      normalizeGardenMember({
        garden_player_data: { discovered_greenhouse_crops: "x" },
        player_data: { garden_chips: { cropshot: "five", quickdraw: 2 } },
        objectives: { place_a_greenhouse: { status: "ACTIVE" } },
      }),
    ).toEqual({ ...empty, chips: { quickdraw: 2 } });
  });
});

describe("findProfileMember", () => {
  const UUID_PLAIN = "0123456789abcdef0123456789abcdef";
  const UUID_DASHED = "01234567-89ab-cdef-0123-456789abcdef";
  const profiles = {
    profiles: [
      {
        profile_id: "aaaaaaaa-1111-4111-8111-111111111111",
        members: { [UUID_PLAIN]: { marker: "a" } },
      },
      {
        profile_id: "22222222-2222-4222-8222-222222222222",
        members: { [UUID_PLAIN]: { marker: "b" } },
      },
    ],
  };

  it("finds the member of the requested profile for a plain or dashed uuid", () => {
    expect(
      findProfileMember(
        profiles,
        "22222222-2222-4222-8222-222222222222",
        UUID_PLAIN,
      ),
    ).toEqual({ marker: "b" });
    expect(
      findProfileMember(
        profiles,
        "AAAAAAAA-1111-4111-8111-111111111111",
        UUID_DASHED,
      ),
    ).toEqual({ marker: "a" });
  });

  it("returns null for an unknown profile, a missing member or garbage input", () => {
    expect(findProfileMember(profiles, "nope", UUID_PLAIN)).toBeNull();
    expect(
      findProfileMember(
        profiles,
        "22222222-2222-4222-8222-222222222222",
        "f".repeat(32),
      ),
    ).toBeNull();
    expect(findProfileMember(null, "p", "u")).toBeNull();
    expect(findProfileMember({ profiles: "x" }, "p", "u")).toBeNull();
  });
});

describe("contestEntries", () => {
  it("parses keys, maps crop ids and skips malformed keys", () => {
    const { contestEntries } = normalizeGardenMember({
      jacobs_contest: {
        contests: {
          "516:3_6:CACTUS": { collected: 5 },
          "516:3_3:MELON": { collected: 8000 },
          "516:3_9:WEIRD_ID": { collected: 1 },
          "not-a-key": { collected: 1 },
          "516:13_1:MELON": { collected: 1 },
        },
      },
    });
    expect(contestEntries).toEqual([
      {
        startsAt: contestStartMs(516, 3, 3),
        apiCropId: "MELON",
        cropId: "melon",
        collected: 8000,
      },
      {
        startsAt: contestStartMs(516, 3, 6),
        apiCropId: "CACTUS",
        cropId: "cactus",
        collected: 5,
      },
      {
        startsAt: contestStartMs(516, 3, 9),
        apiCropId: "WEIRD_ID",
        cropId: null,
        collected: 1,
      },
    ]);
  });
  it("is empty when the data is missing", () => {
    expect(normalizeGardenMember({}).contestEntries).toEqual([]);
  });
  it("maps every crop id seen on the real profile", () => {
    const { contestEntries } = normalizeGardenMember(contestFixture);
    expect(contestEntries.length).toBeGreaterThanOrEqual(8);
    expect(contestEntries.every((e) => e.cropId !== null)).toBe(true);
  });
});

describe("normalizeGardenMember contest entry cap", () => {
  it("keeps only the newest entries, sorted ascending", () => {
    const contests: Record<string, { collected: number }> = {};
    for (let i = 0; i < 250; i++) {
      const year = 100 + Math.floor(i / 100);
      const month = 1 + (Math.floor(i / 10) % 10);
      const day = 1 + (i % 10);
      contests[`${year}:${month}_${day}:MELON`] = { collected: i + 1 };
    }
    const out = normalizeGardenMember({
      jacobs_contest: { contests },
    }).contestEntries;
    expect(out).toHaveLength(200);
    const times = out.map((e) => e.startsAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(out.at(-1)?.collected).toBe(250);
    expect(out[0]?.collected).toBe(51);
  });
});
