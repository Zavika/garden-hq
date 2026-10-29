import alertData from "../../../data/alerts.json";
import {
  composterAlarm,
  contestsStartingWithin,
  cropName,
  greenhousesDue,
  myCropIds,
  visitorsAtLeast,
} from "./detect";
import type { PlannerInput } from "./planner";
import { getPlot } from "./plots";

export const ALERT_TYPES = [
  "contest_soon",
  "composter_fuel_out",
  "composter_fuel_low",
  "visitors_waiting",
  "greenhouse_water",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertParam = "leadMinutes" | "threshold";

export interface AlertRule {
  enabled: boolean;
  leadMinutes?: number;
  threshold?: number;
}
export type AlertRules = Record<AlertType, AlertRule>;

interface AlertData {
  enabledAfterTest: AlertType[];
  rules: Record<AlertType, Partial<Record<AlertParam, number>>>;
  bounds: Record<AlertParam, { min: number; max: number }>;
  sync: {
    baselineMinutes: number;
    soonMinutes: number;
    soonHorizonMinutes: number;
  };
}
const DATA = alertData as AlertData;

const MINUTE = 60_000;

export const ALERT_BOUNDS: Record<AlertParam, { min: number; max: number }> =
  DATA.bounds;

export function alertParam(type: AlertType): AlertParam | null {
  const keys = Object.keys(DATA.rules[type]);
  return keys.length === 0 ? null : (keys[0] as AlertParam);
}

export function defaultAlertRules(enabledAfterTest: boolean): AlertRules {
  const entries = ALERT_TYPES.map(
    (type) =>
      [
        type,
        {
          enabled: enabledAfterTest && DATA.enabledAfterTest.includes(type),
          ...DATA.rules[type],
        },
      ] as const,
  );
  return Object.fromEntries(entries) as AlertRules;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAlertType(v: string): v is AlertType {
  return (ALERT_TYPES as readonly string[]).includes(v);
}

export type ParsedRules =
  { ok: true; rules: AlertRules } | { ok: false; error: string };

/** Strict: unknown rules/fields and out-of-range values are errors, never clamped. */
export function parseAlertRules(raw: unknown, base: AlertRules): ParsedRules {
  if (!isObject(raw)) return { ok: false, error: "rules must be an object" };
  const next: AlertRules = { ...base };

  for (const [type, patch] of Object.entries(raw)) {
    if (!isAlertType(type)) {
      return { ok: false, error: `Unknown alert type: ${type.slice(0, 40)}` };
    }
    if (!isObject(patch)) {
      return { ok: false, error: `${type} must be an object` };
    }
    const rule: AlertRule = { ...base[type] };
    for (const [field, value] of Object.entries(patch)) {
      if (field === "enabled") {
        if (typeof value !== "boolean") {
          return { ok: false, error: `${type}.enabled must be true or false` };
        }
        rule.enabled = value;
        continue;
      }
      if (field !== alertParam(type)) {
        return {
          ok: false,
          error: `${type} has no setting ${field.slice(0, 40)}`,
        };
      }
      const { min, max } = ALERT_BOUNDS[field];
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < min ||
        value > max
      ) {
        return {
          ok: false,
          error: `${type}.${field} must be a whole number from ${min} to ${max}`,
        };
      }
      rule[field] = value;
    }
    next[type] = rule;
  }
  return { ok: true, rules: next };
}

export interface AlertCandidate {
  type: AlertType;
  /** Unique per (account, type); the alert_log dedupe key. */
  key: string;
  title: string;
  detail: string;
  dueAt: number | null;
}

export interface AlertInput extends PlannerInput {
  rules: AlertRules;
}

function minutesUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / MINUTE));
}

function lead(
  rules: AlertRules,
  type: "contest_soon" | "composter_fuel_low",
): number {
  return rules[type].leadMinutes ?? DATA.rules[type].leadMinutes ?? 0;
}

export function deriveAlerts(input: AlertInput): AlertCandidate[] {
  const { now, garden, contests, assignments, greenhouses, rules } = input;
  const out: AlertCandidate[] = [];

  if (rules.contest_soon.enabled) {
    const mine = myCropIds(assignments, garden.unlockedPlotIds);
    for (const { contest, matching } of contestsStartingWithin(
      contests,
      mine,
      now,
      lead(rules, "contest_soon"),
    )) {
      out.push({
        type: "contest_soon",
        key: String(contest.startsAt),
        title: `${matching.map(cropName).join(", ")} contest starts in ${minutesUntil(contest.startsAt, now)} min`,
        detail: "A crop you have planted is in the next Jacob's Contest.",
        dueAt: contest.startsAt,
      });
    }
  }

  if (rules.composter_fuel_out.enabled || rules.composter_fuel_low.enabled) {
    const alarm = composterAlarm(
      garden.composter,
      now,
      lead(rules, "composter_fuel_low"),
    );
    if (alarm?.kind === "no_fuel" && rules.composter_fuel_out.enabled) {
      out.push({
        type: "composter_fuel_out",
        key: String(alarm.lastSave),
        title: "Composter is out of fuel",
        detail: "Add fuel so it keeps making Compost.",
        dueAt: null,
      });
    }
    if (alarm?.kind === "fuel_low" && rules.composter_fuel_low.enabled) {
      out.push({
        type: "composter_fuel_low",
        key: String(alarm.lastSave),
        title: `Composter fuel runs out in ${minutesUntil(alarm.stopsAt, now)} min`,
        detail: "Top up fuel before it stops.",
        dueAt: alarm.stopsAt,
      });
    }
  }

  if (rules.visitors_waiting.enabled) {
    const visitors = visitorsAtLeast(
      garden.visitors,
      rules.visitors_waiting.threshold ??
        DATA.rules.visitors_waiting.threshold ??
        1,
    );
    if (visitors.length > 0) {
      out.push({
        type: "visitors_waiting",
        key: visitors
          .map((v) => v.id)
          .sort()
          .join(","),
        title: `${visitors.length} visitors waiting`,
        detail: visitors.map((v) => v.name).join(", "),
        dueAt: null,
      });
    }
  }

  if (rules.greenhouse_water.enabled) {
    for (const { plotId, lastWateredAt, dueAt } of greenhousesDue(
      greenhouses,
      now,
      0,
    )) {
      const plotNumber = getPlot(plotId)?.plotNumber;
      out.push({
        type: "greenhouse_water",
        key: `${plotId}:${lastWateredAt}`,
        title: `Water the Greenhouse${plotNumber === undefined ? "" : ` (plot ${plotNumber})`}`,
        detail: "Watering is due now.",
        dueAt,
      });
    }
  }

  return out;
}

/**
 * When the cron should look at this account again: the baseline, or the short
 * interval when an alert is due to fire within the horizon. Only events whose
 * rule is on count, and only ones still in the future (an alert that is already
 * due has been claimed this run).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the public signature (see doc comment)
export function nextSyncAt(input: AlertInput, _fetchedAt: number): number {
  const { now, garden, contests, assignments, greenhouses, rules } = input;
  const { baselineMinutes, soonMinutes, soonHorizonMinutes } = DATA.sync;

  const contestLead = lead(rules, "contest_soon");
  const mine = myCropIds(assignments, garden.unlockedPlotIds);
  const contestSoon =
    rules.contest_soon.enabled &&
    contestsStartingWithin(
      contests,
      mine,
      now,
      contestLead + soonHorizonMinutes,
    ).some(({ contest }) => contest.startsAt - contestLead * MINUTE > now);

  const fuelSoon =
    (rules.composter_fuel_out.enabled || rules.composter_fuel_low.enabled) &&
    composterAlarm(garden.composter, now, soonHorizonMinutes)?.kind ===
      "fuel_low";

  const waterSoon =
    rules.greenhouse_water.enabled &&
    greenhousesDue(greenhouses, now, soonHorizonMinutes).some(
      (d) => d.dueAt > now,
    );

  const minutes =
    contestSoon || fuelSoon || waterSoon ? soonMinutes : baselineMinutes;
  return now + minutes * MINUTE;
}
