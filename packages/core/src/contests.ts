import cropData from "../../../data/crops.json";
import { asArray, asNumber, asRecord } from "./coerce";
import type { Contest } from "./types";

interface CropEntry {
  id: string;
  name: string;
}

const CROP_ID_BY_NAME = new Map(
  (cropData as CropEntry[]).map((crop) => [crop.name.toLowerCase(), crop.id]),
);

// Timestamps below this are epoch seconds, above are epoch milliseconds.
// VERIFY: EliteBot / Strassburger timestamp units (assumed seconds) and exact
// response shapes (array of { timestamp, crops } vs map keyed by timestamp).
const SECONDS_CUTOFF = 1e12;

function toMs(timestamp: number): number {
  return timestamp < SECONDS_CUTOFF ? timestamp * 1000 : timestamp;
}

function toCropIds(value: unknown): string[] {
  const ids: string[] = [];
  for (const item of asArray(value)) {
    if (typeof item !== "string") continue;
    const id = CROP_ID_BY_NAME.get(item.trim().toLowerCase());
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function rawEntries(
  contests: unknown,
): { timestamp: number; crops: unknown }[] {
  if (Array.isArray(contests)) {
    return contests.map((entry) => {
      const data = asRecord(entry);
      return { timestamp: asNumber(data.timestamp, 0), crops: data.crops };
    });
  }

  return Object.entries(asRecord(contests)).map(([key, crops]) => ({
    timestamp: Number(key),
    crops,
  }));
}

export function normalizeContests(raw: unknown): Contest[] {
  const contests: Contest[] = [];

  for (const { timestamp, crops } of rawEntries(asRecord(raw).contests)) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;

    const cropIds = toCropIds(crops);
    if (cropIds.length === 0) continue;

    contests.push({ startsAt: toMs(timestamp), crops: cropIds });
  }

  return contests.sort((a, b) => a.startsAt - b.startsAt);
}
