import levelData from "../../../data/player-levels.json";
import { getAchievement } from "./achievements";
import { asArray, asNumber, asRecord } from "./coerce";
import {
  QUEST_KEEP_DAYS,
  QUEST_KINDS,
  QUESTS_PER_DAY,
  addDays,
  questXp,
  type QuestKind,
  type QuestRecord,
} from "./quests";
import type { SyncOp } from "./sync";

const LEVELS = levelData as {
  maxLevel: number;
  xpToNext: { base: number; perLevel: number };
};
export const MAX_PLAYER_LEVEL: number = LEVELS.maxLevel;
const MAX_DONE_DAYS = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ProgressArchive {
  xp: number;
  doneQuests: number;
  doneDays: string[];
}
export interface UnlockedAchievement {
  at: number;
  xp: number;
}
export interface ProgressData {
  quests: QuestRecord[];
  achievements: Record<string, UnlockedAchievement>;
  archive: ProgressArchive;
}

export const EMPTY_PROGRESS: ProgressData = {
  quests: [],
  achievements: {},
  archive: { xp: 0, doneQuests: 0, doneDays: [] },
};

function isKind(value: unknown): value is QuestKind {
  return (QUEST_KINDS as readonly unknown[]).includes(value);
}
function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseParams(raw: unknown): Record<string, string | number> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || isNum(value)) out[key] = value;
    else return null;
  }
  return out;
}

export function parseQuestRecord(raw: unknown): QuestRecord | null {
  const r = asRecord(raw);
  const { kind, day, slot, createdAt, expiresAt, doneAt, baseline } = r;
  if (!isKind(kind)) return null;
  if (typeof day !== "string" || !DAY_RE.test(day)) return null;
  if (!isNum(slot) || !Number.isInteger(slot)) return null;
  if (slot < 0 || slot >= QUESTS_PER_DAY) return null;
  if (!isNum(createdAt) || !isNum(expiresAt)) return null;
  if (doneAt !== null && !isNum(doneAt)) return null;
  if (baseline !== null && !isNum(baseline)) return null;
  const params = parseParams(r.params);
  if (params === null) return null;
  if (kind === "serve_visitors" || kind === "gain_garden_xp") {
    const target = params.target;
    if (typeof target !== "number" || target <= 0) return null;
  }
  return {
    day,
    slot,
    kind,
    params,
    baseline,
    createdAt,
    expiresAt,
    doneAt,
    xp: questXp(kind),
  };
}

function sanitizeDoneDays(days: unknown): string[] {
  const valid = asArray(days).filter(
    (d): d is string => typeof d === "string" && DAY_RE.test(d),
  );
  return [...new Set(valid)].sort().slice(-MAX_DONE_DAYS);
}

export function sanitizeProgress(raw: unknown): ProgressData {
  const r = asRecord(raw);
  const seen = new Set<string>();
  const quests: QuestRecord[] = [];
  for (const item of asArray(r.quests)) {
    const rec = parseQuestRecord(item);
    if (rec === null) continue;
    const key = `${rec.day}|${rec.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    quests.push(rec);
  }
  const achievements: Record<string, UnlockedAchievement> = {};
  const rawAchievements = asRecord(r.achievements);
  for (const [id, value] of Object.entries(rawAchievements)) {
    if (!Object.hasOwn(rawAchievements, id)) continue;
    const def = getAchievement(id);
    const a = asRecord(value);
    if (def !== undefined && isNum(a.at)) {
      achievements[id] = { at: a.at, xp: def.xp };
    }
  }
  const arch = asRecord(r.archive);
  return {
    quests,
    achievements,
    archive: {
      xp: Math.max(0, asNumber(arch.xp)),
      doneQuests: Math.floor(Math.max(0, asNumber(arch.doneQuests))),
      doneDays: sanitizeDoneDays(arch.doneDays),
    },
  };
}

export function addQuests(
  p: ProgressData,
  records: readonly QuestRecord[],
): ProgressData {
  const seen = new Set(p.quests.map((q) => `${q.day}|${q.slot}`));
  const added: QuestRecord[] = [];
  for (const rec of records) {
    const key = `${rec.day}|${rec.slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(rec);
  }
  if (added.length === 0) return p;
  return { ...p, quests: [...p.quests, ...added] };
}

export function completeQuest(
  p: ProgressData,
  day: string,
  slot: number,
  at: number,
): ProgressData {
  const target = p.quests.find((q) => q.day === day && q.slot === slot);
  if (target === undefined || target.doneAt !== null) return p;
  return {
    ...p,
    quests: p.quests.map((q) => (q === target ? { ...q, doneAt: at } : q)),
  };
}

export function unlockAchievement(
  p: ProgressData,
  id: string,
  at: number,
  xp: number,
): ProgressData {
  if (Object.prototype.hasOwnProperty.call(p.achievements, id)) return p;
  return { ...p, achievements: { ...p.achievements, [id]: { at, xp } } };
}

export function compactProgress(p: ProgressData, today: string): ProgressData {
  const cutoff = addDays(today, -QUEST_KEEP_DAYS);
  const old = p.quests.filter((q) => q.day < cutoff);
  if (old.length === 0) return p;
  const done = old.filter((q) => q.doneAt !== null);
  const days = [...new Set([...p.archive.doneDays, ...done.map((q) => q.day)])]
    .sort()
    .slice(-MAX_DONE_DAYS);
  return {
    ...p,
    quests: p.quests.filter((q) => q.day >= cutoff),
    archive: {
      xp: p.archive.xp + done.reduce((sum, q) => sum + q.xp, 0),
      doneQuests: p.archive.doneQuests + done.length,
      doneDays: days,
    },
  };
}

export interface ProgressSummary {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNext: number | null;
  streak: number;
  bestStreak: number;
  atRisk: boolean;
  doneToday: boolean;
  doneQuests: number;
}

export function summarizeProgress(
  p: ProgressData,
  today: string,
): ProgressSummary {
  const done = p.quests.filter((q) => q.doneAt !== null);
  const days = new Set([...p.archive.doneDays, ...done.map((q) => q.day)]);
  const xp =
    p.archive.xp +
    done.reduce((sum, q) => sum + q.xp, 0) +
    Object.values(p.achievements).reduce((sum, a) => sum + a.xp, 0);

  let level = 1;
  let rest = xp;
  while (level < MAX_PLAYER_LEVEL) {
    const need = LEVELS.xpToNext.base + LEVELS.xpToNext.perLevel * level;
    if (rest < need) break;
    rest -= need;
    level++;
  }
  const xpForNext =
    level >= MAX_PLAYER_LEVEL
      ? null
      : LEVELS.xpToNext.base + LEVELS.xpToNext.perLevel * level;

  const doneToday = days.has(today);
  const yesterday = addDays(today, -1);
  let cursor = doneToday ? today : days.has(yesterday) ? yesterday : null;
  let streak = 0;
  while (cursor !== null && days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sorted) {
    run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }

  return {
    xp,
    level,
    xpIntoLevel: rest,
    xpForNext,
    streak,
    bestStreak: Math.max(best, streak),
    atRisk: streak > 0 && !doneToday,
    doneToday,
    doneQuests: p.archive.doneQuests + done.length,
  };
}

/** Ops that turn `prev` into `next` (append-only; compaction produces none). */
export function progressOps(prev: ProgressData, next: ProgressData): SyncOp[] {
  if (prev === next) return [];
  const ops: SyncOp[] = [];
  const old = new Map(prev.quests.map((q) => [`${q.day}|${q.slot}`, q]));
  const created = new Map<string, QuestRecord[]>();
  for (const q of next.quests) {
    const before = old.get(`${q.day}|${q.slot}`);
    if (before === undefined) {
      created.set(q.day, [...(created.get(q.day) ?? []), q]);
    }
  }
  for (const [day, quests] of created)
    ops.push({ t: "setQuests", day, quests });
  for (const q of next.quests) {
    const before = old.get(`${q.day}|${q.slot}`);
    // A record created and done in the same diff also needs its completion.
    if (q.doneAt !== null && (before === undefined || before.doneAt === null)) {
      ops.push({
        t: "completeQuest",
        day: q.day,
        slot: q.slot,
        kind: q.kind,
        at: q.doneAt,
      });
    }
  }
  for (const [id, a] of Object.entries(next.achievements)) {
    if (!Object.hasOwn(prev.achievements, id)) {
      ops.push({ t: "unlockAchievement", id, at: a.at, xp: a.xp });
    }
  }
  return ops;
}
