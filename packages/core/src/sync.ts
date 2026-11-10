import { getCrop } from "./crops";
import { isPlaceableId } from "./greenhouse-data";
import { getPlot } from "./plots";
import type { ProfileSummary } from "./types";

export const MAX_GREENHOUSES = 3;
export const MAX_WATERING_INTERVAL_HOURS = 720;
export const MAX_OPS_PER_REQUEST = 40;
export const DEFAULT_TIME_ZONE = "Europe/Warsaw";
export const CELL_KEY_RE = /^\d,\d$/;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const MAX_PROFILES = 20;
const MAX_TEXT = 64;
const MAX_EPOCH_MS = 8.64e15;

export interface StoredLink {
  name: string;
  uuid: string;
  profileId: string;
  profiles: ProfileSummary[];
}

export interface GreenhouseSave {
  /** Cell key "x,z" -> placed crop or mutation id. */
  cells: Record<string, string>;
  /** Epoch ms of the player's last "I watered it" press, or null. */
  lastWateredAt: number | null;
  /** Player-chosen "water again after N hours"; null until set (no verified default). */
  wateringIntervalHours: number | null;
}

export interface StoredData {
  link: StoredLink | null;
  assignments: Record<string, string>;
  greenhouses: Record<string, GreenhouseSave>;
  timeZone: string;
}

export const EMPTY_STORED_DATA: StoredData = {
  link: null,
  assignments: {},
  greenhouses: {},
  timeZone: DEFAULT_TIME_ZONE,
};

export function validWateringInterval(v: unknown): number | null {
  return typeof v === "number" &&
    Number.isFinite(v) &&
    v > 0 &&
    v <= MAX_WATERING_INTERVAL_HOURS
    ? v
    : null;
}

export type SyncOp =
  | { t: "setAssignment"; plotId: string; cropId: string | null }
  | { t: "markGreenhouse"; plotId: string }
  | { t: "unmarkGreenhouse"; plotId: string }
  | {
      t: "setGreenhouseCell";
      plotId: string;
      cellKey: string;
      contentId: string | null;
    }
  | { t: "markGreenhouseWatered"; plotId: string; at: number }
  | { t: "setWateringInterval"; plotId: string; hours: number | null }
  | { t: "setTimeZone"; timeZone: string }
  | { t: "setLink"; link: StoredLink };

export function applyOp<T extends StoredData>(data: T, op: SyncOp): T {
  switch (op.t) {
    case "setAssignment": {
      if (op.cropId === null) {
        if (!(op.plotId in data.assignments)) return data;
        const assignments = { ...data.assignments };
        delete assignments[op.plotId];
        return { ...data, assignments };
      }
      if (data.assignments[op.plotId] === op.cropId) return data;
      return {
        ...data,
        assignments: { ...data.assignments, [op.plotId]: op.cropId },
      };
    }
    case "markGreenhouse": {
      if (op.plotId in data.greenhouses) return data;
      if (getPlot(op.plotId) === undefined) return data;
      if (Object.keys(data.greenhouses).length >= MAX_GREENHOUSES) return data;
      return {
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [op.plotId]: {
            cells: {},
            lastWateredAt: null,
            wateringIntervalHours: null,
          },
        },
      };
    }
    case "unmarkGreenhouse": {
      if (!(op.plotId in data.greenhouses)) return data;
      const greenhouses = { ...data.greenhouses };
      delete greenhouses[op.plotId];
      return { ...data, greenhouses };
    }
    case "setGreenhouseCell": {
      const save = data.greenhouses[op.plotId];
      if (save === undefined || !CELL_KEY_RE.test(op.cellKey)) return data;
      if (op.contentId !== null && !isPlaceableId(op.contentId)) return data;
      if (op.contentId === null) {
        if (!(op.cellKey in save.cells)) return data;
        const cells = { ...save.cells };
        delete cells[op.cellKey];
        return {
          ...data,
          greenhouses: { ...data.greenhouses, [op.plotId]: { ...save, cells } },
        };
      }
      if (save.cells[op.cellKey] === op.contentId) return data;
      return {
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [op.plotId]: {
            ...save,
            cells: { ...save.cells, [op.cellKey]: op.contentId },
          },
        },
      };
    }
    case "markGreenhouseWatered": {
      const save = data.greenhouses[op.plotId];
      if (save === undefined || save.lastWateredAt === op.at) return data;
      return {
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [op.plotId]: { ...save, lastWateredAt: op.at },
        },
      };
    }
    case "setWateringInterval": {
      const save = data.greenhouses[op.plotId];
      if (save === undefined) return data;
      if (op.hours !== null && validWateringInterval(op.hours) === null) {
        return data;
      }
      if (save.wateringIntervalHours === op.hours) return data;
      return {
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [op.plotId]: { ...save, wateringIntervalHours: op.hours },
        },
      };
    }
    case "setTimeZone":
      return data.timeZone === op.timeZone
        ? data
        : { ...data, timeZone: op.timeZone };
    case "setLink":
      return data.link === op.link ? data : { ...data, link: op.link };
  }
}

export function applyOps<T extends StoredData>(
  data: T,
  ops: readonly SyncOp[],
): T {
  return ops.reduce((acc, op) => applyOp(acc, op), data);
}

// ---------------------------------------------------------------- validation

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_TEXT) {
    return false;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

function parseLink(v: unknown): Parsed<StoredLink> {
  if (!isRecord(v)) return fail("link must be an object");
  const { name, uuid, profileId, profiles } = v;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return fail("bad link name");
  }
  if (typeof uuid !== "string" || !UUID_RE.test(uuid)) {
    return fail("bad link uuid");
  }
  if (typeof profileId !== "string" || !UUID_RE.test(profileId)) {
    return fail("bad link profileId");
  }
  if (!Array.isArray(profiles) || profiles.length > MAX_PROFILES) {
    return fail("bad link profiles");
  }
  const out: ProfileSummary[] = [];
  for (const p of profiles as unknown[]) {
    if (
      !isRecord(p) ||
      typeof p.profileId !== "string" ||
      p.profileId.length > MAX_TEXT ||
      typeof p.name !== "string" ||
      p.name.length > MAX_TEXT ||
      typeof p.selected !== "boolean"
    ) {
      return fail("bad link profile");
    }
    out.push({ profileId: p.profileId, name: p.name, selected: p.selected });
  }
  return { ok: true, value: { name, uuid, profileId, profiles: out } };
}

function parseOp(raw: unknown): Parsed<SyncOp> {
  if (!isRecord(raw) || typeof raw.t !== "string") return fail("not an op");
  const plotId =
    typeof raw.plotId === "string" && getPlot(raw.plotId) !== undefined
      ? raw.plotId
      : null;
  switch (raw.t) {
    case "setAssignment": {
      if (plotId === null) return fail("unknown plot");
      const cropId = raw.cropId;
      if (cropId === null) {
        return { ok: true, value: { t: raw.t, plotId, cropId } };
      }
      if (typeof cropId !== "string" || getCrop(cropId) === undefined) {
        return fail("unknown crop");
      }
      return { ok: true, value: { t: raw.t, plotId, cropId } };
    }
    case "markGreenhouse":
    case "unmarkGreenhouse":
      if (plotId === null) return fail("unknown plot");
      return { ok: true, value: { t: raw.t, plotId } };
    case "setGreenhouseCell": {
      if (plotId === null) return fail("unknown plot");
      const { cellKey, contentId } = raw;
      if (typeof cellKey !== "string" || !CELL_KEY_RE.test(cellKey)) {
        return fail("bad cell key");
      }
      if (
        contentId !== null &&
        (typeof contentId !== "string" || !isPlaceableId(contentId))
      ) {
        return fail("unknown content");
      }
      return {
        ok: true,
        value: { t: raw.t, plotId, cellKey, contentId },
      };
    }
    case "markGreenhouseWatered": {
      if (plotId === null) return fail("unknown plot");
      const at = raw.at;
      if (
        typeof at !== "number" ||
        !Number.isFinite(at) ||
        at < 0 ||
        at > MAX_EPOCH_MS
      ) {
        return fail("bad timestamp");
      }
      return { ok: true, value: { t: raw.t, plotId, at } };
    }
    case "setWateringInterval": {
      if (plotId === null) return fail("unknown plot");
      const hours = raw.hours;
      if (hours !== null && validWateringInterval(hours) === null) {
        return fail("bad interval");
      }
      return {
        ok: true,
        value: { t: raw.t, plotId, hours: hours as number | null },
      };
    }
    case "setTimeZone":
      if (!isValidTimeZone(raw.timeZone)) return fail("bad time zone");
      return { ok: true, value: { t: raw.t, timeZone: raw.timeZone } };
    case "setLink": {
      const link = parseLink(raw.link);
      if (!link.ok) return link;
      return { ok: true, value: { t: raw.t, link: link.value } };
    }
    default:
      return fail("unknown op");
  }
}

export function parseOps(
  raw: unknown,
): { ok: true; ops: SyncOp[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return fail("ops must be an array");
  if (raw.length > MAX_OPS_PER_REQUEST) return fail("too many ops");
  const ops: SyncOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = parseOp(raw[i]);
    if (!r.ok) return fail(`op ${i}: ${r.error}`);
    ops.push(r.value);
  }
  return { ok: true, ops };
}

/**
 * Like parseOps, but an individually invalid op is skipped (and counted)
 * instead of failing the whole request. Only structural errors fail.
 */
export function parseOpsLenient(
  raw: unknown,
):
  { ok: true; ops: SyncOp[]; rejected: number } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return fail("ops must be an array");
  if (raw.length > MAX_OPS_PER_REQUEST) return fail("too many ops");
  const ops: SyncOp[] = [];
  let rejected = 0;
  for (const item of raw as unknown[]) {
    const r = parseOp(item);
    if (r.ok) ops.push(r.value);
    else rejected++;
  }
  return { ok: true, ops, rejected };
}

// --------------------------------------------------------------------- queue

export function opKey(op: SyncOp): string {
  switch (op.t) {
    case "setAssignment":
      return `a:${op.plotId}`;
    case "markGreenhouse":
    case "unmarkGreenhouse":
      return `g:${op.plotId}`;
    case "setGreenhouseCell":
      return `c:${op.plotId}:${op.cellKey}`;
    case "markGreenhouseWatered":
      return `w:${op.plotId}`;
    case "setWateringInterval":
      return `i:${op.plotId}`;
    case "setTimeZone":
      return "tz";
    case "setLink":
      return "link";
  }
}

function plotOf(op: SyncOp): string | null {
  return "plotId" in op ? op.plotId : null;
}

const BARRIERS: ReadonlySet<SyncOp["t"]> = new Set([
  "markGreenhouse",
  "unmarkGreenhouse",
]);

/** Appends `op`, dropping an earlier op that it fully supersedes. Never mutates `queue`. */
export function enqueueOp(queue: readonly SyncOp[], op: SyncOp): SyncOp[] {
  const key = opKey(op);
  const plot = plotOf(op);
  const out = [...queue];
  if (!BARRIERS.has(op.t)) {
    // Walk back; stop at a mark/unmark of the same Greenhouse (ordering matters across it).
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = out[i];
      if (prev === undefined) continue;
      if (plot !== null && plotOf(prev) === plot && BARRIERS.has(prev.t)) break;
      if (opKey(prev) === key) {
        out.splice(i, 1);
        break;
      }
    }
  }
  out.push(op);
  return out;
}

// --------------------------------------------------------------- seed / merge

/** Ops that rebuild `local` (minus the link) on an empty account. */
export function seedOps(local: StoredData): SyncOp[] {
  const ops: SyncOp[] = [{ t: "setTimeZone", timeZone: local.timeZone }];
  for (const [plotId, cropId] of Object.entries(local.assignments)) {
    ops.push({ t: "setAssignment", plotId, cropId });
  }
  for (const [plotId, gh] of Object.entries(local.greenhouses)) {
    ops.push({ t: "markGreenhouse", plotId });
    for (const [cellKey, contentId] of Object.entries(gh.cells)) {
      ops.push({ t: "setGreenhouseCell", plotId, cellKey, contentId });
    }
    if (gh.lastWateredAt !== null) {
      ops.push({ t: "markGreenhouseWatered", plotId, at: gh.lastWateredAt });
    }
    if (gh.wateringIntervalHours !== null) {
      ops.push({
        t: "setWateringInterval",
        plotId,
        hours: gh.wateringIntervalHours,
      });
    }
  }
  return ops;
}

/**
 * Ops that fold `local` into an existing `server` state without overwriting it:
 * the server wins every conflict. Time zone and link never merge.
 */
export function planJoin(
  local: StoredData,
  server: StoredData,
): { ops: SyncOp[]; added: number; kept: number } {
  const ops: SyncOp[] = [];
  let added = 0;
  let kept = 0;

  for (const [plotId, cropId] of Object.entries(local.assignments)) {
    const theirs = server.assignments[plotId];
    if (theirs === undefined) {
      ops.push({ t: "setAssignment", plotId, cropId });
      added++;
    } else if (theirs !== cropId) {
      kept++;
    }
  }

  let serverCount = Object.keys(server.greenhouses).length;
  for (const [plotId, gh] of Object.entries(local.greenhouses)) {
    const theirs = server.greenhouses[plotId];
    let base: GreenhouseSave;
    if (theirs === undefined) {
      if (serverCount >= MAX_GREENHOUSES) {
        kept++;
        continue;
      }
      serverCount++;
      ops.push({ t: "markGreenhouse", plotId });
      added++;
      base = { cells: {}, lastWateredAt: null, wateringIntervalHours: null };
    } else {
      base = theirs;
    }
    for (const [cellKey, contentId] of Object.entries(gh.cells)) {
      const existing = base.cells[cellKey];
      if (existing === undefined) {
        ops.push({ t: "setGreenhouseCell", plotId, cellKey, contentId });
        added++;
      } else if (existing !== contentId) {
        kept++;
      }
    }
    if (gh.lastWateredAt !== null) {
      if (base.lastWateredAt === null) {
        ops.push({
          t: "markGreenhouseWatered",
          plotId,
          at: gh.lastWateredAt,
        });
        added++;
      } else if (base.lastWateredAt !== gh.lastWateredAt) {
        kept++;
      }
    }
    if (gh.wateringIntervalHours !== null) {
      if (base.wateringIntervalHours === null) {
        ops.push({
          t: "setWateringInterval",
          plotId,
          hours: gh.wateringIntervalHours,
        });
        added++;
      } else if (base.wateringIntervalHours !== gh.wateringIntervalHours) {
        kept++;
      }
    }
  }
  return { ops, added, kept };
}
