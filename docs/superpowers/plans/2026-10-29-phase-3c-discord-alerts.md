# Phase 3C — Discord alerts (cron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Worker cron job that checks each opted-in player's Garden every few minutes and posts deduplicated Discord webhook alerts (contest soon, composter out of fuel, optional fuel early warning, visitor queue full, Greenhouse needs water), with a Settings → Alerts section to manage the webhook and every threshold.

**Architecture:** The detection predicates move out of `planner.ts` into a pure `detect.ts` that both `planActions` (UI) and a new `deriveAlerts` (cron) call, so the UI and the cron cannot disagree. A new `runSync(env, deps)` in `apps/worker/src/cron.ts` loads due accounts from D1, reuses or refreshes each account's stored garden snapshot, derives alert candidates, **claims** each one with `INSERT OR IGNORE INTO alert_log` before sending, and posts to Discord only when the claim won. A `Budget` counts every subrequest (fetch + D1 statements + KV) against the free plan's 50-per-invocation limit. Alert settings are managed through new `/api/alerts*` routes authenticated by the same sync code as cloud save.

**Tech Stack:** TypeScript strict, Hono on Cloudflare Workers (Cron Trigger + D1 + KV), React + Vite, vitest (+ Testing Library in `apps/web`), pnpm workspaces. Worker D1 tests run the real SQL against Node's `node:sqlite` through the existing adapter (`apps/worker/test/d1.ts`).

**Spec:** `docs/superpowers/specs/2026-10-07-phase-3-planner-sync-alerts-design.md`, section "C. Discord alerts (cron)", "Free-plan budget", "Hypixel API key (operations note)", "Security and privacy notes" and "Decisions" 4, 5, 7, 11. Read it first. Milestones A (planner) and B (cloud save) are merged and deployed; this plan builds on them.

## Global Constraints

- TypeScript strict everywhere; **no `any` in `packages/core`**.
- Game numbers and thresholds come from `/data/*.json`, never magic numbers in code (CLAUDE.md §9). Worker operating limits (batch size, call caps) are named constants in `apps/worker/src/limits.ts`, where the 3B write budgets already live.
- Every `core` function gets a vitest test; tests use fixtures/fakes, never live API calls (no real Hypixel, no real Discord).
- Free plan only. Limits (verified in the spec on 2026-10-07; re-check before deploy): **50 subrequests per invocation including D1 and KV calls**, **10 ms CPU per invocation including each Cron Trigger run**, 1,000 KV writes/day, D1 100,000 rows written/day, 5 Cron Triggers per account. The cron and the alerts routes must write **nothing to KV** except through the existing shared `contests` cache (≤ 96 writes/day).
- Cron: `*/5 * * * *`, batch **10** accounts, at most **8** Hypixel calls per run, overall subrequest budget **40**, skip refetching when the stored snapshot is **under 5 minutes** old (spec decision 7).
- Alert defaults (spec decision 4): contest lead **5** min; composter alert **once** when fuel hits 0, optional early warning **off by default** (30 min suggested); visitors alert when the queue is **full (5/5)**; Greenhouse alert **only** after the player has set an interval AND pressed "I watered it". **Every threshold is editable in Settings.** No default Greenhouse interval.
- Discord message: one embed per alert, title + one line + "Last synced X min ago". `allowed_mentions: { parse: [] }` so a message can never ping. Webhook URL must match `^https://(discord|discordapp)\.com/api/webhooks/\d+/[\w-]+$` **before it is stored or called** (blocks using the Worker as an SSRF proxy).
- The webhook URL is a secret: stored server-side only, **never returned** (the API says `hasWebhook` plus the last 4 characters), never logged, never in an error message.
- Every alert is deduplicated via `alert_log` (claim first, send only if the insert changed a row). One bad account must not stop the batch.
- Hypixel key: on 401/403 (`bad_api_key` / `missing_api_key`) log `hypixel_key_rejected` (no PII) and **stop the run**. Rotation is documented in the worker README.
- Web push, PWA, `composter_full`, `level_up`, `quest_reset`, `greenhouse_decay`, quests/XP, Discord OAuth: **out of scope**.
- Mobile-first UI; must work at 380 px width. Follow existing component and CSS conventions.
- When a mechanic is uncertain add a `// VERIFY:` comment and an entry in `data/VERIFY.md`.
- Commits end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work on branch `phase-3c-discord-alerts`. Do not push; the owner pushes.
- Run commands from the repo root `C:\Users\azzaw\garden-hq` (Git Bash). Packages: `@garden-hq/core`, `@garden-hq/worker`, `@garden-hq/web`. Per-package: `pnpm --filter <pkg> test -- <file>`, `pnpm --filter <pkg> typecheck`. Before finishing every task also run `pnpm lint` and `pnpm format` (fix with `pnpm format:write`).

## Decisions made in this plan (flag to owner)

1. **Detection lives in new `packages/core/src/detect.ts`; alert logic in new `alerts.ts`.** The spec says `deriveAlerts` goes in `planner.ts`. `planner.ts` is already 250 lines, so it keeps `planActions` and now calls the shared predicates; `deriveAlerts` lives next to its rules and settings. Same sharing guarantee as the spec intends.
2. **`next_sync_at` lives on `alert_settings`, not `garden_snapshot`** (spec has it on the snapshot). An account with no snapshot yet, or whose Hypixel fetch keeps failing, still needs a place to back off; on `garden_snapshot` it would have no row to write to.
3. **Migration `0003_alerts.sql` creates `alert_settings`, `garden_snapshot`, `alert_log`** (3B deferred them, as the spec's header notes).
4. **`webhook_ok` is tri-state:** `NULL` = never tested, `1` = works, `0` = Discord said it is gone (404/401). `alert_settings.rules` is `NULL` until the first successful test message; that test **seeds the four default-on rules** (`contest_soon`, `composter_fuel_out`, `visitors_waiting`, `greenhouse_water`) and leaves `composter_fuel_low` off. This is how I read "defaults are on for none until a webhook is verified by a test message".
5. **Contest dedupe key is `startsAt`** (spec writes `startsAt:cropId`, but also says one alert per contest listing my matching crops; a per-crop key would double-send for a contest matching two of my crops).
6. **Alert rules have their own routes** (`GET/PUT /api/alerts…`), not folded into `GET /api/sync`, so the webhook and rules never ride the sync payload or its ETag. The spec's route table lists only the webhook routes plus "settings, alert rules" under sync; this is the smaller change.
7. **Due-query slack of 60 s** (`CRON_SLACK_MS`). `next_sync_at` is computed from `Date.now()` a few hundred ms after the cron tick, so exactly-5-minute reschedules would otherwise miss the next tick and slip to 10 minutes, breaking the 5-minute contest lead.
8. **Subrequest accounting:** a counting `fetch` wrapper counts real fetches (Hypixel's client may retry up to 3 times per call); every D1 statement in a batch is counted individually (whether a batch counts as one query is unconfirmed, see `data/VERIFY.md` "D1 batch query counting"); before each Hypixel call we require `HYPIXEL_ATTEMPT_RESERVE` (3) spare units.
9. **Inactivity cutoff (60 days) uses `accounts.last_seen_at`.** OWNER-REVISED: any authenticated request (pull or push) counts, but `authenticate` bumps `last_seen_at` at most once per day per account (Task 3 Step 6b), keeping D1 writes low.
10. **A dead webhook keeps its claims.** When Discord answers 404/401 we set `webhook_ok = 0`, stop for that account and do **not** release claims, so re-adding a webhook later does not replay stale alerts.
11. **`alert_log` pruning is stateless:** the run whose clock crosses UTC midnight (`utcDay(now) !== utcDay(now - 5 min)`) deletes rows older than 7 days. No state table. If that single run is skipped the prune happens the next day.
12. **Cap:** `MAX_ALERTING_ACCOUNTS = 24` accounts may hold a webhook; the 25th gets 429 with a plain message (spec "Capacity").
13. **A failed test message does not mark the webhook dead** unless Discord answers 404/401; a 5xx/429/network failure leaves `webhook_ok` as it was and the UI says to try again.

## File Structure

| File | Responsibility |
|---|---|
| `data/alerts.json` (new) | Alert defaults, bounds, which rules turn on after a verified test, sync cadence |
| `packages/core/src/detect.ts` (new) | Pure detection predicates shared by planner and alerts |
| `packages/core/src/alerts.ts` (new) | `AlertType`, `AlertRules`, `parseAlertRules`, `deriveAlerts`, `nextSyncAt` |
| `packages/core/src/planner.ts` | Use `detect.ts` (no behaviour change) |
| `packages/core/src/garden.ts` | `parseGardenState` (validate a stored snapshot) |
| `packages/core/src/api.ts`, `index.ts` | `AlertsStateResponse`, `AlertTestResponse`; export `alerts` |
| `apps/worker/migrations/0003_alerts.sql` (new) | Three tables |
| `apps/worker/src/alerts/db.ts` (new) | SQL for settings, due accounts, snapshot, claims, prune |
| `apps/worker/src/notify/discord.ts` (new) | URL check, send, result classification, embed builder |
| `apps/worker/src/routes/alerts.ts` (new) | `/api/alerts*` |
| `apps/worker/src/budget.ts` (new) | `Budget`, `countingFetch` |
| `apps/worker/src/cron.ts` (new) | `runSync`, `scheduledSync` |
| `apps/worker/src/limits.ts`, `contests.ts`, `routes/contests.ts`, `app.ts`, `index.ts`, `sync/db.ts` | Constants; shared contests loader; CORS `PUT`; scheduled export; delete cascade |
| `apps/worker/wrangler.toml`, `README.md`, `data/VERIFY.md` | Cron trigger; ops notes |
| `apps/web/src/api/client.ts`, `components/AlertsSection.tsx` (new), `screens/SettingsScreen.tsx` | UI |

---

### Task 1: Core — shared detection predicates; planner uses them

**Files:**
- Create: `packages/core/src/detect.ts`, `packages/core/src/detect.test.ts`
- Modify: `packages/core/src/planner.ts` (use the predicates; behaviour must not change)
- Test: existing `packages/core/src/planner.test.ts` is the regression guard and must pass unmodified.

**Interfaces:**
- Produces (used by Tasks 2 and 7), exactly:

```ts
export interface GreenhousePlan { lastWateredAt: number | null; wateringIntervalHours: number | null }
export function cropName(id: string): string;
export function myCropIds(assignments: Readonly<Record<string, string>>, unlockedPlotIds: readonly string[]): Set<string>;
export interface ContestHit { contest: Contest; matching: string[] }
export function contestsStartingWithin(contests: readonly Contest[], mine: ReadonlySet<string>, now: number, windowMinutes: number): ContestHit[];
export type ComposterAlarm =
  | { kind: "no_fuel"; lastSave: number }
  | { kind: "fuel_low"; lastSave: number; stopsAt: number };
export function composterAlarm(composter: ComposterState, now: number, earlyWarningMinutes: number): ComposterAlarm | null;
export function visitorsAtLeast(visitors: GardenState["visitors"], threshold: number): GardenState["visitors"];
export interface GreenhouseDue { plotId: string; lastWateredAt: number; dueAt: number }
export function greenhousesDue(greenhouses: Readonly<Record<string, GreenhousePlan>>, now: number, leadMinutes: number): GreenhouseDue[];
```

`detect.ts` is **not** exported from `index.ts` (internal to core); `GreenhousePlan` stays public through `planner.ts` re-exporting it.

- [ ] **Step 1: Write the failing tests** — `packages/core/src/detect.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  composterAlarm,
  contestsStartingWithin,
  greenhousesDue,
  myCropIds,
  visitorsAtLeast,
} from "./detect";
import { fuelPerHour, organicMatterPerHour } from "./composter";
import type { ComposterState } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const upgrades = { speed: 0, multiDrop: 0, fuelCap: 0, organicMatterCap: 0, costReduction: 0 };

function composter(over: Partial<ComposterState> = {}): ComposterState {
  return {
    organicMatter: organicMatterPerHour(upgrades) * 10,
    fuel: fuelPerHour(upgrades) * 10,
    compostUnits: 0,
    lastSave: NOW,
    upgrades,
    ...over,
  };
}

describe("myCropIds", () => {
  it("ignores assignments on plots that are not unlocked", () => {
    const mine = myCropIds({ beginner_1: "wheat", beginner_2: "carrot" }, ["beginner_1"]);
    expect([...mine]).toEqual(["wheat"]);
  });
});

describe("contestsStartingWithin", () => {
  const mine = new Set(["wheat"]);
  it("returns contests inside the window that include one of my crops", () => {
    const hits = contestsStartingWithin(
      [{ startsAt: NOW + 4 * MIN, crops: ["wheat", "carrot", "potato"] }],
      mine, NOW, 5,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matching).toEqual(["wheat"]);
  });
  it("skips contests outside the window, already started, or without my crops", () => {
    expect(contestsStartingWithin([{ startsAt: NOW + 6 * MIN, crops: ["wheat"] }], mine, NOW, 5)).toEqual([]);
    expect(contestsStartingWithin([{ startsAt: NOW - 1, crops: ["wheat"] }], mine, NOW, 5)).toEqual([]);
    expect(contestsStartingWithin([{ startsAt: NOW + MIN, crops: ["carrot"] }], mine, NOW, 5)).toEqual([]);
  });
});

describe("composterAlarm", () => {
  it("reports no_fuel when the fuel is gone", () => {
    expect(composterAlarm(composter({ fuel: 0 }), NOW, 30)).toEqual({ kind: "no_fuel", lastSave: NOW });
  });
  it("reports fuel_low when fuel runs out inside the early-warning window", () => {
    const alarm = composterAlarm(composter({ fuel: fuelPerHour(upgrades) * 0.25 }), NOW, 30);
    expect(alarm?.kind).toBe("fuel_low");
  });
  it("is null when there is plenty of fuel, and not fuel_low outside the window", () => {
    expect(composterAlarm(composter(), NOW, 30)).toBeNull();
    expect(composterAlarm(composter({ fuel: fuelPerHour(upgrades) * 0.25 }), NOW, 5)).toBeNull();
  });
  it("treats a missing last_save (0) as just saved", () => {
    expect(composterAlarm(composter({ lastSave: 0 }), NOW, 30)).toBeNull();
  });
});

describe("visitorsAtLeast", () => {
  const v = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, name: `V${i}` }));
  it("returns the queue only when it reaches the threshold", () => {
    expect(visitorsAtLeast(v(4), 5)).toEqual([]);
    expect(visitorsAtLeast(v(5), 5)).toHaveLength(5);
    expect(visitorsAtLeast(v(1), 1)).toHaveLength(1);
    expect(visitorsAtLeast([], 1)).toEqual([]);
  });
});

describe("greenhousesDue", () => {
  const plan = (lastWateredAt: number | null, wateringIntervalHours: number | null) => ({ lastWateredAt, wateringIntervalHours });
  it("is due once lastWateredAt + interval is within the lead", () => {
    const due = greenhousesDue({ beginner_1: plan(NOW - 3 * HOUR, 2) }, NOW, 0);
    expect(due).toEqual([{ plotId: "beginner_1", lastWateredAt: NOW - 3 * HOUR, dueAt: NOW - HOUR }]);
    expect(greenhousesDue({ beginner_1: plan(NOW - HOUR, 2) }, NOW, 0)).toEqual([]);
    expect(greenhousesDue({ beginner_1: plan(NOW - HOUR, 2) }, NOW, 90)).toHaveLength(1);
  });
  it("never fires without an interval or a watering time", () => {
    expect(greenhousesDue({ a: plan(null, 2), b: plan(NOW - 5 * HOUR, null) }, NOW, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/core test -- detect.test.ts`
Expected: FAIL, cannot resolve `./detect`.

- [ ] **Step 3: Implement** — `packages/core/src/detect.ts`

```ts
import { forecastComposter } from "./composter";
import { getCrop } from "./crops";
import type { ComposterState, Contest, GardenState } from "./types";

const MINUTE = 60_000;
const HOUR_MS = 60 * MINUTE;

export interface GreenhousePlan {
  lastWateredAt: number | null;
  wateringIntervalHours: number | null;
}

export function cropName(id: string): string {
  return getCrop(id)?.name ?? id;
}

/** Crop ids planted on plots that are really unlocked; stale assignments are ignored. */
export function myCropIds(
  assignments: Readonly<Record<string, string>>,
  unlockedPlotIds: readonly string[],
): Set<string> {
  const unlocked = new Set(unlockedPlotIds);
  return new Set(
    Object.entries(assignments)
      .filter(([plotId]) => unlocked.has(plotId))
      .map(([, cropId]) => cropId),
  );
}

export interface ContestHit {
  contest: Contest;
  matching: string[];
}

export function contestsStartingWithin(
  contests: readonly Contest[],
  mine: ReadonlySet<string>,
  now: number,
  windowMinutes: number,
): ContestHit[] {
  const hits: ContestHit[] = [];
  for (const contest of contests) {
    const until = contest.startsAt - now;
    if (until < 0 || until > windowMinutes * MINUTE) continue;
    const matching = contest.crops.filter((id) => mine.has(id));
    if (matching.length > 0) hits.push({ contest, matching });
  }
  return hits;
}

export type ComposterAlarm =
  | { kind: "no_fuel"; lastSave: number }
  | { kind: "fuel_low"; lastSave: number; stopsAt: number };

export function composterAlarm(
  composter: ComposterState,
  now: number,
  earlyWarningMinutes: number,
): ComposterAlarm | null {
  // A missing last_save (0) would otherwise count decades of runtime.
  const safe =
    composter.lastSave > 0 ? composter : { ...composter, lastSave: now };
  const forecast = forecastComposter(safe, now);

  if (forecast.status === "no_fuel") {
    return { kind: "no_fuel", lastSave: composter.lastSave };
  }
  if (
    forecast.status === "running" &&
    forecast.stopsBecause === "fuel" &&
    forecast.stopsAt !== null &&
    forecast.stopsAt - now <= earlyWarningMinutes * MINUTE
  ) {
    return {
      kind: "fuel_low",
      lastSave: composter.lastSave,
      stopsAt: forecast.stopsAt,
    };
  }
  return null;
}

export function visitorsAtLeast(
  visitors: GardenState["visitors"],
  threshold: number,
): GardenState["visitors"] {
  return visitors.length >= threshold && visitors.length > 0 ? visitors : [];
}

export interface GreenhouseDue {
  plotId: string;
  lastWateredAt: number;
  dueAt: number;
}

export function greenhousesDue(
  greenhouses: Readonly<Record<string, GreenhousePlan>>,
  now: number,
  leadMinutes: number,
): GreenhouseDue[] {
  const due: GreenhouseDue[] = [];
  for (const [plotId, plan] of Object.entries(greenhouses)) {
    // Never fires without a player-set interval AND a watering time: there is
    // no verified water duration to fall back on (data/VERIFY.md "Water/decay").
    if (plan.wateringIntervalHours === null || plan.lastWateredAt === null) {
      continue;
    }
    const dueAt = plan.lastWateredAt + plan.wateringIntervalHours * HOUR_MS;
    if (dueAt - now > leadMinutes * MINUTE) continue;
    due.push({ plotId, lastWateredAt: plan.lastWateredAt, dueAt });
  }
  return due;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @garden-hq/core test -- detect.test.ts`
Expected: PASS. (If `data/crops.json` ids are not `wheat`/`carrot`, no test here depends on names.)

- [ ] **Step 5: Refactor `planner.ts` onto the predicates (no behaviour change)**

Edit `packages/core/src/planner.ts`:

1. Replace the imports `forecastComposter`, `getCrop` and the local `GreenhousePlan` interface:

```ts
import plannerData from "../../../data/planner.json";
import gardenLevels from "../../../data/garden-levels.json";
import {
  composterAlarm,
  contestsStartingWithin,
  cropName,
  greenhousesDue,
  myCropIds,
  visitorsAtLeast,
  type GreenhousePlan,
} from "./detect";
import { cheapestNextPlot, getPlot } from "./plots";
import type { Contest, GardenState } from "./types";

export type { GreenhousePlan } from "./detect";
```

Delete the local `interface GreenhousePlan { ... }` block and the local `function cropName`. Keep `MINUTE`, `minutesUntil`, `HOUR_MS` is no longer needed (delete `const HOUR_MS`).

2. Replace `contestActions`, `composterActions`, `visitorActions`, `greenhouseActions` with:

```ts
function contestActions({ now, garden, contests, assignments }: PlannerInput): Draft[] {
  const mine = myCropIds(assignments, garden.unlockedPlotIds);
  return contestsStartingWithin(contests, mine, now, T.contestWindowMinutes).map(
    ({ contest, matching }) => ({
      kind: "contest_soon",
      id: `contest_soon:${contest.startsAt}`,
      title: `${matching.map(cropName).join(", ")} contest in ${minutesUntil(contest.startsAt, now)} min`,
      detail: "A crop you have planted is in the next Jacob's Contest.",
      dueAt: contest.startsAt,
    }),
  );
}

function composterActions({ now, garden }: PlannerInput): Draft[] {
  const alarm = composterAlarm(garden.composter, now, T.fuelEarlyWarningMinutes);
  if (alarm === null) return [];
  if (alarm.kind === "no_fuel") {
    return [
      {
        kind: "composter_no_fuel",
        id: `composter_no_fuel:${alarm.lastSave}`,
        title: "Composter is out of fuel",
        detail: "Add fuel so it keeps making Compost.",
        dueAt: null,
      },
    ];
  }
  return [
    {
      kind: "composter_fuel_low",
      id: `composter_fuel_low:${alarm.lastSave}`,
      title: `Composter fuel runs out in ${minutesUntil(alarm.stopsAt, now)} min`,
      detail: "Top up fuel before it stops.",
      dueAt: alarm.stopsAt,
    },
  ];
}

function visitorActions({ garden }: PlannerInput): Draft[] {
  // TODO(visitors.json): show copper and Garden XP value once data/visitors.json exists.
  const visitors = visitorsAtLeast(garden.visitors, 1);
  if (visitors.length === 0) return [];
  return [
    {
      kind: "visitors_waiting",
      id: `visitors_waiting:${visitors.map((v) => v.id).sort().join(",")}`,
      title: `${visitors.length}/${T.visitorQueueMax} visitors waiting`,
      detail: visitors.map((v) => v.name).join(", "),
      dueAt: null,
    },
  ];
}

function greenhouseActions({ now, greenhouses }: PlannerInput): Draft[] {
  return greenhousesDue(greenhouses, now, T.greenhouseLeadMinutes).map(
    ({ plotId, lastWateredAt, dueAt }) => {
      const plotNumber = getPlot(plotId)?.plotNumber;
      return {
        kind: "greenhouse_water",
        id: `greenhouse_water:${plotId}:${lastWateredAt}`,
        title: `Water the Greenhouse${plotNumber === undefined ? "" : ` (plot ${plotNumber})`}`,
        detail: dueAt <= now ? "Watering is due now." : `Due in ${minutesUntil(dueAt, now)} min.`,
        dueAt,
      };
    },
  );
}
```

Leave `plotAction`, `levelAction`, `planActions` untouched. In the original, `visitorActions` sorted ids in place on a `.map` copy; the new code also sorts a `.map` copy, so `garden.visitors` is not mutated.

- [ ] **Step 6: Verify nothing changed**

Run: `pnpm --filter @garden-hq/core test` then `pnpm --filter @garden-hq/core typecheck`, `pnpm lint`, `pnpm format`.
Expected: all PASS, `planner.test.ts` unmodified and green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/detect.ts packages/core/src/detect.test.ts packages/core/src/planner.ts
git commit -m "refactor(core): extract shared detection predicates from the planner

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core — alert rules, `deriveAlerts`, `nextSyncAt`, `parseGardenState`

**Files:**
- Create: `data/alerts.json`, `packages/core/src/alerts.ts`, `packages/core/src/alerts.test.ts`
- Modify: `packages/core/src/garden.ts` (+ `garden.test.ts`), `packages/core/src/api.ts`, `packages/core/src/index.ts`, `data/VERIFY.md`

**Interfaces:**
- Consumes: Task 1 `detect.ts`; `PlannerInput` from `planner.ts`.
- Produces (used by Tasks 3, 5, 7, 9), exactly:

```ts
// alerts.ts
export const ALERT_TYPES: readonly ["contest_soon","composter_fuel_out","composter_fuel_low","visitors_waiting","greenhouse_water"];
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertParam = "leadMinutes" | "threshold";
export interface AlertRule { enabled: boolean; leadMinutes?: number; threshold?: number }
export type AlertRules = Record<AlertType, AlertRule>;
export const ALERT_BOUNDS: Record<AlertParam, { min: number; max: number }>;
export function alertParam(type: AlertType): AlertParam | null;
export function defaultAlertRules(enabledAfterTest: boolean): AlertRules;
export type ParsedRules = { ok: true; rules: AlertRules } | { ok: false; error: string };
export function parseAlertRules(raw: unknown, base: AlertRules): ParsedRules;
export interface AlertCandidate { type: AlertType; key: string; title: string; detail: string; dueAt: number | null }
export interface AlertInput extends PlannerInput { rules: AlertRules }
export function deriveAlerts(input: AlertInput): AlertCandidate[];
export function nextSyncAt(input: AlertInput, fetchedAt: number): number;
// garden.ts
export function parseGardenState(raw: unknown): GardenState | null;
// api.ts
export interface AlertsStateResponse { hasWebhook: boolean; webhookLast4: string | null; webhookOk: boolean | null; rules: AlertRules | null }
export interface AlertTestResponse extends AlertsStateResponse { test: "sent" | "failed" | "dead" }
```

- [ ] **Step 1: Write `data/alerts.json`**

```json
{
  "version": 1,
  "lastVerified": "2026-10-29",
  "enabledAfterTest": ["contest_soon", "composter_fuel_out", "visitors_waiting", "greenhouse_water"],
  "rules": {
    "contest_soon": { "leadMinutes": 5 },
    "composter_fuel_out": {},
    "composter_fuel_low": { "leadMinutes": 30 },
    "visitors_waiting": { "threshold": 5 },
    "greenhouse_water": {}
  },
  "bounds": {
    "leadMinutes": { "min": 1, "max": 120 },
    "threshold": { "min": 1, "max": 5 }
  },
  "sync": { "baselineMinutes": 15, "soonMinutes": 5, "soonHorizonMinutes": 20 }
}
```

(`threshold.max` 5 is the Garden's visitor queue maximum, CLAUDE.md §2; the other numbers are product choices from spec decision 4.)

- [ ] **Step 2: Write the failing tests** — `packages/core/src/alerts.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  ALERT_BOUNDS,
  alertParam,
  defaultAlertRules,
  deriveAlerts,
  nextSyncAt,
  parseAlertRules,
  type AlertInput,
  type AlertRules,
} from "./alerts";
import { fuelPerHour, organicMatterPerHour } from "./composter";
import type { ComposterState, GardenState } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const upgrades = { speed: 0, multiDrop: 0, fuelCap: 0, organicMatterCap: 0, costReduction: 0 };

function composter(over: Partial<ComposterState> = {}): ComposterState {
  return {
    organicMatter: organicMatterPerHour(upgrades) * 10,
    fuel: fuelPerHour(upgrades) * 10,
    compostUnits: 0,
    lastSave: NOW,
    upgrades,
    ...over,
  };
}

function garden(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 8,
    experience: 1000,
    unlockedPlotIds: ["beginner_1"],
    composter: composter(),
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

function allOn(): AlertRules {
  const rules = defaultAlertRules(true);
  rules.composter_fuel_low = { ...rules.composter_fuel_low, enabled: true };
  return rules;
}

function input(over: Partial<AlertInput> = {}): AlertInput {
  return {
    now: NOW,
    garden: garden(),
    contests: [],
    assignments: { beginner_1: "wheat" },
    greenhouses: {},
    rules: allOn(),
    ...over,
  };
}

describe("defaultAlertRules", () => {
  it("is all off before a verified test", () => {
    expect(Object.values(defaultAlertRules(false)).every((r) => !r.enabled)).toBe(true);
  });
  it("turns on the four default rules after a test, fuel early warning stays off", () => {
    const rules = defaultAlertRules(true);
    expect(rules.contest_soon).toEqual({ enabled: true, leadMinutes: 5 });
    expect(rules.composter_fuel_out.enabled).toBe(true);
    expect(rules.composter_fuel_low).toEqual({ enabled: false, leadMinutes: 30 });
    expect(rules.visitors_waiting).toEqual({ enabled: true, threshold: 5 });
    expect(rules.greenhouse_water.enabled).toBe(true);
  });
  it("knows which rule has which parameter", () => {
    expect(alertParam("contest_soon")).toBe("leadMinutes");
    expect(alertParam("visitors_waiting")).toBe("threshold");
    expect(alertParam("greenhouse_water")).toBeNull();
  });
});

describe("parseAlertRules", () => {
  const base = defaultAlertRules(true);
  it("merges a partial patch over the base", () => {
    const r = parseAlertRules({ contest_soon: { enabled: false, leadMinutes: 10 } }, base);
    expect(r.ok && r.rules.contest_soon).toEqual({ enabled: false, leadMinutes: 10 });
    expect(r.ok && r.rules.visitors_waiting).toEqual(base.visitors_waiting);
  });
  it.each([
    ["unknown type", { nope: { enabled: true } }],
    ["non-object", []],
    ["non-boolean enabled", { contest_soon: { enabled: "yes" } }],
    ["lead below min", { contest_soon: { leadMinutes: ALERT_BOUNDS.leadMinutes.min - 1 } }],
    ["lead above max", { contest_soon: { leadMinutes: ALERT_BOUNDS.leadMinutes.max + 1 } }],
    ["threshold above the queue", { visitors_waiting: { threshold: 6 } }],
    ["non-integer", { contest_soon: { leadMinutes: 2.5 } }],
    ["param on the wrong rule", { contest_soon: { threshold: 3 } }],
    ["unknown field", { contest_soon: { colour: "red" } }],
  ])("rejects %s", (_name, raw) => {
    expect(parseAlertRules(raw, base).ok).toBe(false);
  });
});

describe("deriveAlerts", () => {
  it("returns nothing when every rule is off, even if everything is due", () => {
    const out = deriveAlerts(input({
      rules: defaultAlertRules(false),
      garden: garden({ composter: composter({ fuel: 0 }) }),
      contests: [{ startsAt: NOW + MIN, crops: ["wheat"] }],
    }));
    expect(out).toEqual([]);
  });

  describe("contest_soon", () => {
    const contest = (mins: number) => [{ startsAt: NOW + mins * MIN, crops: ["wheat", "carrot", "potato"] }];
    it("fires once per contest, keyed by start time, inside the lead", () => {
      const out = deriveAlerts(input({ contests: contest(4) }));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: "contest_soon", key: String(NOW + 4 * MIN), dueAt: NOW + 4 * MIN });
      expect(out[0]?.title).toContain("Wheat");
    });
    it("waits until the lead and honours a custom lead", () => {
      expect(deriveAlerts(input({ contests: contest(6) }))).toEqual([]);
      const rules = allOn();
      rules.contest_soon = { enabled: true, leadMinutes: 10 };
      expect(deriveAlerts(input({ contests: contest(8), rules }))).toHaveLength(1);
    });
    it("ignores contests for crops that are not mine or sit on locked plots", () => {
      expect(deriveAlerts(input({ contests: contest(4), assignments: { beginner_1: "melon" } }))).toEqual([]);
      expect(deriveAlerts(input({ contests: contest(4), assignments: { beginner_2: "wheat" } }))).toEqual([]);
    });
  });

  describe("composter", () => {
    it("fires fuel_out once, keyed by last_save, so a refill re-arms it", () => {
      const a = deriveAlerts(input({ garden: garden({ composter: composter({ fuel: 0 }) }) }));
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ type: "composter_fuel_out", key: String(NOW) });
      const b = deriveAlerts(input({ garden: garden({ composter: composter({ fuel: 0, lastSave: NOW - HOUR }) }) }));
      expect(b[0]?.key).toBe(String(NOW - HOUR));
    });
    it("fires fuel_low only when that optional rule is on and fuel is about to run out", () => {
      const low = garden({ composter: composter({ fuel: fuelPerHour(upgrades) * 0.25 }) });
      const out = deriveAlerts(input({ garden: low }));
      expect(out.map((o) => o.type)).toEqual(["composter_fuel_low"]);
      const rules = allOn();
      rules.composter_fuel_low = { ...rules.composter_fuel_low, enabled: false };
      expect(deriveAlerts(input({ garden: low, rules }))).toEqual([]);
    });
    it("does nothing with plenty of fuel", () => {
      expect(deriveAlerts(input())).toEqual([]);
    });
  });

  describe("visitors_waiting", () => {
    const queue = (ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));
    it("fires only when the queue reaches the threshold; key is the sorted ids", () => {
      expect(deriveAlerts(input({ garden: garden({ visitors: queue(["a", "b", "c", "d"]) }) }))).toEqual([]);
      const out = deriveAlerts(input({ garden: garden({ visitors: queue(["e", "d", "c", "b", "a"]) }) }));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: "visitors_waiting", key: "a,b,c,d,e" });
    });
    it("honours a lower threshold", () => {
      const rules = allOn();
      rules.visitors_waiting = { enabled: true, threshold: 2 };
      expect(deriveAlerts(input({ rules, garden: garden({ visitors: queue(["a", "b"]) }) }))).toHaveLength(1);
    });
  });

  describe("greenhouse_water", () => {
    it("fires once the player-set interval has elapsed; key changes when watered again", () => {
      const gh = { beginner_1: { lastWateredAt: NOW - 3 * HOUR, wateringIntervalHours: 2 } };
      const out = deriveAlerts(input({ greenhouses: gh }));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ type: "greenhouse_water", key: `beginner_1:${NOW - 3 * HOUR}` });
      expect(out[0]?.title).toContain("Water the Greenhouse");
    });
    it("never fires without an interval, a watering time, or before it is due", () => {
      expect(deriveAlerts(input({ greenhouses: { a: { lastWateredAt: null, wateringIntervalHours: 2 } } }))).toEqual([]);
      expect(deriveAlerts(input({ greenhouses: { a: { lastWateredAt: NOW - 5 * HOUR, wateringIntervalHours: null } } }))).toEqual([]);
      expect(deriveAlerts(input({ greenhouses: { a: { lastWateredAt: NOW - HOUR, wateringIntervalHours: 2 } } }))).toEqual([]);
    });
  });

  it("is stable: identical input gives identical candidates and keys", () => {
    const i = input({
      garden: garden({ composter: composter({ fuel: 0 }), visitors: [{ id: "a", name: "A" }] }),
      contests: [{ startsAt: NOW + 3 * MIN, crops: ["wheat"] }],
    });
    expect(deriveAlerts(i)).toEqual(deriveAlerts(i));
  });
});

describe("nextSyncAt", () => {
  it("is the baseline when nothing is coming up", () => {
    expect(nextSyncAt(input(), NOW)).toBe(NOW + 15 * MIN);
  });
  it("speeds up when a contest alert is due within the horizon", () => {
    const i = input({ contests: [{ startsAt: NOW + 15 * MIN, crops: ["wheat"] }] });
    expect(nextSyncAt(i, NOW)).toBe(NOW + 5 * MIN);
  });
  it("does not speed up for an alert that is already due", () => {
    const i = input({ contests: [{ startsAt: NOW + 3 * MIN, crops: ["wheat"] }] });
    expect(nextSyncAt(i, NOW)).toBe(NOW + 15 * MIN);
  });
  it("speeds up when fuel runs out soon or a Greenhouse is about to need water", () => {
    const fuel = garden({ composter: composter({ fuel: fuelPerHour(upgrades) * 0.15 }) });
    expect(nextSyncAt(input({ garden: fuel }), NOW)).toBe(NOW + 5 * MIN);
    const gh = { beginner_1: { lastWateredAt: NOW - HOUR, wateringIntervalHours: 1.25 } };
    expect(nextSyncAt(input({ greenhouses: gh }), NOW)).toBe(NOW + 5 * MIN);
  });
  it("ignores events whose rule is off", () => {
    const rules = defaultAlertRules(false);
    const i = input({ rules, contests: [{ startsAt: NOW + 15 * MIN, crops: ["wheat"] }] });
    expect(nextSyncAt(i, NOW)).toBe(NOW + 15 * MIN);
  });
});
```

Add to `packages/core/src/garden.test.ts` (copy the fixture import style used at the top of that file):

```ts
describe("parseGardenState", () => {
  it("round-trips a normalized garden", () => {
    const garden = normalizeGarden(gardenResponse);
    expect(parseGardenState(JSON.parse(JSON.stringify(garden)))).toEqual(garden);
  });
  it.each([
    ["not an object", 5],
    ["null", null],
    ["missing composter", { level: 1 }],
    ["string level", { ...normalizeGarden(gardenResponse), level: "8" }],
    ["NaN fuel", { ...normalizeGarden(gardenResponse), composter: { ...normalizeGarden(gardenResponse).composter, fuel: Number.NaN } }],
    ["bad visitor", { ...normalizeGarden(gardenResponse), visitors: [{ id: 1 }] }],
    ["bad plots", { ...normalizeGarden(gardenResponse), unlockedPlotIds: [1] }],
  ])("rejects %s", (_name, raw) => {
    expect(parseGardenState(raw)).toBeNull();
  });
});
```

(`NaN` becomes `null` under `JSON.stringify`, but this test passes the object directly, which is the case that matters. Use the same fixture import the existing tests in `garden.test.ts` already use.)

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @garden-hq/core test -- alerts.test.ts garden.test.ts`
Expected: FAIL (`./alerts` missing, `parseGardenState` not exported).

- [ ] **Step 4: Implement `packages/core/src/alerts.ts`**

```ts
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
  sync: { baselineMinutes: number; soonMinutes: number; soonHorizonMinutes: number };
}
const DATA = alertData as AlertData;

const MINUTE = 60_000;

export const ALERT_BOUNDS: Record<AlertParam, { min: number; max: number }> = DATA.bounds;

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
  | { ok: true; rules: AlertRules }
  | { ok: false; error: string };

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
        return { ok: false, error: `${type} has no setting ${field.slice(0, 40)}` };
      }
      const { min, max } = ALERT_BOUNDS[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return { ok: false, error: `${type}.${field} must be a whole number from ${min} to ${max}` };
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

function lead(rules: AlertRules, type: "contest_soon" | "composter_fuel_low"): number {
  return rules[type].leadMinutes ?? DATA.rules[type].leadMinutes ?? 0;
}

export function deriveAlerts(input: AlertInput): AlertCandidate[] {
  const { now, garden, contests, assignments, greenhouses, rules } = input;
  const out: AlertCandidate[] = [];

  if (rules.contest_soon.enabled) {
    const mine = myCropIds(assignments, garden.unlockedPlotIds);
    for (const { contest, matching } of contestsStartingWithin(
      contests, mine, now, lead(rules, "contest_soon"),
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
    const alarm = composterAlarm(garden.composter, now, lead(rules, "composter_fuel_low"));
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
      rules.visitors_waiting.threshold ?? DATA.rules.visitors_waiting.threshold ?? 1,
    );
    if (visitors.length > 0) {
      out.push({
        type: "visitors_waiting",
        key: visitors.map((v) => v.id).sort().join(","),
        title: `${visitors.length} visitors waiting`,
        detail: visitors.map((v) => v.name).join(", "),
        dueAt: null,
      });
    }
  }

  if (rules.greenhouse_water.enabled) {
    for (const { plotId, lastWateredAt, dueAt } of greenhousesDue(greenhouses, now, 0)) {
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
export function nextSyncAt(input: AlertInput, _fetchedAt: number): number {
  const { now, garden, contests, assignments, greenhouses, rules } = input;
  const { baselineMinutes, soonMinutes, soonHorizonMinutes } = DATA.sync;

  const contestLead = lead(rules, "contest_soon");
  const mine = myCropIds(assignments, garden.unlockedPlotIds);
  const contestSoon =
    rules.contest_soon.enabled &&
    contestsStartingWithin(contests, mine, now, contestLead + soonHorizonMinutes).some(
      ({ contest }) => contest.startsAt - contestLead * MINUTE > now,
    );

  const fuelSoon =
    (rules.composter_fuel_out.enabled || rules.composter_fuel_low.enabled) &&
    composterAlarm(garden.composter, now, soonHorizonMinutes)?.kind === "fuel_low";

  const waterSoon =
    rules.greenhouse_water.enabled &&
    greenhousesDue(greenhouses, now, soonHorizonMinutes).some((d) => d.dueAt > now);

  const minutes = contestSoon || fuelSoon || waterSoon ? soonMinutes : baselineMinutes;
  return now + minutes * MINUTE;
}
```

Notes for the implementer: `nextSyncAt`'s `_fetchedAt` parameter exists so a future "never earlier than fetched_at + 5 min" rule has a place; since `soonMinutes` (5) already equals that floor and `fetchedAt <= now`, it is unused today. If lint objects to the unused parameter, delete the parameter and update the call in Task 7 and the tests (`nextSyncAt(input)`).

- [ ] **Step 5: Implement `parseGardenState`** — append to `packages/core/src/garden.ts`

```ts
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validates a `GardenState` that was stored as JSON (the cron's snapshot). Not
 * `normalizeGarden`: that reads the raw Hypixel shape. Returns null for anything
 * that is not exactly our own output, so a corrupt or old-format row is refetched.
 */
export function parseGardenState(raw: unknown): GardenState | null {
  if (!isObj(raw)) return null;
  const { composter, greenhouse, visitors, unlockedPlotIds } = raw;
  if (!isObj(composter) || !isObj(composter.upgrades) || !isObj(greenhouse)) return null;
  const u = composter.upgrades;
  const numbers = [
    raw.level, raw.experience, raw.visitorsServedTotal,
    composter.organicMatter, composter.fuel, composter.compostUnits, composter.lastSave,
    u.speed, u.multiDrop, u.fuelCap, u.organicMatterCap, u.costReduction,
  ];
  if (!numbers.every(isNum)) return null;
  if (!Array.isArray(unlockedPlotIds) || !unlockedPlotIds.every((p) => typeof p === "string")) return null;
  if (!Array.isArray(visitors) || !visitors.every((v) => isObj(v) && typeof v.id === "string" && typeof v.name === "string")) return null;
  const cells = greenhouse.lockedCells;
  if (!Array.isArray(cells) || !cells.every((c) => isObj(c) && isNum(c.x) && isNum(c.z))) return null;
  return raw as unknown as GardenState;
}
```

If `garden.ts` already imports `GardenState` use that import; otherwise add `import type { GardenState } from "./types";`. If `coerce.ts` already exports an `isRecord`-style helper, use it instead of the local `isObj`.

- [ ] **Step 6: Add the API types and exports**

`packages/core/src/api.ts` — add at the top `import type { AlertRules } from "./alerts";` and append:

```ts
export interface AlertsStateResponse {
  hasWebhook: boolean;
  /** Last 4 characters of the webhook token; the URL itself is never returned. */
  webhookLast4: string | null;
  /** null until a test message has been sent; false when Discord says the webhook is gone. */
  webhookOk: boolean | null;
  /** null until the first successful test message. */
  rules: AlertRules | null;
}

export interface AlertTestResponse extends AlertsStateResponse {
  test: "sent" | "failed" | "dead";
}
```

`packages/core/src/index.ts` — add `export * from "./alerts";` after `export * from "./planner";`.

- [ ] **Step 7: Add the VERIFY entry** — append to `data/VERIFY.md`:

```md
## Alerts (Phase 3C, 2026-10-29)

- **No `composter_full` / `no_organic_matter` alert** — `forecastComposter` can report `no_organic_matter`, but the spec lists only fuel alerts and the compost bin cap is unconfirmed (see "composter" above). Nothing fires for it.
- **`composter_fuel_out` key with a missing `last_save`** — `lastSave` 0 yields key `0`, so the alert fires once ever for such a composter until a real save appears.
- **Fuel alerts rely on the API's `last_save` being fresh** — `forecastComposter` projects forward from it. Whether `composter_data.last_save` advances while the player is away from SkyBlock is unverified (spec "Open verification items").
- **Contest dedupe key is `startsAt`** (one alert per contest listing my matching crops), not the spec's `startsAt:cropId`.
```

- [ ] **Step 8: Verify**

Run: `pnpm --filter @garden-hq/core test`, `pnpm --filter @garden-hq/core typecheck`, `pnpm lint`, `pnpm format`.
Expected: PASS. (If a data-integrity test enumerates `data/*.json`, add `alerts.json` to it.)

- [ ] **Step 9: Commit**

```bash
git add data/alerts.json data/VERIFY.md packages/core
git commit -m "feat(core): alert rules, deriveAlerts, nextSyncAt, parseGardenState

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Worker — migration 0003 and the alerts DB layer

**Files:**
- Create: `apps/worker/migrations/0003_alerts.sql`, `apps/worker/src/alerts/db.ts`, `apps/worker/src/alerts/db.test.ts`
- Modify: `apps/worker/src/limits.ts`, `apps/worker/src/sync/db.ts` (`deleteAccount`), `apps/worker/src/sync/db.test.ts` (one extra assertion)

**Interfaces:**
- Consumes: Task 2 `AlertRules`, `defaultAlertRules`, `parseAlertRules`, `parseGardenState`, `GardenState`; existing `createAccount`, `applyOpsToDb`, `makeD1`.
- Produces (used by Tasks 5, 7), exactly:

```ts
// limits.ts additions
export const MAX_ALERTING_ACCOUNTS = 24;
export const CRON_BATCH = 10;
export const MAX_HYPIXEL_CALLS_PER_RUN = 8;
export const SUBREQUEST_BUDGET = 40;
export const HYPIXEL_ATTEMPT_RESERVE = 3;
export const SNAPSHOT_REUSE_MS = 5 * 60_000;
export const CRON_SLACK_MS = 60_000;
export const CRON_ERROR_RETRY_MS = 5 * 60_000;
export const CRON_NO_GARDEN_RETRY_MS = 60 * 60_000;
export const INACTIVE_ACCOUNT_MS = 60 * MS_PER_DAY;
export const ALERT_LOG_RETENTION_MS = 7 * MS_PER_DAY;

// alerts/db.ts
export const SNAPSHOT_VERSION = 1;
export interface AlertSettingsRow { webhook: string | null; webhookOk: boolean | null; rules: AlertRules | null }
export function parseStoredRules(json: string | null): AlertRules | null;
export function loadAlertSettings(db: D1Database, accountId: string): Promise<AlertSettingsRow | null>;
export function countWebhooks(db: D1Database): Promise<number>;
export function saveWebhook(db: D1Database, accountId: string, url: string, now: number): Promise<void>;
export function verifyWebhookStmt(db: D1Database, accountId: string, defaultRulesJson: string, now: number): D1PreparedStatement;
export function markWebhookDeadStmt(db: D1Database, accountId: string, now: number): D1PreparedStatement;
export function saveRules(db: D1Database, accountId: string, rules: AlertRules, now: number): Promise<void>;
export function removeAlertSettings(db: D1Database, accountId: string): Promise<void>;
export interface DueAccount { accountId: string; webhook: string; rules: string | null; profileId: string; snapshotJson: string | null; snapshotFetchedAt: number | null }
export function loadDueAccounts(db: D1Database, now: number, limit: number): Promise<DueAccount[]>;
export interface StoredPlayerData { assignments: Record<string, string>; greenhouses: Record<string, GreenhousePlan> }
export function loadAccountData(db: D1Database, ids: readonly string[]): Promise<Map<string, StoredPlayerData>>;
export function parseSnapshot(json: string | null, fetchedAt: number | null): { garden: GardenState; fetchedAt: number } | null;
export function saveSnapshotStmt(db: D1Database, accountId: string, fetchedAt: number, garden: GardenState): D1PreparedStatement;
export function setNextSyncStmt(db: D1Database, accountId: string, at: number): D1PreparedStatement;
export function claimStmt(db: D1Database, accountId: string, type: string, key: string, now: number): D1PreparedStatement;
export function releaseClaimStmt(db: D1Database, accountId: string, type: string, key: string): D1PreparedStatement;
export function pruneAlertLogStmt(db: D1Database, now: number): D1PreparedStatement;
```

- [ ] **Step 1: Write the migration** — `apps/worker/migrations/0003_alerts.sql`

```sql
-- Discord alerts (Phase 3C). The webhook URL is a secret: stored here only,
-- never returned by any route.
CREATE TABLE alert_settings (
  account_id      TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  discord_webhook TEXT,
  -- NULL = never tested, 1 = a test message went through, 0 = Discord said it is gone.
  webhook_ok      INTEGER,
  -- JSON AlertRules; NULL until the first successful test message.
  rules           TEXT,
  -- Cron bookkeeping: the account is due when next_sync_at <= now (+ slack).
  next_sync_at    INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX alert_settings_next_sync ON alert_settings(next_sync_at);

-- Latest normalized garden per account ({"v":1,"garden":{...}}); no history.
CREATE TABLE garden_snapshot (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  fetched_at INTEGER NOT NULL,
  json       TEXT NOT NULL
);

-- Dedupe: a row is a CLAIM to send (type, key) once. Pruned after 7 days.
CREATE TABLE alert_log (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  key        TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, type, key)
);
CREATE INDEX alert_log_sent_at ON alert_log(sent_at);
```

- [ ] **Step 2: Add the constants** — append to `apps/worker/src/limits.ts` (below `MS_PER_DAY` is defined, so place after it):

```ts
/**
 * Cron / alerts operating limits (Phase 3C). Tunable guesses sized against the
 * free plan (50 subrequests and 10 ms CPU per invocation), not measured values:
 * see data/VERIFY.md "Alerts cron".
 */
export const MAX_ALERTING_ACCOUNTS = 24;
export const CRON_BATCH = 10;
export const MAX_HYPIXEL_CALLS_PER_RUN = 8;
/** Of the 50 allowed; the rest is headroom for retries and releases. */
export const SUBREQUEST_BUDGET = 40;
/** The Hypixel client retries a call up to 3 times (hypixel.ts MAX_ATTEMPTS). */
export const HYPIXEL_ATTEMPT_RESERVE = 3;
export const SNAPSHOT_REUSE_MS = 5 * 60_000;
/** next_sync_at is set a few hundred ms after a cron tick; without slack a 5 min reschedule slips to 10. */
export const CRON_SLACK_MS = 60_000;
export const CRON_ERROR_RETRY_MS = 5 * 60_000;
export const CRON_NO_GARDEN_RETRY_MS = 60 * 60_000;
export const INACTIVE_ACCOUNT_MS = 60 * MS_PER_DAY;
export const ALERT_LOG_RETENTION_MS = 7 * MS_PER_DAY;
```

- [ ] **Step 3: Write the failing tests** — `apps/worker/src/alerts/db.test.ts`

```ts
import { defaultAlertRules, type GardenState } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { makeD1 } from "../../test/d1";
import { ALERT_LOG_RETENTION_MS, INACTIVE_ACCOUNT_MS } from "../limits";
import { applyOpsToDb, createAccount, deleteAccount } from "../sync/db";
import {
  claimStmt,
  countWebhooks,
  loadAccountData,
  loadAlertSettings,
  loadDueAccounts,
  markWebhookDeadStmt,
  parseSnapshot,
  pruneAlertLogStmt,
  releaseClaimStmt,
  removeAlertSettings,
  saveRules,
  saveSnapshotStmt,
  saveWebhook,
  setNextSyncStmt,
  verifyWebhookStmt,
} from "./db";

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const MIN = 60_000;
const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";
const LINK = { name: "TestFarmer", uuid: "0123456789abcdef0123456789abcdef", profileId: "fedcba9876543210fedcba9876543210", profiles: [] };
const RULES_JSON = JSON.stringify(defaultAlertRules(true));

const GARDEN: GardenState = {
  level: 8, experience: 10, unlockedPlotIds: ["beginner_1"], visitorsServedTotal: 0, visitors: [],
  greenhouse: { lockedCells: [] },
  composter: { organicMatter: 1, fuel: 0, compostUnits: 0, lastSave: NOW, upgrades: { speed: 0, multiDrop: 0, fuelCap: 0, organicMatterCap: 0, costReduction: 0 } },
};

async function account(db: D1Database, id: string, opts: { webhook?: boolean; verified?: boolean; lastSeen?: number } = {}) {
  await createAccount(db, { id, codeHash: `hash-${id}`, link: LINK, now: opts.lastSeen ?? NOW });
  if (opts.webhook !== false) await saveWebhook(db, id, HOOK, NOW);
  if (opts.verified) await verifyWebhookStmt(db, id, RULES_JSON, NOW).run();
}

describe("alert settings", () => {
  it("saves a webhook as untested with no rules", async () => {
    const db = makeD1();
    await account(db, "a");
    expect(await loadAlertSettings(db, "a")).toEqual({ webhook: HOOK, webhookOk: null, rules: null });
    expect(await countWebhooks(db)).toBe(1);
  });
  it("verifying marks it ok and seeds default rules only once", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    const first = await loadAlertSettings(db, "a");
    expect(first?.webhookOk).toBe(true);
    expect(first?.rules?.contest_soon.enabled).toBe(true);
    const custom = defaultAlertRules(true);
    custom.contest_soon = { enabled: false, leadMinutes: 9 };
    await saveRules(db, "a", custom, NOW);
    await verifyWebhookStmt(db, "a", RULES_JSON, NOW).run();
    expect((await loadAlertSettings(db, "a"))?.rules?.contest_soon).toEqual({ enabled: false, leadMinutes: 9 });
  });
  it("replacing the webhook resets the test status but keeps the rules", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await saveWebhook(db, "a", `${HOOK}x`, NOW);
    const s = await loadAlertSettings(db, "a");
    expect(s?.webhookOk).toBeNull();
    expect(s?.rules).not.toBeNull();
  });
  it("marks a webhook dead", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await markWebhookDeadStmt(db, "a", NOW).run();
    expect((await loadAlertSettings(db, "a"))?.webhookOk).toBe(false);
  });
  it("a corrupt stored rules blob reads as null", async () => {
    const db = makeD1();
    await account(db, "a");
    await db.prepare("UPDATE alert_settings SET rules = 'not json' WHERE account_id = 'a'").run();
    expect((await loadAlertSettings(db, "a"))?.rules).toBeNull();
  });
  it("removeAlertSettings deletes settings, snapshot and log", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await db.batch([saveSnapshotStmt(db, "a", NOW, GARDEN), claimStmt(db, "a", "contest_soon", "k", NOW)]);
    await removeAlertSettings(db, "a");
    for (const t of ["alert_settings", "garden_snapshot", "alert_log"]) {
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n).toBe(0);
    }
  });
});

describe("loadDueAccounts", () => {
  it("returns only verified, working accounts with an enabled rule", async () => {
    const db = makeD1();
    await account(db, "untested");
    await account(db, "ok", { verified: true });
    await account(db, "dead", { verified: true });
    await markWebhookDeadStmt(db, "dead", NOW).run();
    await account(db, "off", { verified: true });
    await saveRules(db, "off", defaultAlertRules(false), NOW);
    const due = await loadDueAccounts(db, NOW, 10);
    expect(due.map((d) => d.accountId)).toEqual(["ok"]);
    expect(due[0]).toMatchObject({ webhook: HOOK, profileId: LINK.profileId, snapshotJson: null, snapshotFetchedAt: null });
  });
  it("honours next_sync_at with the cron slack, ordering and limit", async () => {
    const db = makeD1();
    for (const id of ["a", "b", "c", "d"]) await account(db, id, { verified: true });
    await setNextSyncStmt(db, "a", NOW + 30_000).run(); // inside the 60 s slack: due
    await setNextSyncStmt(db, "b", NOW + 5 * MIN).run(); // not due
    await setNextSyncStmt(db, "c", NOW - 10 * MIN).run(); // most overdue: first
    await setNextSyncStmt(db, "d", NOW - 1 * MIN).run();
    expect((await loadDueAccounts(db, NOW, 10)).map((d) => d.accountId)).toEqual(["c", "d", "a"]);
    expect(await loadDueAccounts(db, NOW, 2)).toHaveLength(2);
  });
  it("skips accounts inactive for 60 days", async () => {
    const db = makeD1();
    await account(db, "old", { verified: true, lastSeen: NOW - INACTIVE_ACCOUNT_MS - MIN });
    await account(db, "new", { verified: true });
    expect((await loadDueAccounts(db, NOW, 10)).map((d) => d.accountId)).toEqual(["new"]);
  });
  it("includes the stored snapshot", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await saveSnapshotStmt(db, "a", NOW - MIN, GARDEN).run();
    const [row] = await loadDueAccounts(db, NOW, 10);
    expect(row?.snapshotFetchedAt).toBe(NOW - MIN);
    expect(parseSnapshot(row?.snapshotJson ?? null, row?.snapshotFetchedAt ?? null)).toEqual({ garden: GARDEN, fetchedAt: NOW - MIN });
  });
});

describe("parseSnapshot", () => {
  it("rejects missing, corrupt, wrong-version and invalid snapshots", () => {
    expect(parseSnapshot(null, null)).toBeNull();
    expect(parseSnapshot("nope", 1)).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 99, garden: GARDEN }), 1)).toBeNull();
    expect(parseSnapshot(JSON.stringify({ v: 1, garden: { level: 1 } }), 1)).toBeNull();
  });
});

describe("loadAccountData", () => {
  it("returns assignments and greenhouse plans per account", async () => {
    const db = makeD1();
    await account(db, "a");
    await account(db, "b");
    await applyOpsToDb(db, "a", [
      { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
      { t: "markGreenhouse", plotId: "beginner_2" },
      { t: "setWateringInterval", plotId: "beginner_2", hours: 6 },
      { t: "markGreenhouseWatered", plotId: "beginner_2", at: NOW },
    ], NOW);
    const data = await loadAccountData(db, ["a", "b"]);
    expect(data.get("a")).toEqual({
      assignments: { beginner_1: "wheat" },
      greenhouses: { beginner_2: { lastWateredAt: NOW, wateringIntervalHours: 6 } },
    });
    expect(data.get("b")).toEqual({ assignments: {}, greenhouses: {} });
  });
  it("is empty for no ids", async () => {
    expect((await loadAccountData(makeD1(), [])).size).toBe(0);
  });
});

describe("claims and pruning", () => {
  it("a claim wins once, can be released, and wins again", async () => {
    const db = makeD1();
    await account(db, "a");
    const changes = async (s: D1PreparedStatement) => (await s.run()).meta.changes;
    expect(await changes(claimStmt(db, "a", "contest_soon", "k", NOW))).toBe(1);
    expect(await changes(claimStmt(db, "a", "contest_soon", "k", NOW))).toBe(0);
    expect(await changes(claimStmt(db, "a", "composter_fuel_out", "k", NOW))).toBe(1);
    await releaseClaimStmt(db, "a", "contest_soon", "k").run();
    expect(await changes(claimStmt(db, "a", "contest_soon", "k", NOW))).toBe(1);
  });
  it("prunes only rows older than the retention", async () => {
    const db = makeD1();
    await account(db, "a");
    await claimStmt(db, "a", "t", "old", NOW - ALERT_LOG_RETENTION_MS - MIN).run();
    await claimStmt(db, "a", "t", "new", NOW - MIN).run();
    await pruneAlertLogStmt(db, NOW).run();
    const rows = await db.prepare("SELECT key FROM alert_log").all<{ key: string }>();
    expect(rows.results.map((r) => r.key)).toEqual(["new"]);
  });
});

describe("deleteAccount", () => {
  it("removes alert rows with the account", async () => {
    const db = makeD1();
    await account(db, "a", { verified: true });
    await db.batch([saveSnapshotStmt(db, "a", NOW, GARDEN), claimStmt(db, "a", "t", "k", NOW)]);
    await deleteAccount(db, "a");
    for (const t of ["alert_settings", "garden_snapshot", "alert_log"]) {
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n).toBe(0);
    }
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- alerts/db.test.ts`
Expected: FAIL, cannot resolve `./db` (and the migration is picked up automatically by `makeD1`, which applies every `migrations/*.sql`).

- [ ] **Step 5: Implement** — `apps/worker/src/alerts/db.ts`

```ts
import {
  defaultAlertRules,
  parseAlertRules,
  parseGardenState,
  type AlertRules,
  type GardenState,
  type GreenhousePlan,
} from "@garden-hq/core";
import {
  ALERT_LOG_RETENTION_MS,
  CRON_SLACK_MS,
  INACTIVE_ACCOUNT_MS,
} from "../limits";

export const SNAPSHOT_VERSION = 1;

export interface AlertSettingsRow {
  webhook: string | null;
  /** null = never tested. */
  webhookOk: boolean | null;
  rules: AlertRules | null;
}

interface DbSettings {
  discord_webhook: string | null;
  webhook_ok: number | null;
  rules: string | null;
}

export function parseStoredRules(json: string | null): AlertRules | null {
  if (json === null) return null;
  try {
    const parsed = parseAlertRules(JSON.parse(json), defaultAlertRules(false));
    return parsed.ok ? parsed.rules : null;
  } catch {
    return null;
  }
}

export async function loadAlertSettings(
  db: D1Database,
  accountId: string,
): Promise<AlertSettingsRow | null> {
  const row = await db
    .prepare(
      "SELECT discord_webhook, webhook_ok, rules FROM alert_settings WHERE account_id = ?1",
    )
    .bind(accountId)
    .first<DbSettings>();
  if (row === null) return null;
  return {
    webhook: row.discord_webhook,
    webhookOk: row.webhook_ok === null ? null : row.webhook_ok === 1,
    rules: parseStoredRules(row.rules),
  };
}

export async function countWebhooks(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM alert_settings WHERE discord_webhook IS NOT NULL")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function touchStmt(db: D1Database, accountId: string, now: number): D1PreparedStatement {
  // last_seen_at drives the 60-day inactivity cutoff; writes bump it (see plan decision 9).
  return db.prepare("UPDATE accounts SET last_seen_at = ?2 WHERE id = ?1").bind(accountId, now);
}

/** Stores a new webhook as untested; existing rules are kept. */
export async function saveWebhook(
  db: D1Database,
  accountId: string,
  url: string,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "INSERT INTO alert_settings (account_id, discord_webhook, webhook_ok, rules, next_sync_at, updated_at) " +
          "VALUES (?1, ?2, NULL, NULL, 0, ?3) " +
          "ON CONFLICT (account_id) DO UPDATE SET discord_webhook = excluded.discord_webhook, " +
          "webhook_ok = NULL, next_sync_at = 0, updated_at = excluded.updated_at",
      )
      .bind(accountId, url, now),
    touchStmt(db, accountId, now),
  ]);
}

/** A test message went through: mark ok and seed the default rules if there are none yet. */
export function verifyWebhookStmt(
  db: D1Database,
  accountId: string,
  defaultRulesJson: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE alert_settings SET webhook_ok = 1, rules = COALESCE(rules, ?2), next_sync_at = 0, updated_at = ?3 WHERE account_id = ?1",
    )
    .bind(accountId, defaultRulesJson, now);
}

export function markWebhookDeadStmt(
  db: D1Database,
  accountId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare("UPDATE alert_settings SET webhook_ok = 0, updated_at = ?2 WHERE account_id = ?1")
    .bind(accountId, now);
}

export async function saveRules(
  db: D1Database,
  accountId: string,
  rules: AlertRules,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE alert_settings SET rules = ?2, next_sync_at = 0, updated_at = ?3 WHERE account_id = ?1",
      )
      .bind(accountId, JSON.stringify(rules), now),
    touchStmt(db, accountId, now),
  ]);
}

export async function removeAlertSettings(db: D1Database, accountId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM alert_log WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM garden_snapshot WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM alert_settings WHERE account_id = ?1").bind(accountId),
  ]);
}

export interface DueAccount {
  accountId: string;
  webhook: string;
  rules: string | null;
  profileId: string;
  snapshotJson: string | null;
  snapshotFetchedAt: number | null;
}

interface DbDue {
  account_id: string;
  discord_webhook: string;
  rules: string | null;
  profile_id: string;
  snapshot_json: string | null;
  snapshot_fetched_at: number | null;
}

/**
 * Accounts the cron should look at now, most overdue first. The LIKE is a cheap
 * prefilter for "at least one enabled rule" so accounts with everything off
 * cannot fill the batch; the rules JSON is written by JSON.stringify of our own
 * objects, so the `"enabled":true` substring is exact. The cron re-checks in code.
 */
export async function loadDueAccounts(
  db: D1Database,
  now: number,
  limit: number,
): Promise<DueAccount[]> {
  const res = await db
    .prepare(
      "SELECT s.account_id, s.discord_webhook, s.rules, a.profile_id, " +
        "g.json AS snapshot_json, g.fetched_at AS snapshot_fetched_at " +
        "FROM alert_settings s " +
        "JOIN accounts a ON a.id = s.account_id " +
        "LEFT JOIN garden_snapshot g ON g.account_id = s.account_id " +
        "WHERE s.webhook_ok = 1 AND s.discord_webhook IS NOT NULL " +
        "AND s.rules LIKE '%\"enabled\":true%' " +
        "AND s.next_sync_at <= ?1 AND a.last_seen_at > ?2 " +
        "ORDER BY s.next_sync_at ASC, s.account_id ASC LIMIT ?3",
    )
    .bind(now + CRON_SLACK_MS, now - INACTIVE_ACCOUNT_MS, limit)
    .all<DbDue>();
  return (res.results ?? []).map((r) => ({
    accountId: r.account_id,
    webhook: r.discord_webhook,
    rules: r.rules,
    profileId: r.profile_id,
    snapshotJson: r.snapshot_json,
    snapshotFetchedAt: r.snapshot_fetched_at,
  }));
}

export interface StoredPlayerData {
  assignments: Record<string, string>;
  greenhouses: Record<string, GreenhousePlan>;
}

/** Assignments and Greenhouse plans for up to ~10 accounts in ONE batch of two statements. */
export async function loadAccountData(
  db: D1Database,
  ids: readonly string[],
): Promise<Map<string, StoredPlayerData>> {
  const out = new Map<string, StoredPlayerData>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { assignments: {}, greenhouses: {} });
  const marks = ids.map((_, i) => `?${i + 1}`).join(",");
  const [assignRes, ghRes] = await db.batch([
    db
      .prepare(`SELECT account_id, plot_id, crop_id FROM plot_assignments WHERE account_id IN (${marks})`)
      .bind(...ids),
    db
      .prepare(
        `SELECT account_id, plot_id, last_watered_at, watering_interval_hours FROM greenhouses WHERE account_id IN (${marks})`,
      )
      .bind(...ids),
  ]);
  for (const r of (assignRes?.results ?? []) as { account_id: string; plot_id: string; crop_id: string }[]) {
    const entry = out.get(r.account_id);
    if (entry !== undefined) entry.assignments[r.plot_id] = r.crop_id;
  }
  for (const r of (ghRes?.results ?? []) as {
    account_id: string;
    plot_id: string;
    last_watered_at: number | null;
    watering_interval_hours: number | null;
  }[]) {
    const entry = out.get(r.account_id);
    if (entry !== undefined) {
      entry.greenhouses[r.plot_id] = {
        lastWateredAt: r.last_watered_at,
        wateringIntervalHours: r.watering_interval_hours,
      };
    }
  }
  return out;
}

export function parseSnapshot(
  json: string | null,
  fetchedAt: number | null,
): { garden: GardenState; fetchedAt: number } | null {
  if (json === null || fetchedAt === null) return null;
  try {
    const body: unknown = JSON.parse(json);
    if (typeof body !== "object" || body === null) return null;
    const { v, garden } = body as { v?: unknown; garden?: unknown };
    if (v !== SNAPSHOT_VERSION) return null;
    const parsed = parseGardenState(garden);
    return parsed === null ? null : { garden: parsed, fetchedAt };
  } catch {
    return null;
  }
}

export function saveSnapshotStmt(
  db: D1Database,
  accountId: string,
  fetchedAt: number,
  garden: GardenState,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO garden_snapshot (account_id, fetched_at, json) VALUES (?1, ?2, ?3) " +
        "ON CONFLICT (account_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
    )
    .bind(accountId, fetchedAt, JSON.stringify({ v: SNAPSHOT_VERSION, garden }));
}

export function setNextSyncStmt(
  db: D1Database,
  accountId: string,
  at: number,
): D1PreparedStatement {
  return db
    .prepare("UPDATE alert_settings SET next_sync_at = ?2 WHERE account_id = ?1")
    .bind(accountId, at);
}

/** meta.changes === 1 means this caller won the right to send. */
export function claimStmt(
  db: D1Database,
  accountId: string,
  type: string,
  key: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare("INSERT OR IGNORE INTO alert_log (account_id, type, key, sent_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(accountId, type, key, now);
}

export function releaseClaimStmt(
  db: D1Database,
  accountId: string,
  type: string,
  key: string,
): D1PreparedStatement {
  return db
    .prepare("DELETE FROM alert_log WHERE account_id = ?1 AND type = ?2 AND key = ?3")
    .bind(accountId, type, key);
}

export function pruneAlertLogStmt(db: D1Database, now: number): D1PreparedStatement {
  return db
    .prepare("DELETE FROM alert_log WHERE sent_at < ?1")
    .bind(now - ALERT_LOG_RETENTION_MS);
}
```

- [ ] **Step 6: Extend `deleteAccount`** — in `apps/worker/src/sync/db.ts` replace the batch in `deleteAccount` with:

```ts
  await db.batch([
    db.prepare("DELETE FROM alert_log WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM garden_snapshot WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM alert_settings WHERE account_id = ?1").bind(accountId),
    db
      .prepare("DELETE FROM plot_assignments WHERE account_id = ?1")
      .bind(accountId),
    db.prepare("DELETE FROM greenhouses WHERE account_id = ?1").bind(accountId),
    db.prepare("DELETE FROM accounts WHERE id = ?1").bind(accountId),
  ]);
```

(This is explicit, in the same style as the existing deletes; the `ON DELETE CASCADE` is the backstop.)

- [ ] **Step 6b: Owner-approved change — any authenticated request counts as activity (once per day).** In `apps/worker/src/auth.ts`: add `lastSeenAt: number` to `AccountRow`, `last_seen_at: number` to `DbAccount`, `last_seen_at` to `ACCOUNT_COLUMNS` and `toAccountRow`. In `authenticate`, after the row is found, if `now() - row.last_seen_at >= MS_PER_DAY` run `UPDATE accounts SET last_seen_at = ?2 WHERE id = ?1` bound with `now()` (import `MS_PER_DAY` from `./limits`); at most one write per account per day, so reads never write otherwise. Update every test fixture that builds an `AccountRow`/`DbAccount`. Add tests to `auth.test.ts`: a request with `last_seen_at` within the last day issues no UPDATE (spy on `DB.prepare` or compare the stored value unchanged); a request with `last_seen_at` older than a day updates it to `now`, and a second request immediately after does not change it again. This supersedes plan decision 9: the 60-day cutoff stays, but pulls count as activity.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @garden-hq/worker test`, `pnpm --filter @garden-hq/worker typecheck`, `pnpm lint`, `pnpm format`.
Expected: PASS, including the existing `sync/db.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): alerts tables (migration 0003) and DB layer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Worker — Discord notifier

**Files:**
- Create: `apps/worker/src/notify/discord.ts`, `apps/worker/src/notify/discord.test.ts`

**Interfaces:**
- Consumes: `AlertCandidate` (Task 2); existing `discardBody` (`http.ts`), `logUpstream` (`log.ts`).
- Produces (used by Tasks 5, 7), exactly:

```ts
export const WEBHOOK_RE: RegExp;
export function isDiscordWebhookUrl(value: unknown): value is string;
export function webhookLast4(url: string): string;
export interface DiscordEmbed { title: string; description: string; footer: { text: string } }
export const TEST_EMBED: DiscordEmbed;
export function alertEmbed(candidate: AlertCandidate, syncedAt: number, now: number): DiscordEmbed;
export type SendResult =
  | { kind: "sent" }
  | { kind: "retry"; retryAfterSeconds: number | null }
  | { kind: "dead" }
  | { kind: "rejected"; status: number };
export function sendDiscord(fetchFn: typeof fetch, webhook: string, embed: DiscordEmbed): Promise<SendResult>;
```

- [ ] **Step 1: Write the failing tests** — `apps/worker/src/notify/discord.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { alertEmbed, isDiscordWebhookUrl, sendDiscord, TEST_EMBED, webhookLast4 } from "./discord";

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";

function fakeFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;
  return { fn, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("isDiscordWebhookUrl", () => {
  it.each([HOOK, HOOK.replace("discord.com", "discordapp.com")])("accepts %s", (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(true);
  });
  it.each([
    "http://discord.com/api/webhooks/1/abc",
    "https://discord.com.evil.com/api/webhooks/1/abc",
    "https://evil.com/api/webhooks/1/abc",
    "https://discord.com/api/webhooks/abc/def",
    `${HOOK}?wait=true`,
    `${HOOK}/extra`,
    "https://discord.com@evil.com/api/webhooks/1/abc",
    "",
    42,
    null,
  ])("rejects %s", (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(false);
  });
});

describe("webhookLast4", () => {
  it("returns the last 4 characters of the token", () => {
    expect(webhookLast4(HOOK)).toBe("-123");
  });
});

describe("alertEmbed", () => {
  it("carries the title, detail and how stale the data is", () => {
    const e = alertEmbed({ type: "contest_soon", key: "k", title: "T", detail: "D", dueAt: null }, 1_000_000, 1_000_000 + 3 * 60_000);
    expect(e).toEqual({ title: "T", description: "D", footer: { text: "Last synced 3 min ago · Garden HQ" } });
  });
});

describe("sendDiscord", () => {
  it("posts one embed that can never ping, without following redirects", async () => {
    const { fn, calls } = fakeFetch(new Response(null, { status: 204 }));
    expect(await sendDiscord(fn, HOOK, TEST_EMBED)).toEqual({ kind: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HOOK);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ embeds: [TEST_EMBED], allowed_mentions: { parse: [] } });
  });
  it("never calls out for a URL that is not a Discord webhook", async () => {
    const { fn, calls } = fakeFetch(new Response(null, { status: 204 }));
    expect(await sendDiscord(fn, "https://evil.com/x", TEST_EMBED)).toEqual({ kind: "dead" });
    expect(calls).toHaveLength(0);
  });
  it("429 asks to retry, honouring retry_after from the body or the header", async () => {
    const body = fakeFetch(new Response(JSON.stringify({ retry_after: 1.2 }), { status: 429 }));
    expect(await sendDiscord(body.fn, HOOK, TEST_EMBED)).toEqual({ kind: "retry", retryAfterSeconds: 2 });
    const header = fakeFetch(new Response("{}", { status: 429, headers: { "Retry-After": "7" } }));
    expect(await sendDiscord(header.fn, HOOK, TEST_EMBED)).toEqual({ kind: "retry", retryAfterSeconds: 7 });
    const neither = fakeFetch(new Response("nope", { status: 429 }));
    expect(await sendDiscord(neither.fn, HOOK, TEST_EMBED)).toEqual({ kind: "retry", retryAfterSeconds: null });
  });
  it("5xx and network errors are retryable", async () => {
    expect(await sendDiscord(fakeFetch(new Response(null, { status: 503 })).fn, HOOK, TEST_EMBED)).toEqual({ kind: "retry", retryAfterSeconds: null });
    expect(await sendDiscord(fakeFetch(new Error("down")).fn, HOOK, TEST_EMBED)).toEqual({ kind: "retry", retryAfterSeconds: null });
  });
  it("404 and 401 mean the webhook is gone", async () => {
    expect(await sendDiscord(fakeFetch(new Response(null, { status: 404 })).fn, HOOK, TEST_EMBED)).toEqual({ kind: "dead" });
    expect(await sendDiscord(fakeFetch(new Response(null, { status: 401 })).fn, HOOK, TEST_EMBED)).toEqual({ kind: "dead" });
  });
  it("another 4xx is rejected, not retried", async () => {
    expect(await sendDiscord(fakeFetch(new Response(null, { status: 400 })).fn, HOOK, TEST_EMBED)).toEqual({ kind: "rejected", status: 400 });
  });
  it("never logs the webhook URL or token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sendDiscord(fakeFetch(new Response(null, { status: 500 })).fn, HOOK, TEST_EMBED);
    await sendDiscord(fakeFetch(new Error("boom")).fn, HOOK, TEST_EMBED);
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(all).not.toContain("abcDEF_ghi-123");
    expect(all).not.toContain("123456789012345678");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- discord.test.ts`
Expected: FAIL, cannot resolve `./discord`.

- [ ] **Step 3: Implement** — `apps/worker/src/notify/discord.ts`

```ts
import type { AlertCandidate } from "@garden-hq/core";
import { discardBody } from "../http";
import { logUpstream } from "../log";

/** Anchored: blocks look-alike hosts, query strings and path suffixes (SSRF). */
export const WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const HOST = "discord.com";
// A path TEMPLATE: the real path holds the webhook token and must never be logged.
const LOG_PATH = "/api/webhooks/:id/:token";

export function isDiscordWebhookUrl(value: unknown): value is string {
  return typeof value === "string" && WEBHOOK_RE.test(value);
}

export function webhookLast4(url: string): string {
  return url.slice(-4);
}

export interface DiscordEmbed {
  title: string;
  description: string;
  footer: { text: string };
}

export const TEST_EMBED: DiscordEmbed = {
  title: "Garden HQ test message",
  description: "Alerts for your Garden will arrive in this channel.",
  footer: { text: "Not affiliated with Hypixel or Mojang." },
};

export function alertEmbed(
  candidate: AlertCandidate,
  syncedAt: number,
  now: number,
): DiscordEmbed {
  const minutes = Math.max(0, Math.round((now - syncedAt) / 60_000));
  return {
    title: candidate.title.slice(0, 256),
    description: candidate.detail.slice(0, 2000),
    footer: { text: `Last synced ${minutes} min ago · Garden HQ` },
  };
}

export type SendResult =
  | { kind: "sent" }
  | { kind: "retry"; retryAfterSeconds: number | null }
  | { kind: "dead" }
  | { kind: "rejected"; status: number };

async function retryAfterSeconds(res: Response): Promise<number | null> {
  // VERIFY: Discord's 429 body carries `retry_after` in seconds (may be fractional).
  try {
    const body: unknown = JSON.parse((await res.text()).slice(0, 2000));
    const v = (body as { retry_after?: unknown } | null)?.retry_after;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.ceil(v);
  } catch {
    // fall through to the header
  }
  const header = Number(res.headers.get("Retry-After"));
  return Number.isFinite(header) && header > 0 ? Math.ceil(header) : null;
}

/** Posts one embed. The webhook is validated here too, so no caller can bypass the SSRF check. */
export async function sendDiscord(
  fetchFn: typeof fetch,
  webhook: string,
  embed: DiscordEmbed,
): Promise<SendResult> {
  if (!isDiscordWebhookUrl(webhook)) return { kind: "dead" };

  const started = Date.now();
  let res: Response;
  try {
    res = await fetchFn(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
      redirect: "error",
    });
  } catch {
    logUpstream({ host: HOST, path: LOG_PATH, status: "error", ms: Date.now() - started });
    return { kind: "retry", retryAfterSeconds: null };
  }
  logUpstream({ host: HOST, path: LOG_PATH, status: res.status, ms: Date.now() - started });

  if (res.ok) {
    discardBody(res);
    return { kind: "sent" };
  }
  if (res.status === 429) {
    return { kind: "retry", retryAfterSeconds: await retryAfterSeconds(res) };
  }
  discardBody(res);
  if (res.status === 404 || res.status === 401) return { kind: "dead" };
  if (res.status >= 500) return { kind: "retry", retryAfterSeconds: null };
  return { kind: "rejected", status: res.status };
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @garden-hq/worker test -- discord.test.ts`, then `pnpm --filter @garden-hq/worker typecheck`, `pnpm lint`, `pnpm format`.
Expected: PASS. (If `discardBody` rejects a `Response` with a null body in `http.ts`, check its signature first; the 204 case passes `null` bodies in other existing tests.)

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/notify
git commit -m "feat(worker): Discord webhook notifier with SSRF check and result classification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Worker — `/api/alerts*` routes, CORS `PUT`, account cap

**Files:**
- Create: `apps/worker/src/routes/alerts.ts`, `apps/worker/src/routes/alerts.test.ts`
- Modify: `apps/worker/src/app.ts` (mount route, add `PUT` to CORS), `apps/worker/src/app.test.ts` (CORS assertion)

**Interfaces:**
- Consumes: Tasks 2-4; existing `authenticate`, `readJsonBody`, `AppError`.
- Produces (used by Task 9): HTTP contract, all authenticated with `Authorization: Bearer <sync code>`, all `Cache-Control: no-store`:

| Route | Body | Response |
|---|---|---|
| `GET /api/alerts` | | `AlertsStateResponse` |
| `PUT /api/alerts/webhook` | `{ url }` | `AlertsStateResponse` (webhook stored untested) |
| `DELETE /api/alerts/webhook` | | 204 (deletes settings, snapshot, alert log) |
| `POST /api/alerts/test` | | `AlertTestResponse` |
| `PUT /api/alerts/rules` | `{ rules: <partial AlertRules> }` | `AlertsStateResponse`; 400 until a test has succeeded |

- [ ] **Step 1: Write the failing tests** — `apps/worker/src/routes/alerts.test.ts`. First open `apps/worker/src/routes/sync.test.ts` and copy its account-creation helper (it signs up through `POST /api/account` and returns the sync code). Then:

```ts
import { defaultAlertRules } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { createAccount } from "../sync/db";
import { MAX_ALERTING_ACCOUNTS } from "../limits";
import { happyRoutes, makeHarness } from "../../test/helpers";

const HOOK_PATH = "/api/webhooks/123456789012345678/abcDEF_ghi-123";
const HOOK = `https://discord.com${HOOK_PATH}`;
const HOOK_ROUTE = `discord.com${HOOK_PATH}`;
const LINK = { name: "TestFarmer", uuid: "0123456789abcdef0123456789abcdef", profileId: "fedcba9876543210fedcba9876543210", profiles: [] };

function harness(discordStatus = 204) {
  return makeHarness(happyRoutes({ [HOOK_ROUTE]: () => new Response(null, { status: discordStatus }) }));
}

async function signUp(h: ReturnType<typeof harness>): Promise<Record<string, string>> {
  // Same flow as routes/sync.test.ts: create an account and return the auth header.
  const res = await h.request("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: LINK }) });
  const { syncCode } = (await res.json()) as { syncCode: string };
  return { Authorization: `Bearer ${syncCode}`, "Content-Type": "application/json" };
}

const put = (h: ReturnType<typeof harness>, auth: Record<string, string>, path: string, body: unknown) =>
  h.request(path, { method: "PUT", headers: auth, body: JSON.stringify(body) });

describe("auth", () => {
  it.each([
    ["GET", "/api/alerts"],
    ["PUT", "/api/alerts/webhook"],
    ["DELETE", "/api/alerts/webhook"],
    ["POST", "/api/alerts/test"],
    ["PUT", "/api/alerts/rules"],
  ])("%s %s needs a sync code", async (method, path) => {
    const h = harness();
    const res = await h.request(path, { method });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/alerts", () => {
  it("starts empty", async () => {
    const h = harness();
    const auth = await signUp(h);
    const res = await h.request("/api/alerts", { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasWebhook: false, webhookLast4: null, webhookOk: null, rules: null });
  });
});

describe("PUT /api/alerts/webhook", () => {
  it("stores a valid webhook untested and never returns the URL", async () => {
    const h = harness();
    const auth = await signUp(h);
    const res = await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ hasWebhook: true, webhookLast4: "-123", webhookOk: null, rules: null });
    expect(text).not.toContain("abcDEF");
    expect(await (await h.request("/api/alerts", { headers: auth })).text()).not.toContain("abcDEF");
  });
  it.each(["https://evil.com/api/webhooks/1/a", "nope", 5, null])("rejects %s", async (url) => {
    const h = harness();
    const auth = await signUp(h);
    expect((await put(h, auth, "/api/alerts/webhook", { url })).status).toBe(400);
  });
  it("refuses a new webhook once the free plan's alerting slots are full", async () => {
    const h = harness();
    const auth = await signUp(h);
    for (let i = 0; i < MAX_ALERTING_ACCOUNTS; i++) {
      await createAccount(h.env.DB, { id: `fill${i}`, codeHash: `fill-hash-${i}`, link: LINK, now: h.clock.now() });
      await h.env.DB.prepare("INSERT INTO alert_settings (account_id, discord_webhook, updated_at) VALUES (?1, ?2, 0)").bind(`fill${i}`, HOOK).run();
    }
    const res = await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect(res.status).toBe(429);
    // An account that already has a webhook may still replace it.
    await h.env.DB.prepare("DELETE FROM alert_settings WHERE account_id = 'fill0'").run();
    expect((await put(h, auth, "/api/alerts/webhook", { url: HOOK })).status).toBe(200);
    expect((await put(h, auth, "/api/alerts/webhook", { url: `${HOOK}x` })).status).toBe(200);
  });
});

describe("POST /api/alerts/test", () => {
  it("needs a webhook first", async () => {
    const h = harness();
    const auth = await signUp(h);
    expect((await h.request("/api/alerts/test", { method: "POST", headers: auth })).status).toBe(400);
  });
  it("on success marks the webhook ok and seeds the default rules", async () => {
    const h = harness(204);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    const res = await h.request("/api/alerts/test", { method: "POST", headers: auth });
    const body = (await res.json()) as { test: string; webhookOk: boolean; rules: ReturnType<typeof defaultAlertRules> };
    expect(body.test).toBe("sent");
    expect(body.webhookOk).toBe(true);
    expect(body.rules).toEqual(defaultAlertRules(true));
    expect(body.rules.composter_fuel_low.enabled).toBe(false);
  });
  it("404 from Discord marks the webhook dead", async () => {
    const h = harness(404);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    const body = (await (await h.request("/api/alerts/test", { method: "POST", headers: auth })).json()) as { test: string; webhookOk: boolean | null };
    expect(body.test).toBe("dead");
    expect(body.webhookOk).toBe(false);
  });
  it("a 5xx leaves the status untouched and says to try again", async () => {
    const h = harness(503);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    const body = (await (await h.request("/api/alerts/test", { method: "POST", headers: auth })).json()) as { test: string; webhookOk: boolean | null; rules: unknown };
    expect(body).toMatchObject({ test: "failed", webhookOk: null, rules: null });
  });
});

describe("PUT /api/alerts/rules", () => {
  async function verified() {
    const h = harness(204);
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    await h.request("/api/alerts/test", { method: "POST", headers: auth });
    return { h, auth };
  }
  it("is refused until a test message has succeeded", async () => {
    const h = harness();
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect((await put(h, auth, "/api/alerts/rules", { rules: { contest_soon: { enabled: false } } })).status).toBe(400);
  });
  it("merges a partial patch and persists it", async () => {
    const { h, auth } = await verified();
    const res = await put(h, auth, "/api/alerts/rules", { rules: { contest_soon: { leadMinutes: 10 }, composter_fuel_low: { enabled: true } } });
    expect(res.status).toBe(200);
    const state = (await (await h.request("/api/alerts", { headers: auth })).json()) as { rules: ReturnType<typeof defaultAlertRules> };
    expect(state.rules.contest_soon).toEqual({ enabled: true, leadMinutes: 10 });
    expect(state.rules.composter_fuel_low).toEqual({ enabled: true, leadMinutes: 30 });
  });
  it.each([
    { nope: { enabled: true } },
    { contest_soon: { leadMinutes: 0 } },
    { visitors_waiting: { threshold: 6 } },
    { contest_soon: { enabled: "yes" } },
  ])("rejects invalid rules %j", async (rules) => {
    const { h, auth } = await verified();
    expect((await put(h, auth, "/api/alerts/rules", { rules })).status).toBe(400);
  });
});

describe("DELETE /api/alerts/webhook", () => {
  it("removes the webhook and rules", async () => {
    const h = harness();
    const auth = await signUp(h);
    await put(h, auth, "/api/alerts/webhook", { url: HOOK });
    expect((await h.request("/api/alerts/webhook", { method: "DELETE", headers: auth })).status).toBe(204);
    expect(await (await h.request("/api/alerts", { headers: auth })).json()).toEqual({ hasWebhook: false, webhookLast4: null, webhookOk: null, rules: null });
  });
});

describe("CORS", () => {
  it("allows PUT from the web origin", async () => {
    const h = harness();
    const res = await h.request("/api/alerts/webhook", {
      method: "OPTIONS",
      headers: { Origin: "https://app.example", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });
});
```

If `makeHarness`'s `request` helper does not pass a body for `PUT`/`POST` the way `signUp` expects, mirror exactly how `routes/sync.test.ts` calls `h.request`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- routes/alerts.test.ts`
Expected: FAIL (routes return 404).

- [ ] **Step 3: Implement** — `apps/worker/src/routes/alerts.ts`

```ts
import {
  defaultAlertRules,
  parseAlertRules,
  type AlertsStateResponse,
  type AlertTestResponse,
} from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import {
  countWebhooks,
  loadAlertSettings,
  markWebhookDeadStmt,
  removeAlertSettings,
  saveRules,
  saveWebhook,
  verifyWebhookStmt,
  type AlertSettingsRow,
} from "../alerts/db";
import { authenticate } from "../auth";
import { readJsonBody } from "../body";
import type { Env } from "../env";
import { AppError } from "../errors";
import { MAX_ALERTING_ACCOUNTS } from "../limits";
import { isDiscordWebhookUrl, sendDiscord, TEST_EMBED, webhookLast4 } from "../notify/discord";

function toState(settings: AlertSettingsRow | null): AlertsStateResponse {
  const webhook = settings?.webhook ?? null;
  return {
    hasWebhook: webhook !== null,
    webhookLast4: webhook === null ? null : webhookLast4(webhook),
    webhookOk: settings?.webhookOk ?? null,
    rules: settings?.rules ?? null,
  };
}

export function alertsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/alerts", async (c) => {
    const account = await authenticate(c, deps.now);
    c.header("Cache-Control", "no-store");
    return c.json(toState(await loadAlertSettings(c.env.DB, account.id)));
  });

  route.put("/alerts/webhook", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    if (!isDiscordWebhookUrl(body.url)) {
      throw new AppError("bad_request", "That is not a Discord webhook URL (https://discord.com/api/webhooks/…)");
    }
    const existing = await loadAlertSettings(c.env.DB, account.id);
    if (existing?.webhook == null && (await countWebhooks(c.env.DB)) >= MAX_ALERTING_ACCOUNTS) {
      throw new AppError(
        "rate_limited",
        "Alerts are full right now — the free server only handles a few players.",
        3600,
      );
    }
    await saveWebhook(c.env.DB, account.id, body.url, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(toState(await loadAlertSettings(c.env.DB, account.id)));
  });

  route.delete("/alerts/webhook", async (c) => {
    const account = await authenticate(c, deps.now);
    await removeAlertSettings(c.env.DB, account.id);
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });

  route.post("/alerts/test", async (c) => {
    const account = await authenticate(c, deps.now);
    const settings = await loadAlertSettings(c.env.DB, account.id);
    if (settings?.webhook == null) {
      throw new AppError("bad_request", "Add a webhook first");
    }
    const result = await sendDiscord(deps.fetch, settings.webhook, TEST_EMBED);
    const now = deps.now();
    let test: AlertTestResponse["test"] = "failed";
    if (result.kind === "sent") {
      test = "sent";
      await verifyWebhookStmt(c.env.DB, account.id, JSON.stringify(defaultAlertRules(true)), now).run();
    } else if (result.kind === "dead") {
      test = "dead";
      await markWebhookDeadStmt(c.env.DB, account.id, now).run();
    }
    c.header("Cache-Control", "no-store");
    return c.json({ ...toState(await loadAlertSettings(c.env.DB, account.id)), test } satisfies AlertTestResponse);
  });

  route.put("/alerts/rules", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    const settings = await loadAlertSettings(c.env.DB, account.id);
    if (settings?.webhookOk !== true || settings.rules === null) {
      throw new AppError("bad_request", "Send a test message first so we know the webhook works");
    }
    const parsed = parseAlertRules(body.rules, settings.rules);
    if (!parsed.ok) throw new AppError("bad_request", parsed.error);
    await saveRules(c.env.DB, account.id, parsed.rules, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(toState(await loadAlertSettings(c.env.DB, account.id)));
  });

  return route;
}
```

Check `readJsonBody`'s return type in `apps/worker/src/body.ts`; the sync/account routes read `body.link` / `body.ops` from it, so `body.url` and `body.rules` work the same way. If it returns `Record<string, unknown>`, no change is needed.

- [ ] **Step 4: Mount the route and allow `PUT`** — in `apps/worker/src/app.ts`:

```ts
import { alertsRoute } from "./routes/alerts";
```
```ts
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
```
```ts
  app.route("/api", syncRoute(deps));
  app.route("/api", alertsRoute(deps));
```

Add to `apps/worker/src/app.test.ts` next to the existing CORS tests (mirror their structure) a case asserting `Access-Control-Allow-Methods` includes `PUT`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @garden-hq/worker test`, `pnpm --filter @garden-hq/worker typecheck`, `pnpm lint`, `pnpm format`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): /api/alerts routes (webhook, test message, rules) with account cap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Worker — subrequest `Budget` and shared contests loader

**Files:**
- Create: `apps/worker/src/budget.ts`, `apps/worker/src/budget.test.ts`
- Modify: `apps/worker/src/contests.ts`, `apps/worker/src/routes/contests.ts`

**Interfaces:**
- Produces (used by Task 7), exactly:

```ts
export class Budget {
  readonly limit: number;
  used: number;
  constructor(limit: number);
  charge(n: number): void;       // never throws
  canAfford(n: number): boolean; // used + n <= limit
}
export function countingFetch(fetchFn: typeof fetch, budget: Budget): typeof fetch; // charges 1 per call, passes through
// contests.ts
export const CONTESTS_CACHE_TTL_SECONDS: number;
export function getCachedContests(kv: KVNamespace, fetchFn: typeof fetch, now: () => number): Promise<{ value: ContestsResult; fetchedAt: number }>;
```

`countingFetch` deliberately **counts but never throws**: the Hypixel client treats any exception from `fetch` as a network error and retries, so a throwing wrapper would be swallowed and loop. The run decides with `canAfford` before each unit of work instead.

- [ ] **Step 1: Write the failing test** — `apps/worker/src/budget.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Budget, countingFetch } from "./budget";

describe("Budget", () => {
  it("tracks spend and what is affordable", () => {
    const b = new Budget(5);
    expect(b.canAfford(5)).toBe(true);
    b.charge(3);
    expect(b.used).toBe(3);
    expect(b.canAfford(2)).toBe(true);
    expect(b.canAfford(3)).toBe(false);
  });
  it("can overspend by charging (the real fetch happened); canAfford is the guard", () => {
    const b = new Budget(1);
    b.charge(4);
    expect(b.used).toBe(4);
    expect(b.canAfford(0)).toBe(false);
  });
});

describe("countingFetch", () => {
  it("charges one per call and passes the call through", async () => {
    const b = new Budget(10);
    const seen: string[] = [];
    const f = countingFetch((async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("ok");
    }) as typeof fetch, b);
    await f("https://a.test/");
    await f("https://b.test/");
    expect(b.used).toBe(2);
    expect(seen).toEqual(["https://a.test/", "https://b.test/"]);
  });
  it("counts a call even when it rejects", async () => {
    const b = new Budget(10);
    const f = countingFetch((async () => { throw new Error("down"); }) as typeof fetch, b);
    await expect(f("https://a.test/")).rejects.toThrow("down");
    expect(b.used).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — `apps/worker/src/budget.ts`

```ts
/**
 * Counts subrequests against the free plan's 50-per-invocation limit (fetch,
 * KV and D1 all count). It only counts; the caller asks `canAfford` before
 * each unit of work, because a throwing fetch wrapper would be swallowed by the
 * Hypixel client's retry loop.
 */
export class Budget {
  used = 0;

  constructor(readonly limit: number) {}

  charge(n: number): void {
    this.used += n;
  }

  canAfford(n: number): boolean {
    return this.used + n <= this.limit;
  }
}

export function countingFetch(fetchFn: typeof fetch, budget: Budget): typeof fetch {
  return ((input, init) => {
    budget.charge(1);
    return fetchFn(input, init);
  }) as typeof fetch;
}
```

- [ ] **Step 4: Share the contests loader** — add to `apps/worker/src/contests.ts` (new import at top: `import { cached } from "./cache";`):

```ts
export const CONTESTS_CACHE_TTL_SECONDS = 15 * 60;

/** Shared by GET /api/contests and the cron: one KV key, so at most 96 writes/day for everyone. */
export function getCachedContests(
  kv: KVNamespace,
  fetchFn: typeof fetch,
  now: () => number,
): Promise<{ value: ContestsResult; fetchedAt: number }> {
  return cached(kv, "contests", CONTESTS_CACHE_TTL_SECONDS, now, () => fetchContests(fetchFn));
}
```

Replace the body of `apps/worker/src/routes/contests.ts` so the route uses it (remove the local `CACHE_TTL_SECONDS` and the `cached`/`fetchContests` imports):

```ts
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { getCachedContests } from "../contests";
import type { Env } from "../env";

export function contestsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/contests", async (c) => {
    const { value, fetchedAt } = await getCachedContests(c.env.CACHE, deps.fetch, deps.now);

    c.header("Cache-Control", "public, max-age=60");
    return c.json({ ...value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @garden-hq/worker test` (the existing `routes/contests.test.ts` and `contests.test.ts` must pass unchanged), `pnpm --filter @garden-hq/worker typecheck`, `pnpm lint`, `pnpm format`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): subrequest Budget and shared contests loader

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Worker — `runSync` (the cron job)

**Files:**
- Create: `apps/worker/src/cron.ts`, `apps/worker/src/cron.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4 and 6 (`deriveAlerts`, `nextSyncAt`, `AlertInput`, the DB statements, `sendDiscord`, `alertEmbed`, `Budget`, `countingFetch`, `getCachedContests`), existing `createHypixelClient`, `createRateLimitState`, `AppError`, `logError`.
- Produces (used by Task 8), exactly:

```ts
export interface CronDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Tests pass a fresh one; production uses a module-level state shared within an isolate. */
  hypixelState?: RateLimitState;
}
export type StoppedBecause = "done" | "budget" | "hypixel_key" | "hypixel_rate";
export interface RunSummary {
  due: number;
  processed: number;
  hypixelCalls: number;
  sent: number;
  subrequests: number;
  stoppedBecause: StoppedBecause;
}
export function runSync(env: Env, deps: CronDeps): Promise<RunSummary>;
export function scheduledSync(env: Env): Promise<RunSummary>;
```

Per-run algorithm (this is the spec's "Per run" list, made concrete):
1. `loadDueAccounts` (1 subrequest), `loadAccountData` (2), contests via the shared KV cache (charged 2 + its real fetches).
2. For each due account, in order, while `budget.canAfford(MIN_ACCOUNT_COST)`: reuse the stored snapshot if under 5 minutes old, else (if under the per-run Hypixel cap and the budget can afford a 3-attempt call) fetch the garden; derive candidates; **one batch** = snapshot upsert (if fetched) + `next_sync_at` + one `INSERT OR IGNORE` claim per candidate; send to Discord only for claims that won; release claims on 5xx/429/network; on 404/401 mark the webhook dead and keep the claims.
3. Each account is in its own `try/catch` (log the error *name* only). A Hypixel 401/403 stops the whole run.
4. On the run that crosses UTC midnight, prune `alert_log`.

- [ ] **Step 1: Write the failing tests** — `apps/worker/src/cron.test.ts`

```ts
import { defaultAlertRules, type AlertRules, type Contest, type GardenState } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimStmt,
  loadAlertSettings,
  saveSnapshotStmt,
  saveWebhook,
  verifyWebhookStmt,
} from "./alerts/db";
import { runSync } from "./cron";
import { createRateLimitState } from "./hypixel";
import { CRON_BATCH, MAX_HYPIXEL_CALLS_PER_RUN, SUBREQUEST_BUDGET } from "./limits";
import { applyOpsToDb, createAccount } from "./sync/db";
import {
  ELITEBOT_ROUTE,
  GARDEN_ROUTE,
  START_TIME,
  happyRoutes,
  json,
  makeClock,
  makeEnv,
  makeSleep,
  routedFetch,
  type FakeHandler,
} from "../test/helpers";
import type { Env } from "./env";

const NOW = START_TIME;
const MIN = 60_000;
const DAY = 86_400_000;
const HOOK_PATH = "/api/webhooks/123456789012345678/abcDEF_ghi-123";
const HOOK = `https://discord.com${HOOK_PATH}`;
const HOOK_ROUTE = `discord.com${HOOK_PATH}`;
const LINK = { name: "TestFarmer", uuid: "0123456789abcdef0123456789abcdef", profileId: "fedcba9876543210fedcba9876543210", profiles: [] };

afterEach(() => vi.restoreAllMocks());

/** No fuel: the composter has been out since the last save, so fuel_out fires. */
function emptyFuel(over: Partial<GardenState["composter"]> = {}): GardenState {
  return garden({ fuel: 0, ...over });
}
/** Plenty of everything: no composter alert. */
function quiet(): GardenState {
  return garden({ fuel: 1e9, organicMatter: 1e9 });
}
function garden(c: Partial<GardenState["composter"]>): GardenState {
  return {
    level: 8, experience: 1000, unlockedPlotIds: ["beginner_1"], visitorsServedTotal: 0, visitors: [],
    greenhouse: { lockedCells: [] },
    composter: {
      organicMatter: 100_000, fuel: 0, compostUnits: 0, lastSave: NOW - 60 * MIN,
      upgrades: { speed: 0, multiDrop: 0, fuelCap: 0, organicMatterCap: 0, costReduction: 0 },
      ...c,
    },
  };
}

interface Seed {
  id: string;
  garden?: GardenState;
  /** Minutes old; default 1 (fresh enough to reuse). */
  snapshotAgeMin?: number;
  rules?: AlertRules;
}

async function seed(db: D1Database, s: Seed): Promise<void> {
  await createAccount(db, { id: s.id, codeHash: `hash-${s.id}`, link: LINK, now: NOW });
  await applyOpsToDb(db, s.id, [{ t: "setAssignment", plotId: "beginner_1", cropId: "wheat" }], NOW);
  await saveWebhook(db, s.id, HOOK, NOW);
  await verifyWebhookStmt(db, s.id, JSON.stringify(s.rules ?? defaultAlertRules(true)), NOW).run();
  if (s.garden !== undefined) {
    await saveSnapshotStmt(db, s.id, NOW - (s.snapshotAgeMin ?? 1) * MIN, s.garden).run();
  }
}

/** The cron reads the shared `contests` KV entry; a far-future fetchedAt keeps it fresh whatever the test clock does. */
async function seedContests(env: Env, contests: Contest[]): Promise<void> {
  await env.CACHE.put("contests", JSON.stringify({
    fetchedAt: NOW + 30 * DAY,
    value: { contests, source: { name: "EliteBot", url: "https://elitebot.dev" } },
  }));
}

const makeDue = (db: D1Database) => db.prepare("UPDATE alert_settings SET next_sync_at = 0").run();
const nextSync = async (db: D1Database, id: string) =>
  (await db.prepare("SELECT next_sync_at AS n FROM alert_settings WHERE account_id = ?1").bind(id).first<{ n: number }>())?.n;

function setup(routes: Record<string, FakeHandler> = {}, start = NOW) {
  const clock = makeClock(start);
  const { sleep } = makeSleep();
  const bodies: string[] = [];
  const net = routedFetch(happyRoutes({ [HOOK_ROUTE]: () => new Response(null, { status: 204 }), ...routes }));
  const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/webhooks/")) bodies.push(String(init?.body));
    return net.fetch(input, init);
  }) as typeof fetch;
  const env = makeEnv();
  return {
    clock, env, net, bodies,
    run: () => runSync(env, { fetch: recording, now: clock.now, sleep, hypixelState: createRateLimitState() }),
    posts: () => net.calls.filter((c) => c === HOOK_ROUTE).length,
    gardenCalls: () => net.calls.filter((c) => c === GARDEN_ROUTE).length,
  };
}

describe("runSync — delivery and dedupe", () => {
  it("sends the fuel alert once across two consecutive runs", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    const first = await t.run();
    expect(first).toMatchObject({ due: 1, processed: 1, sent: 1, hypixelCalls: 0, stoppedBecause: "done" });
    expect(t.posts()).toBe(1);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    await t.run();
    expect(t.posts()).toBe(1); // same lastSave -> same key -> claim lost -> no second message
  });

  it("re-arms after a refill (new last_save -> new key)", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    await saveSnapshotStmt(t.env.DB, "a", NOW, emptyFuel({ lastSave: NOW - 10 * MIN })).run();
    await makeDue(t.env.DB);
    t.clock.advance(MIN);
    await t.run();
    expect(t.posts()).toBe(2);
  });

  it("sends a contest alert once, as an embed that cannot ping", async () => {
    const t = setup();
    await seedContests(t.env, [{ startsAt: NOW + 4 * MIN, crops: ["wheat", "carrot", "potato"] }]);
    await seed(t.env.DB, { id: "a", garden: quiet() });
    await t.run();
    expect(t.posts()).toBe(1);
    const payload = JSON.parse(t.bodies[0] ?? "{}") as { embeds: { title: string; footer: { text: string } }[]; allowed_mentions: unknown };
    expect(payload.embeds[0]?.title).toContain("Wheat");
    expect(payload.embeds[0]?.footer.text).toMatch(/^Last synced \d+ min ago/);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("sends nothing when the rule is off", async () => {
    const t = setup();
    await seedContests(t.env, []);
    const rules = defaultAlertRules(true);
    rules.composter_fuel_out = { enabled: false };
    await seed(t.env.DB, { id: "a", garden: emptyFuel(), rules });
    await t.run();
    expect(t.posts()).toBe(0);
  });

  it("does not look at an account whose rules are all off", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel(), rules: defaultAlertRules(false) });
    expect(await t.run()).toMatchObject({ due: 0, sent: 0 });
  });
});

describe("runSync — Discord failures", () => {
  it("releases the claim on a 5xx and retries next run", async () => {
    let calls = 0;
    const t = setup({ [HOOK_ROUTE]: () => new Response(null, { status: ++calls === 1 ? 500 : 204 }) });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    const first = await t.run();
    expect(first.sent).toBe(0);
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);

    t.clock.advance(MIN);
    await makeDue(t.env.DB);
    const second = await t.run();
    expect(second.sent).toBe(1);
    expect(t.posts()).toBe(2);
  });

  it("honours a 429 retry_after for the reschedule", async () => {
    const t = setup({ [HOOK_ROUTE]: () => json({ retry_after: 600 }, { status: 429 }) });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 600_000);
  });

  it("a 404 marks the webhook dead, stops for that account, and keeps the claim", async () => {
    const t = setup({ [HOOK_ROUTE]: () => new Response(null, { status: 404 }) });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    expect((await loadAlertSettings(t.env.DB, "a"))?.webhookOk).toBe(false);
    expect((await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_log").first<{ n: number }>())?.n).toBe(1);

    await makeDue(t.env.DB);
    t.clock.advance(MIN);
    await t.run();
    expect(t.posts()).toBe(1); // no longer due: not asked again
  });
});

describe("runSync — isolation, caps and budget", () => {
  it("one failing account does not block the others", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "bad", garden: emptyFuel() });
    await seed(t.env.DB, { id: "good", garden: emptyFuel() });
    const realDb = t.env.DB;
    // Fail only the per-account write batch for "bad" (its setNextSync statement binds the id first).
    const failing = Object.assign(Object.create(realDb) as D1Database, {
      batch: (stmts: D1PreparedStatement[]) =>
        stmts.some((s) => {
          const st = s as unknown as { sql: string; params: unknown[] };
          return st.sql.includes("next_sync_at") && st.params[0] === "bad";
        })
          ? Promise.reject(new Error("boom"))
          : realDb.batch(stmts),
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await runSync({ ...t.env, DB: failing }, {
      fetch: t.net.fetch, now: t.clock.now, sleep: async () => undefined, hypixelState: createRateLimitState(),
    });
    expect(summary.sent).toBe(1);
    expect(t.posts()).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("cron_account_failed");
  });

  it("processes at most CRON_BATCH accounts per run, oldest first, the rest next run", async () => {
    const t = setup();
    await seedContests(t.env, []);
    for (let i = 0; i < CRON_BATCH + 2; i++) await seed(t.env.DB, { id: `acc${String(i).padStart(2, "0")}`, garden: quiet() });
    expect(await t.run()).toMatchObject({ due: CRON_BATCH, processed: CRON_BATCH });
    const left = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_settings WHERE next_sync_at = 0").first<{ n: number }>();
    expect(left?.n).toBe(2);
    expect(await t.run()).toMatchObject({ due: 2 });
  });

  it("caps Hypixel calls per run and leaves the rest untouched", async () => {
    const t = setup();
    await seedContests(t.env, []);
    for (let i = 0; i < CRON_BATCH; i++) await seed(t.env.DB, { id: `acc${String(i).padStart(2, "0")}` }); // no snapshot
    const summary = await t.run();
    expect(t.gardenCalls()).toBe(MAX_HYPIXEL_CALLS_PER_RUN);
    expect(summary.hypixelCalls).toBe(MAX_HYPIXEL_CALLS_PER_RUN);
    expect(summary.subrequests).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    const untouched = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_settings WHERE next_sync_at = 0").first<{ n: number }>();
    expect(untouched?.n).toBe(CRON_BATCH - MAX_HYPIXEL_CALLS_PER_RUN);
  });

  it("reuses a fresh snapshot and refetches a stale one", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "fresh", garden: quiet(), snapshotAgeMin: 1 });
    await seed(t.env.DB, { id: "stale", garden: quiet(), snapshotAgeMin: 10 });
    await t.run();
    expect(t.gardenCalls()).toBe(1);
    const row = await t.env.DB.prepare("SELECT fetched_at AS f FROM garden_snapshot WHERE account_id = 'stale'").first<{ f: number }>();
    expect(row?.f).toBe(NOW);
  });

  it("stops the whole run when Hypixel rejects the key", async () => {
    const t = setup({ [GARDEN_ROUTE]: () => json({ success: false, cause: "Invalid API key" }, { status: 403 }) });
    await seedContests(t.env, []);
    for (const id of ["a", "b", "c"]) await seed(t.env.DB, { id });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await t.run();
    expect(summary.stoppedBecause).toBe("hypixel_key");
    expect(t.gardenCalls()).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toContain("hypixel_key_rejected");
  });

  it("backs an account off when Hypixel is down, and carries on", async () => {
    const t = setup({ [GARDEN_ROUTE]: () => new Response("down", { status: 500 }) });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a" });
    const summary = await t.run();
    expect(summary.stoppedBecause).toBe("done");
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);
  });
});

describe("runSync — scheduling", () => {
  it("checks again in 15 minutes when nothing is coming up", async () => {
    const t = setup();
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: quiet() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 15 * MIN);
  });
  it("checks again in 5 minutes when a contest alert is about to fire", async () => {
    const t = setup();
    await seedContests(t.env, [{ startsAt: NOW + 15 * MIN, crops: ["wheat"] }]);
    await seed(t.env.DB, { id: "a", garden: quiet() });
    await t.run();
    expect(await nextSync(t.env.DB, "a")).toBe(NOW + 5 * MIN);
  });
});

describe("runSync — housekeeping and secrecy", () => {
  it("prunes the alert log on the run that crosses UTC midnight, not on others", async () => {
    const midnight = Date.UTC(2026, 9, 2, 0, 1, 0);
    const t = setup({}, midnight);
    await seed(t.env.DB, { id: "a" });
    await claimStmt(t.env.DB, "a", "t", "old", midnight - 8 * DAY).run();
    await claimStmt(t.env.DB, "a", "t", "new", midnight - DAY).run();
    await t.env.DB.prepare("UPDATE alert_settings SET webhook_ok = 0").run(); // nothing due; prune still runs
    await t.run();
    const keys = (await t.env.DB.prepare("SELECT key FROM alert_log").all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(["new"]);

    await claimStmt(t.env.DB, "a", "t", "old2", midnight - 9 * DAY).run();
    t.clock.advance(5 * MIN);
    await t.run();
    expect((await t.env.DB.prepare("SELECT COUNT(*) AS n FROM alert_log").first<{ n: number }>())?.n).toBe(2);
  });

  it("never writes the webhook URL or token to any log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = setup({ [HOOK_ROUTE]: () => new Response(null, { status: 404 }) });
    await seedContests(t.env, []);
    await seed(t.env.DB, { id: "a", garden: emptyFuel() });
    await t.run();
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(all).not.toContain("abcDEF_ghi-123");
    expect(all).not.toContain("123456789012345678");
  });

  it("continues without contest alerts when the contest sources are down", async () => {
    const t = setup({ [ELITEBOT_ROUTE]: () => new Response("x", { status: 500 }) });
    await seed(t.env.DB, { id: "a", garden: emptyFuel() }); // no seeded contests, cache miss, source down
    const summary = await t.run();
    expect(summary.sent).toBe(1); // the fuel alert still goes out
  });
});
```

Notes: (1) `happyRoutes` serves only `ELITEBOT_ROUTE`; with the Strassburger fallback unrouted, "sources down" makes `fetchContests` throw, which `runSync` must catch. (2) `createAccount` leaves `last_seen_at = NOW`, so seeded accounts are active. (3) The "failing account" test passes `{ ...t.env, DB: failing }`; if `makeEnv()` returns a class instance, build the env with `makeEnv({ DB: failing })` instead.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- cron.test.ts`
Expected: FAIL, cannot resolve `./cron`.

- [ ] **Step 3: Implement** — `apps/worker/src/cron.ts`

```ts
import {
  deriveAlerts,
  nextSyncAt,
  normalizeGarden,
  unwrapGardenResponse,
  type AlertCandidate,
  type AlertInput,
  type Contest,
  type GardenState,
} from "@garden-hq/core";
import {
  claimStmt,
  loadAccountData,
  loadDueAccounts,
  markWebhookDeadStmt,
  parseSnapshot,
  parseStoredRules,
  pruneAlertLogStmt,
  releaseClaimStmt,
  saveSnapshotStmt,
  setNextSyncStmt,
  type DueAccount,
  type StoredPlayerData,
} from "./alerts/db";
import { Budget, countingFetch } from "./budget";
import { getCachedContests } from "./contests";
import type { Env } from "./env";
import { AppError } from "./errors";
import {
  createHypixelClient,
  createRateLimitState,
  type HypixelClient,
  type RateLimitState,
} from "./hypixel";
import {
  CRON_BATCH,
  CRON_ERROR_RETRY_MS,
  CRON_NO_GARDEN_RETRY_MS,
  HYPIXEL_ATTEMPT_RESERVE,
  MAX_HYPIXEL_CALLS_PER_RUN,
  SNAPSHOT_REUSE_MS,
  SUBREQUEST_BUDGET,
  utcDay,
} from "./limits";
import { logError } from "./log";
import { alertEmbed, sendDiscord } from "./notify/discord";

export interface CronDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  hypixelState?: RateLimitState;
}

export type StoppedBecause = "done" | "budget" | "hypixel_key" | "hypixel_rate";

export interface RunSummary {
  due: number;
  processed: number;
  hypixelCalls: number;
  sent: number;
  subrequests: number;
  stoppedBecause: StoppedBecause;
}

/** Shared across cron invocations in one isolate so RateLimit-* headers carry over. */
const isolateHypixelState = createRateLimitState();

/** Fewest subrequests worth starting an account for: its snapshot + next_sync batch. */
const MIN_ACCOUNT_COST = 2;
/** Cron ticks every 5 minutes; this is the tick that crosses UTC midnight. */
const TICK_MS = 5 * 60_000;
/** An account with nothing enabled (rules changed under us) is parked for an hour. */
const PARK_MS = 60 * 60_000;

class StopRun extends Error {
  constructor(readonly reason: "hypixel_key" | "hypixel_rate") {
    super(reason);
  }
}

interface RunContext {
  env: Env;
  now: number;
  budget: Budget;
  fetchFn: typeof fetch;
  client: HypixelClient;
  contests: Contest[];
  data: Map<string, StoredPlayerData>;
  summary: RunSummary;
}

async function loadContests(env: Env, ctx: { fetchFn: typeof fetch; now: () => number; budget: Budget }): Promise<Contest[]> {
  ctx.budget.charge(2); // KV read, plus a write on a cache miss
  try {
    return (await getCachedContests(env.CACHE, ctx.fetchFn, ctx.now)).value.contests;
  } catch {
    logError("cron_contests_unavailable");
    return [];
  }
}

async function setNextSync(ctx: RunContext, accountId: string, at: number): Promise<void> {
  await setNextSyncStmt(ctx.env.DB, accountId, at).run();
  ctx.budget.charge(1);
}

/** Returns the fresh garden, or null after deferring the account. Throws StopRun for run-wide problems. */
async function fetchGarden(ctx: RunContext, account: DueAccount): Promise<GardenState | null> {
  ctx.summary.hypixelCalls++;
  try {
    const raw = unwrapGardenResponse(await ctx.client.garden(account.profileId));
    if (raw === null) {
      await setNextSync(ctx, account.accountId, ctx.now + CRON_NO_GARDEN_RETRY_MS);
      return null;
    }
    return normalizeGarden(raw);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === "bad_api_key" || err.code === "missing_api_key") {
      logError("hypixel_key_rejected");
      throw new StopRun("hypixel_key");
    }
    if (err.code === "rate_limited") throw new StopRun("hypixel_rate");
    await setNextSync(ctx, account.accountId, ctx.now + CRON_ERROR_RETRY_MS);
    return null;
  }
}

async function deliver(
  ctx: RunContext,
  account: DueAccount,
  syncedAt: number,
  won: AlertCandidate[],
): Promise<void> {
  const db = ctx.env.DB;
  const release: AlertCandidate[] = [];
  let stop: "retry" | "dead" | null = null;
  let retryAfterMs = CRON_ERROR_RETRY_MS;

  for (const candidate of won) {
    if (stop === "retry") {
      release.push(candidate);
      continue;
    }
    if (stop === "dead") continue; // claims are kept: a re-added webhook must not replay stale alerts
    const result = await sendDiscord(ctx.fetchFn, account.webhook, alertEmbed(candidate, syncedAt, ctx.now));
    if (result.kind === "sent") {
      ctx.summary.sent++;
    } else if (result.kind === "retry") {
      stop = "retry";
      release.push(candidate);
      if (result.retryAfterSeconds !== null) {
        retryAfterMs = Math.max(retryAfterMs, result.retryAfterSeconds * 1000);
      }
    } else if (result.kind === "dead") {
      stop = "dead";
      logError("webhook_dead");
    } else {
      logError("discord_rejected", { status: result.status });
    }
  }

  const stmts = release.map((c) => releaseClaimStmt(db, account.accountId, c.type, c.key));
  if (stop === "retry") stmts.push(setNextSyncStmt(db, account.accountId, ctx.now + retryAfterMs));
  if (stop === "dead") stmts.push(markWebhookDeadStmt(db, account.accountId, ctx.now));
  if (stmts.length > 0) {
    await db.batch(stmts);
    ctx.budget.charge(stmts.length);
  }
}

async function processAccount(ctx: RunContext, account: DueAccount): Promise<void> {
  const { env, now, budget, summary } = ctx;
  const db = env.DB;

  const rules = parseStoredRules(account.rules);
  if (rules === null || !Object.values(rules).some((r) => r.enabled)) {
    await setNextSync(ctx, account.accountId, now + PARK_MS);
    return;
  }

  const cached = parseSnapshot(account.snapshotJson, account.snapshotFetchedAt);
  let current = cached !== null && now - cached.fetchedAt < SNAPSHOT_REUSE_MS ? cached : null;
  let fetched = false;
  if (current === null) {
    if (
      summary.hypixelCalls >= MAX_HYPIXEL_CALLS_PER_RUN ||
      !budget.canAfford(HYPIXEL_ATTEMPT_RESERVE + MIN_ACCOUNT_COST)
    ) {
      return; // keeps next_sync_at, so it goes first next run
    }
    const garden = await fetchGarden(ctx, account);
    if (garden === null) return;
    current = { garden, fetchedAt: now };
    fetched = true;
  }

  const stored = ctx.data.get(account.accountId) ?? { assignments: {}, greenhouses: {} };
  const input: AlertInput = {
    now,
    garden: current.garden,
    contests: ctx.contests,
    assignments: stored.assignments,
    greenhouses: stored.greenhouses,
    rules,
  };

  const candidates = deriveAlerts(input);
  // Each candidate can cost a claim, a send and a release; require room for all three.
  const affordable =
    candidates.length === 0 || budget.canAfford(MIN_ACCOUNT_COST + candidates.length * 3);
  const claims = affordable ? candidates : [];
  if (!affordable) summary.stoppedBecause = "budget";
  // Out of budget: leave the account due so the next run sends the alerts.
  const nextAt = affordable ? nextSyncAt(input, current.fetchedAt) : now;

  const stmts: D1PreparedStatement[] = [];
  if (fetched) stmts.push(saveSnapshotStmt(db, account.accountId, current.fetchedAt, current.garden));
  stmts.push(setNextSyncStmt(db, account.accountId, nextAt));
  const claimStart = stmts.length;
  for (const c of claims) stmts.push(claimStmt(db, account.accountId, c.type, c.key, now));

  const results = await db.batch(stmts);
  budget.charge(stmts.length);

  const won = claims.filter((_, i) => results[claimStart + i]?.meta.changes === 1);
  await deliver(ctx, account, current.fetchedAt, won);
}

export async function runSync(env: Env, deps: CronDeps): Promise<RunSummary> {
  const now = deps.now();
  const budget = new Budget(SUBREQUEST_BUDGET);
  const fetchFn = countingFetch(deps.fetch, budget);
  const client = createHypixelClient({
    fetch: fetchFn,
    apiKey: env.HYPIXEL_API_KEY,
    now: deps.now,
    sleep: deps.sleep,
    state: deps.hypixelState ?? isolateHypixelState,
  });
  const summary: RunSummary = {
    due: 0, processed: 0, hypixelCalls: 0, sent: 0, subrequests: 0, stoppedBecause: "done",
  };

  const due = await loadDueAccounts(env.DB, now, CRON_BATCH);
  budget.charge(1);
  summary.due = due.length;

  if (due.length > 0) {
    const data = await loadAccountData(env.DB, due.map((a) => a.accountId));
    budget.charge(2);
    const contests = await loadContests(env, { fetchFn, now: deps.now, budget });
    const ctx: RunContext = { env, now, budget, fetchFn, client, contests, data, summary };

    for (const account of due) {
      if (!budget.canAfford(MIN_ACCOUNT_COST)) {
        summary.stoppedBecause = "budget";
        break;
      }
      try {
        await processAccount(ctx, account);
        summary.processed++;
      } catch (err) {
        if (err instanceof StopRun) {
          summary.stoppedBecause = err.reason;
          break;
        }
        // Name only: messages can carry SQL parameters (the webhook URL).
        logError("cron_account_failed", { name: err instanceof Error ? err.name : "unknown" });
      }
    }
  }

  if (utcDay(now) !== utcDay(now - TICK_MS) && budget.canAfford(1)) {
    await pruneAlertLogStmt(env.DB, now).run();
    budget.charge(1);
  }

  summary.subrequests = budget.used;
  console.log(JSON.stringify({ event: "cron_run", ...summary }));
  return summary;
}

export async function scheduledSync(env: Env): Promise<RunSummary> {
  try {
    return await runSync(env, {
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  } catch (err) {
    logError("cron_failed", { name: err instanceof Error ? err.name : "unknown" });
    throw err;
  }
}
```

Implementation notes:
- `utcDay` is exported from `limits.ts` (already used by `sync/db.ts`).
- The "failing account" test fails `db.batch`; a thrown DB error propagates out of `processAccount` as a non-`StopRun` error and is caught per account, as required. `summary.processed` counts only successes.
- `results[claimStart + i]?.meta.changes` relies on the test adapter's `batch` returning `{ meta: { changes } }` per statement (it does, `Stmt.exec`); real D1 returns the same `meta.changes`. If the adapter's `batch` returns a different shape, fix the adapter, not this code.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @garden-hq/worker test -- cron.test.ts`
Expected: PASS. If the "caps Hypixel calls" test shows `subrequests` above 40, the afford checks are wrong; fix the checks, do not raise the budget.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @garden-hq/worker test`, `pnpm --filter @garden-hq/worker typecheck`, `pnpm lint`, `pnpm format`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): runSync cron job with claim-first dedupe, subrequest budget and per-account isolation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Worker — schedule it (Cron Trigger, `scheduled` export) and document operations

**Files:**
- Modify: `apps/worker/src/index.ts`, `apps/worker/src/index.test.ts`, `apps/worker/wrangler.toml`, `apps/worker/README.md`, `data/VERIFY.md`

**Interfaces:**
- Consumes: Task 7 `scheduledSync`.
- Produces: the deployed Worker exports `{ fetch, scheduled }`; `export const app` for tests.

- [ ] **Step 1: Update the existing test and add a failing one** — `apps/worker/src/index.test.ts`

```ts
import { describe, expect, it } from "vitest";
import worker, { app } from "./index";
import { makeEnv } from "../test/helpers";

describe("GET /health", () => {
  it("returns ok status and the core ping", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      core: "garden-hq core is alive",
    });
  });
});

describe("scheduled", () => {
  it("is exported and runs the sync inside waitUntil", async () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");

    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as unknown as ExecutionContext;
    worker.scheduled({} as ScheduledController, makeEnv(), ctx);
    expect(pending).toHaveLength(1);
    await expect(pending[0]).resolves.toMatchObject({ due: 0, stoppedBecause: "done" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- index.test.ts`
Expected: FAIL (`app` is not exported, `worker.scheduled` is undefined).

- [ ] **Step 3: Implement** — `apps/worker/src/index.ts`

```ts
import { createApp } from "./app";
import { scheduledSync } from "./cron";
import type { Env } from "./env";

export const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(scheduledSync(env));
  },
} satisfies ExportedHandler<Env>;
```

If `ExportedHandler`/`ScheduledController`/`ExecutionContext` are not in scope, they come from `@cloudflare/workers-types`; check `apps/worker/tsconfig.json` `types` (the repo already uses `D1Database` and `KVNamespace` globals, so they are).

- [ ] **Step 4: Add the Cron Trigger** — append to `apps/worker/wrangler.toml`:

```toml

# Discord alerts: sync due accounts and send alerts every 5 minutes.
# Free plan allows 5 Cron Triggers per account; this uses one.
[triggers]
crons = ["*/5 * * * *"]
```

- [ ] **Step 5: README** — in `apps/worker/README.md`:

(a) In the opening route list add `GET /api/alerts`, `PUT/DELETE /api/alerts/webhook`, `POST /api/alerts/test`, `PUT /api/alerts/rules`.

(b) Add under "## D1 migrations" the sentence: "`0003_alerts.sql` adds `alert_settings`, `garden_snapshot` and `alert_log`."

(c) Append these sections before "## Local dev":

```md
## Discord alerts (cron)

- `wrangler.toml` `[triggers] crons = ["*/5 * * * *"]`. `scheduled()` calls `scheduledSync` → `runSync` in `src/cron.ts`.
- Each run: up to `CRON_BATCH` (10) due accounts, at most `MAX_HYPIXEL_CALLS_PER_RUN` (8) Hypixel calls, a counted subrequest budget of `SUBREQUEST_BUDGET` (40 of the free plan's 50), and a stored garden under 5 minutes old is reused instead of refetched. Constants live in `src/limits.ts`.
- Alerts are **claimed** in `alert_log` (`INSERT OR IGNORE`) before they are sent, so overlapping runs cannot double send. A Discord 5xx/429/network failure releases the claim and retries next run; a 404/401 marks the webhook dead (the player must add a new one in Settings → Alerts).
- Free-plan capacity is a few dozen alerting players: `MAX_ALERTING_ACCOUNTS` (24) accounts may hold a webhook, and accounts with no authenticated request for 60 days are skipped.
- The webhook URL is a secret: stored in D1 only, never returned, never logged. Log lines are `cron_run` (counts only), `hypixel_key_rejected`, `webhook_dead`, `cron_account_failed` (error name only), `cron_contests_unavailable`.

## Rotating the Hypixel API key

Alerts depend on `HYPIXEL_API_KEY`. **Development keys are temporary**; when one expires, the cron's Hypixel calls fail with 403 and alerts stop. The cron logs `hypixel_key_rejected` and stops the run instead of burning calls.

1. Create a new key at developer.hypixel.net.
2. `pnpm --filter @garden-hq/worker exec wrangler secret put HYPIXEL_API_KEY` and paste it. No redeploy needed.
3. Check that `GET /api/garden?profile=…` works for a linked profile and that `wrangler tail` shows `cron_run` without `hypixel_key_rejected`.

A **production (application) key** from Hypixel is required before anyone but the owner uses alerts.

## First cron deploy checklist (owner)

After the first deploy that contains the Cron Trigger:

1. `wrangler tail`: at the next `*/5` tick, a `cron_run` line appears, with no `unhandled`/`cron_failed`.
2. **CPU time under 10 ms** per cron invocation (free plan). If it is over, lower `CRON_BATCH` / `MAX_HYPIXEL_CALLS_PER_RUN` in `src/limits.ts`. This is the biggest unmeasured risk.
3. `subrequests` in `cron_run` stays ≤ 40 and no "Too many subrequests" error appears.
4. Settings → Alerts → paste a webhook → "Send test message" arrives in Discord; then trigger a real alert (e.g. lower the visitor threshold with visitors in the queue) and confirm exactly one message.
5. `wrangler d1 info garden-hq`: row counts and size look sane.
```

(d) In the "Limits" paragraph's end add: "Alerts: see 'Discord alerts (cron)'."

- [ ] **Step 6: VERIFY entries** — append to `data/VERIFY.md`:

```md
## Alerts cron (Phase 3C, 2026-10-29)

- **CPU per cron run vs the 10 ms free limit** — parsing up to 10 stored snapshots (~5 KB each), up to 8 garden normalizations and the derive step are unmeasured. Measure on the first deploy with `wrangler tail`; lower `CRON_BATCH` / `MAX_HYPIXEL_CALLS_PER_RUN` if needed.
- **Subrequest counting** — the budget counts every D1 statement in a batch individually, every real `fetch`, and 2 for the contests KV read/write. Whether a `db.batch` counts as one query is unconfirmed (see "D1 batch query counting"); counting each statement is the conservative reading.
- **Discord webhook behaviour** — assumed: 2xx (204) on success without `?wait=true`; 404 for a deleted webhook and 401 for a bad token; 429 with a JSON `retry_after` (seconds, may be fractional) and/or a `Retry-After` header. Confirm against Discord's docs / a real webhook on the first deploy.
- **Hypixel `last_save` freshness** — `composter_data.last_save` drives the fuel forecast; whether it advances while the player is offline from SkyBlock is unverified (spec "Open verification items").
- **Snapshot reuse** — a stored garden under 5 minutes old is reused, so in the 5-minute fast mode visitor alerts can lag up to ~10 minutes. Accepted for the free plan's Hypixel call budget.
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @garden-hq/worker test`, `pnpm --filter @garden-hq/worker typecheck`, `pnpm lint`, `pnpm format`.
Then a dry run of the config (no network): `pnpm --filter @garden-hq/worker exec wrangler deploy --dry-run --outdir=$TEMP/wrangler-dry` — expected: the output lists the `schedule: */5 * * * *` trigger and the D1/KV bindings, no errors. Do **not** run a real `wrangler deploy`; CI deploys from `main`.

- [ ] **Step 8: Commit**

```bash
git add apps/worker data/VERIFY.md
git commit -m "feat(worker): schedule the alerts cron, export scheduled(), document ops

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — Settings → Alerts section

**Files:**
- Create: `apps/web/src/components/AlertsSection.tsx`, `apps/web/src/components/AlertsSection.test.tsx`
- Modify: `apps/web/src/api/client.ts` (+ `client.test.ts`), `apps/web/src/screens/SettingsScreen.tsx`

**Interfaces:**
- Consumes: Task 5's HTTP contract; core `AlertsStateResponse`, `AlertTestResponse`, `AlertRules`, `ALERT_TYPES`, `ALERT_BOUNDS`, `alertParam`; `useSyncSnapshot().code`.
- Produces: `AlertsSection({ client?: AlertsApi })`; client methods:

```ts
getAlerts(code: string): Promise<AlertsStateResponse>;
putWebhook(code: string, url: string): Promise<AlertsStateResponse>;
deleteWebhook(code: string): Promise<void>;
testWebhook(code: string): Promise<AlertTestResponse>;
putRules(code: string, rules: Record<string, Record<string, unknown>>): Promise<AlertsStateResponse>;
export type AlertsApi = Pick<ReturnType<typeof createApiClient>, "getAlerts" | "putWebhook" | "deleteWebhook" | "testWebhook" | "putRules">;
```

- [ ] **Step 1: Client tests** — add to `apps/web/src/api/client.test.ts` (mirror the existing sync-method tests there for how the fake `fetch` is built):

```ts
describe("alerts client", () => {
  it("sends the sync code as a bearer token and the right verbs", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ hasWebhook: false, webhookLast4: null, webhookOk: null, rules: null }), { status: 200 });
    }) as typeof fetch;
    const c = createApiClient(fetchFn, "https://api.test");

    await c.getAlerts("CODE");
    await c.putWebhook("CODE", "https://discord.com/api/webhooks/1/a");
    await c.testWebhook("CODE");
    await c.putRules("CODE", { contest_soon: { enabled: false } });

    expect(calls.map((x) => [x.init?.method, x.url])).toEqual([
      ["GET", "https://api.test/api/alerts"],
      ["PUT", "https://api.test/api/alerts/webhook"],
      ["POST", "https://api.test/api/alerts/test"],
      ["PUT", "https://api.test/api/alerts/rules"],
    ]);
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe("Bearer CODE");
    }
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ url: "https://discord.com/api/webhooks/1/a" });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({ rules: { contest_soon: { enabled: false } } });
  });
  it("deleteWebhook accepts a 204", async () => {
    const c = createApiClient((async () => new Response(null, { status: 204 })) as typeof fetch, "https://api.test");
    await expect(c.deleteWebhook("CODE")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement the client methods** — in `apps/web/src/api/client.ts`: add `AlertsStateResponse` and `AlertTestResponse` to the `@garden-hq/core` type import, then inside the returned object (after `deleteAccount`):

```ts
    getAlerts: (code: string) =>
      request<AlertsStateResponse>("GET", "/api/alerts", { headers: bearer(code) }),
    putWebhook: (code: string, url: string) =>
      request<AlertsStateResponse>("PUT", "/api/alerts/webhook", {
        headers: bearer(code),
        body: { url },
      }),
    deleteWebhook: async (code: string): Promise<void> => {
      const res = await send("DELETE", "/api/alerts/webhook", { headers: bearer(code) });
      if (!res.ok) throw await toApiError(res);
    },
    testWebhook: (code: string) =>
      request<AlertTestResponse>("POST", "/api/alerts/test", { headers: bearer(code) }),
    putRules: (code: string, rules: Record<string, Record<string, unknown>>) =>
      request<AlertsStateResponse>("PUT", "/api/alerts/rules", {
        headers: bearer(code),
        body: { rules },
      }),
```

and after `SyncApi` add:

```ts
export type AlertsApi = Pick<
  ReturnType<typeof createApiClient>,
  "getAlerts" | "putWebhook" | "deleteWebhook" | "testWebhook" | "putRules"
>;
```

- [ ] **Step 3: Component tests** — `apps/web/src/components/AlertsSection.test.tsx`. Open `SyncSection.test.tsx` and copy its `fakeEngine`/`renderWithProviders` setup (the engine snapshot's `code` is what the section reads). Then:

```tsx
import { defaultAlertRules, type AlertsStateResponse } from "@garden-hq/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type AlertsApi } from "../api/client";
import { AlertsSection } from "./AlertsSection";
// + fakeEngine / renderWithProviders imports exactly as SyncSection.test.tsx has them

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const EMPTY: AlertsStateResponse = { hasWebhook: false, webhookLast4: null, webhookOk: null, rules: null };
const UNTESTED: AlertsStateResponse = { ...EMPTY, hasWebhook: true, webhookLast4: "-123" };
const VERIFIED: AlertsStateResponse = { ...UNTESTED, webhookOk: true, rules: defaultAlertRules(true) };

function client(over: Partial<Record<keyof AlertsApi, unknown>> = {}) {
  return {
    getAlerts: vi.fn(() => Promise.resolve(EMPTY)),
    putWebhook: vi.fn(() => Promise.resolve(UNTESTED)),
    deleteWebhook: vi.fn(() => Promise.resolve()),
    testWebhook: vi.fn(() => Promise.resolve({ ...VERIFIED, test: "sent" as const })),
    putRules: vi.fn(() => Promise.resolve(VERIFIED)),
    ...over,
  } as unknown as AlertsApi & { [K in keyof AlertsApi]: ReturnType<typeof vi.fn> };
}

// renderAlerts(c, { code }) renders <AlertsSection client={c} /> with a fake sync engine whose snapshot has the given code.

describe("AlertsSection", () => {
  it("asks the player to turn on Cloud save when signed out, and calls nothing", () => {
    const c = client();
    renderAlerts(c, { code: null });
    expect(screen.getByText(/turn on cloud save/i)).toBeInTheDocument();
    expect(c.getAlerts).not.toHaveBeenCalled();
  });

  it("shows the webhook form, saves it, and never shows the URL back", async () => {
    const c = client();
    renderAlerts(c, { code: CODE });
    await userEvent.type(await screen.findByLabelText(/discord webhook url/i), "https://discord.com/api/webhooks/1/abc");
    await userEvent.click(screen.getByRole("button", { name: /save webhook/i }));
    expect(c.putWebhook).toHaveBeenCalledWith(CODE, "https://discord.com/api/webhooks/1/abc");
    expect(await screen.findByText(/ending in -123/i)).toBeInTheDocument();
    expect(screen.queryByText(/discord\.com\/api\/webhooks/)).not.toBeInTheDocument();
  });

  it("explains that an untested webhook sends nothing, and the test unlocks the rules", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(UNTESTED)) });
    renderAlerts(c, { code: CODE });
    expect(await screen.findByText(/send a test message to turn alerts on/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /send test message/i }));
    expect(c.testWebhook).toHaveBeenCalledWith(CODE);
    expect(await screen.findAllByRole("checkbox")).toHaveLength(5);
  });

  it("reports a dead webhook and a failed test distinctly", async () => {
    const dead = client({ getAlerts: vi.fn(() => Promise.resolve(UNTESTED)), testWebhook: vi.fn(() => Promise.resolve({ ...UNTESTED, webhookOk: false, test: "dead" as const })) });
    renderAlerts(dead, { code: CODE });
    await userEvent.click(await screen.findByRole("button", { name: /send test message/i }));
    expect(await screen.findByText(/discord says this webhook no longer exists/i)).toBeInTheDocument();

    const failed = client({ getAlerts: vi.fn(() => Promise.resolve(UNTESTED)), testWebhook: vi.fn(() => Promise.resolve({ ...UNTESTED, test: "failed" as const })) });
    renderAlerts(failed, { code: CODE });
    await userEvent.click(await screen.findByRole("button", { name: /send test message/i }));
    expect(await screen.findByText(/couldn't reach discord/i)).toBeInTheDocument();
  });

  it("toggling a rule sends only that rule", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    await userEvent.click(await screen.findByRole("checkbox", { name: /jacob's contest/i }));
    expect(c.putRules).toHaveBeenCalledWith(CODE, { contest_soon: { enabled: false } });
  });

  it("commits a threshold on blur, within bounds", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    const lead = await screen.findByLabelText(/contest.*minutes before it starts/i);
    await userEvent.clear(lead);
    await userEvent.type(lead, "10");
    await userEvent.tab();
    expect(c.putRules).toHaveBeenCalledWith(CODE, { contest_soon: { leadMinutes: 10 } });
  });

  it("does not send an out-of-range threshold", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    const lead = await screen.findByLabelText(/contest.*minutes before it starts/i);
    await userEvent.clear(lead);
    await userEvent.type(lead, "0");
    await userEvent.tab();
    expect(c.putRules).not.toHaveBeenCalled();
    expect(await screen.findByText(/enter a whole number from 1 to 120/i)).toBeInTheDocument();
  });

  it("removing the webhook asks for confirmation first", async () => {
    const c = client({ getAlerts: vi.fn(() => Promise.resolve(VERIFIED)) });
    renderAlerts(c, { code: CODE });
    await userEvent.click(await screen.findByRole("button", { name: /remove webhook/i }));
    expect(c.deleteWebhook).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /yes, remove/i }));
    await waitFor(() => expect(c.deleteWebhook).toHaveBeenCalledWith(CODE));
  });

  it("shows a friendly message when the server is full or unreachable", async () => {
    const full = client({ putWebhook: vi.fn(() => Promise.reject(new ApiError("rate_limited", 429, "Alerts are full right now — the free server only handles a few players.", 3600))) });
    renderAlerts(full, { code: CODE });
    await userEvent.type(await screen.findByLabelText(/discord webhook url/i), "https://discord.com/api/webhooks/1/abc");
    await userEvent.click(screen.getByRole("button", { name: /save webhook/i }));
    expect(await screen.findByText(/alerts are full right now/i)).toBeInTheDocument();

    const offline = client({ getAlerts: vi.fn(() => Promise.reject(new ApiError("network", 0, "Network request failed"))) });
    renderAlerts(offline, { code: CODE });
    expect(await screen.findByText(/can't reach the server/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `pnpm --filter @garden-hq/web test -- AlertsSection.test.tsx client.test.ts`
Expected: FAIL (no `AlertsSection`, no client methods until Step 2 is done; run Step 3's file first to see the component failure).

- [ ] **Step 5: Implement the component** — `apps/web/src/components/AlertsSection.tsx`

```tsx
import {
  ALERT_BOUNDS,
  ALERT_TYPES,
  alertParam,
  type AlertRules,
  type AlertsStateResponse,
  type AlertType,
} from "@garden-hq/core";
import { useEffect, useState } from "react";
import { api, ApiError, type AlertsApi } from "../api/client";
import { useSyncSnapshot } from "../state/SyncProvider";

const LABELS: Record<AlertType, { label: string; unit?: string; hint?: string }> = {
  contest_soon: { label: "Jacob's Contest with one of my crops", unit: "minutes before it starts" },
  composter_fuel_out: { label: "Composter ran out of fuel" },
  composter_fuel_low: { label: "Composter fuel running low (early warning)", unit: "minutes before it runs out" },
  visitors_waiting: { label: "Visitor queue is full", unit: "visitors in the queue" },
  greenhouse_water: {
    label: "Greenhouse needs water",
    hint: "Set a watering interval on the Greenhouse screen first.",
  },
};

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "network") return "Can't reach the server. Try again when you're online.";
    if (e.code === "rate_limited" && e.message !== "") return e.message;
    if (e.code === "bad_request" && e.message !== "") return e.message;
  }
  return "Something went wrong. Try again.";
}

function RuleRow({
  type,
  rules,
  busy,
  onChange,
}: {
  type: AlertType;
  rules: AlertRules;
  busy: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const rule = rules[type];
  const { label, unit, hint } = LABELS[type];
  const param = alertParam(type);
  const stored = param === null ? undefined : rule[param];
  const [draft, setDraft] = useState(String(stored ?? ""));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(String(stored ?? "")), [stored]);

  function commit() {
    if (param === null) return;
    const { min, max } = ALERT_BOUNDS[param];
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
      setError(`Enter a whole number from ${min} to ${max}.`);
      return;
    }
    setError(null);
    if (n !== stored) onChange({ [param]: n });
  }

  return (
    <div className="alert-rule">
      <label>
        <input
          type="checkbox"
          checked={rule.enabled}
          disabled={busy}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />{" "}
        {label}
      </label>
      {param !== null && unit !== undefined ? (
        <label className="muted">
          <span className="visually-hidden">{`${label}: ${unit}`}</span>
          <input
            type="number"
            inputMode="numeric"
            aria-label={`${label}: ${unit}`}
            value={draft}
            min={ALERT_BOUNDS[param].min}
            max={ALERT_BOUNDS[param].max}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />{" "}
          {unit}
        </label>
      ) : null}
      {hint !== undefined ? <p className="muted">{hint}</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function AlertsSection({ client = api }: { client?: AlertsApi }) {
  const { code } = useSyncSnapshot();
  if (code === null) {
    return (
      <section>
        <h2>Discord alerts</h2>
        <p className="muted">Turn on Cloud save to get Discord alerts: the server needs your data to watch your Garden.</p>
      </section>
    );
  }
  return <AlertsBody key={code} code={code} client={client} />;
}

function AlertsBody({ code, client }: { code: string; client: AlertsApi }) {
  const [state, setState] = useState<AlertsStateResponse | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .getAlerts(code)
      .then((s) => live && setState(s))
      .catch((e: unknown) => live && setMessage(describeError(e)));
    return () => {
      live = false;
    };
  }, [client, code]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const saveWebhook = () =>
    run(async () => {
      setState(await client.putWebhook(code, url.trim()));
      setUrl("");
    });

  const sendTest = () =>
    run(async () => {
      const { test, ...next } = await client.testWebhook(code);
      setState(next);
      setMessage(
        test === "sent"
          ? "Test message sent. Check your Discord channel."
          : test === "dead"
            ? "Discord says this webhook no longer exists. Add a new one."
            : "Couldn't reach Discord. Try again in a minute.",
      );
    });

  const changeRule = (type: AlertType, patch: Record<string, unknown>) =>
    run(async () => setState(await client.putRules(code, { [type]: patch })));

  const remove = () =>
    run(async () => {
      await client.deleteWebhook(code);
      setState({ hasWebhook: false, webhookLast4: null, webhookOk: null, rules: null });
      setConfirming(false);
    });

  return (
    <section>
      <h2>Discord alerts</h2>
      {state === null && message === null ? <p className="muted">Loading…</p> : null}

      {state !== null && !state.hasWebhook ? (
        <>
          <label>
            Discord webhook URL
            <input
              type="url"
              value={url}
              placeholder="https://discord.com/api/webhooks/…"
              autoComplete="off"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <button type="button" disabled={busy || url.trim() === ""} onClick={() => void saveWebhook()}>
            Save webhook
          </button>
          <p className="muted">
            Server settings → Integrations → Webhooks in Discord. The URL is kept on our server and never shown again.
          </p>
        </>
      ) : null}

      {state?.hasWebhook ? (
        <>
          <p>Webhook ending in {state.webhookLast4}</p>
          {state.webhookOk === null ? (
            <p className="muted">Send a test message to turn alerts on.</p>
          ) : null}
          {state.webhookOk === false ? (
            <p role="alert">Discord says this webhook no longer exists. Remove it and add a new one.</p>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void sendTest()}>
            Send test message
          </button>
          {state.webhookOk === true && state.rules !== null
            ? ALERT_TYPES.map((type) => (
                <RuleRow
                  key={type}
                  type={type}
                  rules={state.rules as AlertRules}
                  busy={busy}
                  onChange={(patch) => void changeRule(type, patch)}
                />
              ))
            : null}
          {confirming ? (
            <>
              <p>Remove the webhook and stop all Discord alerts?</p>
              <button type="button" disabled={busy} onClick={() => void remove()}>
                Yes, remove
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
              Remove webhook
            </button>
          )}
        </>
      ) : null}

      {message !== null ? <p role="status">{message}</p> : null}
    </section>
  );
}
```

Notes: the two visible/accessible name for the number input is the `aria-label`; delete the duplicated `visually-hidden` span if the CSS class does not exist (check `apps/web/src/index.css`/existing classes; reuse existing form styles rather than adding new ones). The dead-webhook message appears twice (state banner and test result); that is fine, but keep the test's `findByText` unambiguous by letting the banner say "…no longer exists. Remove it and add a new one." and the test message say "…no longer exists. Add a new one." — they differ, so `getByText(/discord says this webhook no longer exists/i)` will find two. Change the test to `findAllByText(...)` with `length >= 1`, or drop the banner when a test message is showing. Pick one and keep the test consistent.

- [ ] **Step 6: Wire it into Settings** — `apps/web/src/screens/SettingsScreen.tsx`:

```tsx
import { AlertsSection } from "../components/AlertsSection";
```
```tsx
      <SyncSection />
      <AlertsSection />
```

Run the existing `SettingsScreen` test(s) (if any) to confirm a signed-out engine renders the "Turn on Cloud save" line without calling the API.

- [ ] **Step 7: Verify at 380 px**

Run: `pnpm --filter @garden-hq/web test`, `pnpm --filter @garden-hq/web typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`.
Then `pnpm --filter @garden-hq/web dev`, open `/settings` at 380 px width (devtools device mode): the webhook input and rule rows must not overflow horizontally, controls reachable with a thumb. (A real end-to-end check needs a deployed Worker and a real Discord webhook; see the owner checklist below.)

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): Settings → Discord alerts (webhook, test message, editable thresholds)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Owner actions after merge

1. CI applies migration `0003_alerts.sql` and deploys the Worker (which registers the Cron Trigger) and the web app; the Cloudflare token already has D1 Edit. Nothing new to configure.
2. Run the "First cron deploy checklist" in `apps/worker/README.md` (CPU under 10 ms is the one to watch).
3. Your Hypixel key must be valid; a development key expires. Rotation steps are in the README. Apply for a production key before anyone but you uses alerts.
4. Privacy page (Phase 5) must now list the Discord webhook URL among stored data and how to delete it (Settings → Remove webhook, or Delete cloud data).

## Self-review against the spec (section C and linked sections)

| Spec requirement | Where |
|---|---|
| `crons = ["*/5 * * * *"]`, `[[d1_databases]]`; `scheduled()` thin wrapper over `runSync(env, now)` in `cron.ts` | Task 8 (`wrangler.toml`, `index.ts`), Task 7 |
| Per run: due accounts with working webhook + enabled rule, ordered, `LIMIT BATCH` 10; fresh (<5 min) snapshot reused | Task 3 `loadDueAccounts`, Task 7 `processAccount` |
| Caps: ≤ 8 Hypixel calls, subrequest budget 40 counted in code, stop cleanly, remaining accounts go first next run | Task 6 `Budget`, Task 7 (affordability checks; untouched accounts keep `next_sync_at`) |
| Hypixel `RateLimit-*` handling; stop on low quota | Existing client; Task 7 maps `rate_limited` to `StopRun("hypixel_rate")` |
| Contests via existing KV `cached()` (15 min) | Task 6 `getCachedContests`, Task 7 `loadContests` |
| Fetch garden, `normalizeGarden`, upsert `garden_snapshot`, `deriveAlerts` | Task 7, Task 2 |
| Claim first with `INSERT OR IGNORE`; send only if a row changed; 5xx/429 delete claim, honour `retry_after`; 404/401 → `webhook_ok = 0` | Task 3 `claimStmt`, Task 7 `deliver`, Task 4 results |
| `next_sync_at` 15 min / 5 min when an event is within 20 min, never earlier than `fetched_at` + 5 min | Task 2 `nextSyncAt` (floor is implied; see note), Task 7 |
| Prune `alert_log` > 7 days once a day | Task 7 (stateless, decision 11) |
| One bad account must not stop the batch; logs without PII | Task 7 per-account `try/catch`, name-only logging |
| Alert types, fire conditions and dedupe keys (table) | Task 2 `deriveAlerts` (contest key per decision 5) |
| Embed, `allowed_mentions: { parse: [] }`, webhook regex before store/call | Task 4, Task 5 |
| Settings → Alerts: webhook, test, per-rule toggle, every threshold editable, nothing on until a test message verifies | Task 5, Task 9, decision 4 |
| Tests: sends once across two runs, re-arms after refill, retries after 5xx, disables on 404, one failing account, batch limit, disabled rules, webhook never in logs | Task 7 tests |
| Free-plan hardening: no KV writes from cron/routes except shared contests; CPU unmeasured → measure on first deploy | Task 6/7, Task 8 README + VERIFY |
| Capacity: `MAX_CRON_ACCOUNTS` cap on alerting accounts; 60-day inactivity | Task 3 limits + due query, Task 5 cap, decisions 9 and 12 |
| Hypixel key: distinct `hypixel_key_rejected` event + stop; README rotation; production key needed | Task 7, Task 8 |
| CORS adds `PUT` + `Authorization` | Task 5 (`Authorization` was added in 3B) |
| Account deletion wipes alert data | Task 3 `deleteAccount` |
| Shared detection between UI and cron | Task 1 |

Placeholder scan: no TBD/TODO steps; the only `TODO` string is the pre-existing `TODO(visitors.json)` comment moved with the visitor code. Type consistency: `AlertRules`, `AlertCandidate`, `AlertInput`, `DueAccount`, `StoredPlayerData`, `SendResult`, `RunSummary` are defined once (Tasks 2-4, 7) and used with the same names and shapes in later tasks; `nextSyncAt(input, fetchedAt)` has the same two-argument signature in Tasks 2 and 7 (the note in Task 2 says what to change in both places if the unused parameter is dropped).
