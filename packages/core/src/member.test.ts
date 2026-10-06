import { describe, expect, it } from "vitest";
import member from "../fixtures/member-greenhouse.real.sample.json";
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
    });
  });

  it("returns empty values for missing or malformed data", () => {
    const empty = {
      discoveredMutations: [],
      analyzedMutations: [],
      chips: {},
      hasGreenhouse: false,
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
