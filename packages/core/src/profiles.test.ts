import { describe, expect, it } from "vitest";
import profilesResponse from "../fixtures/profiles-response.sample.json";
import { normalizeProfiles } from "./profiles";

describe("normalizeProfiles", () => {
  it("lists profiles and picks the selected one", () => {
    expect(normalizeProfiles(profilesResponse)).toEqual({
      profiles: [
        {
          profileId: "22222222-2222-2222-2222-222222222222",
          name: "Apple",
          selected: false,
        },
        {
          profileId: "33333333-3333-3333-3333-333333333333",
          name: "Banana",
          selected: true,
        },
      ],
      selectedProfileId: "33333333-3333-3333-3333-333333333333",
    });
  });

  it("falls back to the first profile when none is flagged selected", () => {
    const result = normalizeProfiles({
      profiles: [
        { profile_id: "aaa", cute_name: "One" },
        { profile_id: "bbb" },
      ],
    });
    expect(result.selectedProfileId).toBe("aaa");
    expect(result.profiles[1]).toEqual({
      profileId: "bbb",
      name: "",
      selected: false,
    });
  });

  it("skips entries without a profile_id", () => {
    const result = normalizeProfiles({
      profiles: [{ cute_name: "NoId" }, "junk", null, { profile_id: "ccc" }],
    });
    expect(result.profiles.map((p) => p.profileId)).toEqual(["ccc"]);
  });

  it("returns an empty result for null / missing / malformed input", () => {
    const empty = { profiles: [], selectedProfileId: null };
    expect(normalizeProfiles(null)).toEqual(empty);
    expect(normalizeProfiles({ success: true, profiles: null })).toEqual(empty);
    expect(normalizeProfiles("nope")).toEqual(empty);
  });
});
