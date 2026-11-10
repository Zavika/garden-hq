import { asArray, asNumber, asRecord, asString } from "./coerce";
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, contestStartMs } from "./calendar";
import { ALL_CROPS } from "./crops";
import { MAX_CONTEST_ENTRIES } from "./quests";
import type { ContestEntry, GardenMemberState } from "./types";

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

const CROP_ID_BY_API_ID = new Map(
  ALL_CROPS.flatMap((crop) =>
    crop.apiId === null ? [] : [[crop.apiId, crop.id] as const],
  ),
);
const CONTEST_KEY_RE = /^(\d+):(\d+)_(\d+):(.+)$/;

// VERIFY: Hypixel ids for cactus (CACTUS) and cocoa (INK_SACK:3) are the expected
// ones but were not seen on the one real profile (data/VERIFY.md).
function normalizeContestEntries(raw: unknown): ContestEntry[] {
  const entries: ContestEntry[] = [];
  for (const [key, value] of Object.entries(asRecord(asRecord(raw).contests))) {
    const match = CONTEST_KEY_RE.exec(key);
    if (match === null) continue;
    const [year, month, day] = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ];
    if (month < 1 || month > MONTHS_PER_YEAR || day < 1 || day > DAYS_PER_MONTH)
      continue;
    const apiCropId = match[4] ?? "";
    entries.push({
      startsAt: contestStartMs(year, month, day),
      apiCropId,
      cropId: CROP_ID_BY_API_ID.get(apiCropId) ?? null,
      collected: asNumber(asRecord(value).collected, 0),
    });
  }
  return entries
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(-MAX_CONTEST_ENTRIES);
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
    contestEntries: normalizeContestEntries(member.jacobs_contest),
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
