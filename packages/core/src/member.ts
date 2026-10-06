import { asArray, asNumber, asRecord, asString } from "./coerce";
import type { GardenMemberState } from "./types";

function asStringArray(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string",
  );
}

function normalizeChips(raw: unknown): Record<string, number> {
  const chips: Record<string, number> = {};
  for (const [id, level] of Object.entries(asRecord(raw))) {
    if (typeof level === "number" && Number.isFinite(level)) {
      chips[id] = asNumber(level, 0);
    }
  }
  return chips;
}

/**
 * Greenhouse-related slice of a profile member. Field paths come from a real
 * capture (2026-10-06): `garden_player_data.{discovered,analyzed}_greenhouse_crops`
 * hold mutation ids, `player_data.garden_chips` holds chip levels.
 */
export function normalizeGardenMember(raw: unknown): GardenMemberState {
  const member = asRecord(raw);
  const gardenPlayer = asRecord(member.garden_player_data);
  const objectives = asRecord(member.objectives);

  return {
    discoveredMutations: asStringArray(
      gardenPlayer.discovered_greenhouse_crops,
    ),
    analyzedMutations: asStringArray(gardenPlayer.analyzed_greenhouse_crops),
    chips: normalizeChips(asRecord(member.player_data).garden_chips),
    hasGreenhouse:
      asString(asRecord(objectives.place_a_greenhouse).status) === "COMPLETE",
  };
}

function plainUuid(value: string): string {
  return value.replace(/-/g, "").toLowerCase();
}

// VERIFY: filters `/v2/skyblock/profiles` because the singular
// `/v2/skyblock/profile` endpoint is unverified (data/VERIFY.md).
export function findProfileMember(
  raw: unknown,
  profileId: string,
  uuid: string,
): Record<string, unknown> | null {
  const wanted = plainUuid(profileId);
  const memberKey = plainUuid(uuid);

  for (const entry of asArray(asRecord(raw).profiles)) {
    const profile = asRecord(entry);
    if (plainUuid(asString(profile.profile_id)) !== wanted) continue;
    const member = asRecord(profile.members)[memberKey];
    return typeof member === "object" && member !== null
      ? asRecord(member)
      : null;
  }
  return null;
}
