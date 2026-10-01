import { asArray, asRecord, asString } from "./coerce";
import type { ProfileSummary, ProfilesResult } from "./types";

// VERIFY: field names (`profiles[].profile_id`, `cute_name`, `selected`) come from
// public docs / a reconstructed spec, not a captured /v2/skyblock/profiles response.
export function normalizeProfiles(raw: unknown): ProfilesResult {
  const profiles: ProfileSummary[] = [];

  for (const entry of asArray(asRecord(raw).profiles)) {
    const data = asRecord(entry);
    const profileId = asString(data.profile_id);
    if (profileId === "") continue;

    profiles.push({
      profileId,
      name: asString(data.cute_name),
      selected: data.selected === true,
    });
  }

  const selected = profiles.find((profile) => profile.selected) ?? profiles[0];

  return { profiles, selectedProfileId: selected?.profileId ?? null };
}
