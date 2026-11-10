import gardenLevels from "../../../data/garden-levels.json";
import questData from "../../../data/quests.json";
import { ALL_MUTATIONS } from "./greenhouse-data";
import { cheapestNextPlot, getPlot } from "./plots";
import { DEFAULT_TIME_ZONE } from "./sync";
import type { Contest, GardenMemberState, GardenState } from "./types";

export const QUEST_KINDS = [
  "serve_visitors",
  "gain_garden_xp",
  "unlock_plot",
  "discover_mutation",
  "analyze_mutation",
  "water_greenhouse",
  "contest_crop",
] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

interface PlainKindData {
  xp: number;
}
interface CounterKindData extends PlainKindData {
  min: number;
  max: number;
}
interface GardenXpKindData extends CounterKindData {
  percentOfNextLevel: number;
  roundTo: number;
}
interface QuestData {
  questsPerDay: number;
  resetHour: number;
  freshMinutes: number;
  skewMinutes: number;
  maxContestEntries: number;
  keepDays: number;
  unlockMaxShortfall: number;
  kinds: {
    serve_visitors: CounterKindData;
    gain_garden_xp: GardenXpKindData;
    unlock_plot: PlainKindData;
    discover_mutation: PlainKindData;
    analyze_mutation: PlainKindData;
    water_greenhouse: PlainKindData;
    contest_crop: PlainKindData;
  };
}
const DATA = questData as QuestData;
const LEVELS = gardenLevels as { level: number; xpRequired: number }[];

export const QUESTS_PER_DAY: number = DATA.questsPerDay;
export const QUEST_KEEP_DAYS: number = DATA.keepDays;
const FRESH_MS = DATA.freshMinutes * 60_000;
/** Tolerated device clock lag behind the Worker clock that stamps snapshots. */
export const SKEW_MS = DATA.skewMinutes * 60_000;
export const MAX_CONTEST_ENTRIES: number = DATA.maxContestEntries;
const HOUR_MS = 3_600_000;

export function questXp(kind: QuestKind): number {
  return DATA.kinds[kind].xp;
}

export interface QuestRecord {
  day: string;
  slot: number;
  kind: QuestKind;
  params: Record<string, string | number>;
  baseline: number | null;
  createdAt: number;
  expiresAt: number;
  doneAt: number | null;
  xp: number;
}

export interface QuestContext {
  now: number;
  timeZone: string;
  seed: string;
  profileId: string;
  garden: GardenState;
  gardenFetchedAt: number;
  member: GardenMemberState | null;
  memberFetchedAt: number | null;
  greenhouses: Record<string, { lastWateredAt: number | null }>;
  contests: Contest[];
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function getDayFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dayFormatters.get(timeZone);
  if (!fmt) {
    // Throws on an invalid zone; only cached after successful construction.
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function formatDay(ms: number, timeZone: string): string {
  const parts = getDayFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Local calendar date, shifted by the reset hour so the day rolls over at the reset. */
export function dayKey(now: number, timeZone: string): string {
  const shifted = now - DATA.resetHour * HOUR_MS;
  try {
    return formatDay(shifted, timeZone);
  } catch {
    return formatDay(shifted, DEFAULT_TIME_ZONE);
  }
}

/** First instant whose day key differs from `now`'s (binary search keeps it DST-safe). */
export function nextResetMs(now: number, timeZone: string): number {
  const current = dayKey(now, timeZone);
  let lo = now;
  let hi = now + 26 * HOUR_MS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(mid, timeZone) === current) lo = mid;
    else hi = mid;
  }
  return hi;
}

function utcMs(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(day: string, delta: number): string {
  return new Date(utcMs(day) + delta * 86_400_000).toISOString().slice(0, 10);
}

export function isFreshSnapshot(
  fetchedAt: number | null,
  now: number,
): boolean {
  return (
    fetchedAt !== null &&
    Number.isFinite(fetchedAt) &&
    fetchedAt <= now + SKEW_MS &&
    now - fetchedAt <= FRESH_MS
  );
}

function xpToNextGardenLevel(level: number): number | null {
  return LEVELS.find((entry) => entry.level === level + 1)?.xpRequired ?? null;
}

export function eligibleKinds(
  ctx: QuestContext,
  expiresAt: number,
): QuestKind[] {
  const { garden, member } = ctx;
  const out: QuestKind[] = ["serve_visitors"];
  if (xpToNextGardenLevel(garden.level) !== null) out.push("gain_garden_xp");
  const plot = cheapestNextPlot(garden.unlockedPlotIds, garden.level);
  if (
    plot !== undefined &&
    plot.cost <= garden.composter.compostUnits + DATA.unlockMaxShortfall
  ) {
    out.push("unlock_plot");
  }
  const memberOk =
    member !== null && isFreshSnapshot(ctx.memberFetchedAt, ctx.now);
  if (member !== null && memberOk) {
    if (
      member.hasGreenhouse &&
      member.discoveredMutations.length < ALL_MUTATIONS.length
    ) {
      out.push("discover_mutation");
    }
    if (member.analyzedMutations.length < member.discoveredMutations.length) {
      out.push("analyze_mutation");
    }
  }
  if (Object.keys(ctx.greenhouses).length > 0) out.push("water_greenhouse");
  if (
    memberOk &&
    ctx.contests.some((c) => c.startsAt > ctx.now && c.startsAt < expiresAt)
  ) {
    out.push("contest_crop");
  }
  return out;
}

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

function buildRecord(
  kind: QuestKind,
  slot: number,
  day: string,
  expiresAt: number,
  ctx: QuestContext,
  rand: () => number,
): QuestRecord {
  const base = {
    day,
    slot,
    kind,
    createdAt: ctx.now,
    expiresAt,
    doneAt: null,
    xp: questXp(kind),
  };
  const { garden, member } = ctx;
  switch (kind) {
    case "serve_visitors": {
      const { min, max } = DATA.kinds.serve_visitors;
      return {
        ...base,
        params: { target: min + Math.floor(rand() * (max - min + 1)) },
        baseline: garden.visitorsServedTotal,
      };
    }
    case "gain_garden_xp": {
      const next = xpToNextGardenLevel(garden.level) ?? 0;
      const { percentOfNextLevel, roundTo, min, max } =
        DATA.kinds.gain_garden_xp;
      const raw =
        Math.round((next * percentOfNextLevel) / 100 / roundTo) * roundTo;
      const target = Math.min(max, Math.max(min, raw));
      return { ...base, params: { target }, baseline: garden.experience };
    }
    case "unlock_plot": {
      const plot = cheapestNextPlot(garden.unlockedPlotIds, garden.level);
      return { ...base, params: { plotId: plot?.id ?? "" }, baseline: null };
    }
    case "discover_mutation":
      return {
        ...base,
        params: {},
        baseline: member?.discoveredMutations.length ?? 0,
      };
    case "analyze_mutation":
      return {
        ...base,
        params: {},
        baseline: member?.analyzedMutations.length ?? 0,
      };
    case "water_greenhouse":
    case "contest_crop":
      return { ...base, params: {}, baseline: null };
  }
}

export function generateQuests(ctx: QuestContext): QuestRecord[] {
  const day = dayKey(ctx.now, ctx.timeZone);
  const expiresAt = nextResetMs(ctx.now, ctx.timeZone);
  const rand = seededRandom(`${ctx.seed}|${day}`);
  return shuffle(eligibleKinds(ctx, expiresAt), rand)
    .slice(0, QUESTS_PER_DAY)
    .map((kind, slot) => buildRecord(kind, slot, day, expiresAt, ctx, rand))
    .map((record) => ({
      ...record,
      params: { ...record.params, profileId: ctx.profileId },
    }));
}

export function questTitle(record: QuestRecord): (string | number)[] {
  const target = Number(record.params.target ?? 0);
  switch (record.kind) {
    case "serve_visitors":
      return ["Serve ", target, " visitors"];
    case "gain_garden_xp":
      return ["Earn ", target, " Garden XP"];
    case "unlock_plot": {
      const plot = getPlot(String(record.params.plotId ?? ""));
      return plot === undefined
        ? ["Unlock a new plot"]
        : ["Unlock plot ", plot.plotNumber];
    }
    case "discover_mutation":
      return ["Discover a new Greenhouse mutation"];
    case "analyze_mutation":
      return ["Analyze a Greenhouse mutation"];
    case "water_greenhouse":
      return ["Water the Greenhouse"];
    case "contest_crop":
      return ["Farm in a Jacob's Contest"];
  }
}

export function questProgress(
  record: QuestRecord,
  garden: GardenState,
): { current: number; target: number } | null {
  const target = Number(record.params.target ?? 0);
  if (record.baseline === null || target <= 0) return null;
  let value: number;
  if (record.kind === "serve_visitors") value = garden.visitorsServedTotal;
  else if (record.kind === "gain_garden_xp") value = garden.experience;
  else return null;
  return {
    current: Math.min(target, Math.max(0, value - record.baseline)),
    target,
  };
}
