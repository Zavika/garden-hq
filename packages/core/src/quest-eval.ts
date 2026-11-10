import { SKEW_MS, dayKey, type QuestContext, type QuestRecord } from "./quests";

export interface QuestCompletion {
  day: string;
  slot: number;
  at: number;
}

type EvalContext = Pick<
  QuestContext,
  | "now"
  | "timeZone"
  | "profileId"
  | "garden"
  | "gardenFetchedAt"
  | "member"
  | "memberFetchedAt"
  | "greenhouses"
>;

function snapshotAt(
  fetchedAt: number | null,
  record: QuestRecord,
  now: number,
): number | null {
  if (fetchedAt === null || !Number.isFinite(fetchedAt)) return null;
  if (fetchedAt > now + SKEW_MS || fetchedAt >= record.expiresAt) return null;
  return Math.min(Math.max(fetchedAt, record.createdAt), now);
}

function completionTime(record: QuestRecord, ctx: EvalContext): number | null {
  const { garden, member } = ctx;
  const target = Number(record.params.target);
  const validTarget = Number.isFinite(target) && target > 0;
  switch (record.kind) {
    case "serve_visitors":
      return validTarget &&
        record.baseline !== null &&
        garden.visitorsServedTotal >= record.baseline + target
        ? snapshotAt(ctx.gardenFetchedAt, record, ctx.now)
        : null;
    case "gain_garden_xp":
      return validTarget &&
        record.baseline !== null &&
        garden.experience >= record.baseline + target
        ? snapshotAt(ctx.gardenFetchedAt, record, ctx.now)
        : null;
    case "unlock_plot":
      return garden.unlockedPlotIds.includes(String(record.params.plotId ?? ""))
        ? snapshotAt(ctx.gardenFetchedAt, record, ctx.now)
        : null;
    case "discover_mutation":
      return member !== null &&
        record.baseline !== null &&
        member.discoveredMutations.length > record.baseline
        ? snapshotAt(ctx.memberFetchedAt, record, ctx.now)
        : null;
    case "analyze_mutation":
      return member !== null &&
        record.baseline !== null &&
        member.analyzedMutations.length > record.baseline
        ? snapshotAt(ctx.memberFetchedAt, record, ctx.now)
        : null;
    case "water_greenhouse": {
      const times = Object.values(ctx.greenhouses)
        .map((g) => g.lastWateredAt)
        .filter(
          (t): t is number =>
            t !== null &&
            t >= record.createdAt &&
            t < record.expiresAt &&
            t <= ctx.now,
        );
      return times.length === 0 ? null : Math.min(...times);
    }
    // VERIFY: contest entries may only appear after a contest ends; see data/VERIFY.md.
    case "contest_crop":
      return member !== null &&
        member.contestEntries.some(
          (e) =>
            e.cropId !== null &&
            e.collected > 0 &&
            e.startsAt >= record.createdAt &&
            e.startsAt < record.expiresAt,
        )
        ? snapshotAt(ctx.memberFetchedAt, record, ctx.now)
        : null;
  }
}

/** Verifies quest records against API snapshots; expired quests are never credited. */
export function evaluateQuests(
  records: readonly QuestRecord[],
  ctx: EvalContext,
): QuestCompletion[] {
  const out: QuestCompletion[] = [];
  const today = dayKey(ctx.now, ctx.timeZone);
  for (const record of records) {
    if (
      record.doneAt !== null ||
      record.day !== today ||
      record.params.profileId !== ctx.profileId ||
      ctx.now < record.createdAt ||
      ctx.now >= record.expiresAt
    )
      continue;
    const at = completionTime(record, ctx);
    if (at !== null) out.push({ day: record.day, slot: record.slot, at });
  }
  return out;
}
