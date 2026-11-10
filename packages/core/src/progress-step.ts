import { newlyUnlocked } from "./achievements";
import {
  addQuests,
  compactProgress,
  completeQuest,
  summarizeProgress,
  unlockAchievement,
  type ProgressData,
} from "./progress";
import { evaluateQuests } from "./quest-eval";
import {
  dayKey,
  generateQuests,
  isFreshSnapshot,
  type QuestContext,
} from "./quests";

export interface StepInput extends QuestContext {
  progress: ProgressData;
  assignments: Record<string, string>;
}

export type ProgressEvent =
  | { type: "quest_done"; day: string; slot: number; xp: number }
  | { type: "achievement"; id: string; xp: number }
  | { type: "backfill"; count: number; xp: number };

export interface StepResult {
  progress: ProgressData;
  events: ProgressEvent[];
}

function isEmptyProgress(p: ProgressData): boolean {
  return (
    p.quests.length === 0 &&
    Object.keys(p.achievements).length === 0 &&
    p.archive.doneQuests === 0
  );
}

/** Pure, idempotent progress update; returns `input.progress` when nothing changed. */
export function stepProgress(input: StepInput): StepResult {
  const today = dayKey(input.now, input.timeZone);
  const events: ProgressEvent[] = [];
  let p = compactProgress(input.progress, today);

  // Generating quests never completes them: completion needs a later snapshot.
  if (
    !p.quests.some((q) => q.day === today) &&
    isFreshSnapshot(input.gardenFetchedAt, input.now)
  ) {
    p = addQuests(p, generateQuests(input));
  }

  for (const c of evaluateQuests(p.quests, input)) {
    const record = p.quests.find((q) => q.day === c.day && q.slot === c.slot);
    if (record === undefined) continue;
    const next = completeQuest(p, c.day, c.slot, c.at);
    if (next === p) continue;
    p = next;
    events.push({
      type: "quest_done",
      day: c.day,
      slot: c.slot,
      xp: record.xp,
    });
  }

  const unlocked = newlyUnlocked(
    {
      garden: input.garden,
      member: input.member,
      assignments: input.assignments,
      greenhouses: input.greenhouses,
      summary: summarizeProgress(p, today),
    },
    p.achievements,
  );
  const awarded: { id: string; xp: number }[] = [];
  for (const def of unlocked) {
    const xp = def.xp;
    const next = unlockAchievement(p, def.id, input.now, xp);
    if (next === p) continue;
    p = next;
    awarded.push({ id: def.id, xp });
  }
  if (awarded.length > 0) {
    if (isEmptyProgress(input.progress)) {
      events.push({
        type: "backfill",
        count: awarded.length,
        xp: awarded.reduce((s, a) => s + a.xp, 0),
      });
    } else {
      for (const a of awarded) events.push({ type: "achievement", ...a });
    }
  }

  return { progress: p, events };
}
