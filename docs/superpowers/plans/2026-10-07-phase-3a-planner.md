# Phase 3A — Planner and KV fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop writing per-player data to KV, then add a ranked "Do next" list on the Home screen computed by a pure function in `packages/core`.

**Architecture:** Task 1 swaps the per-player 60 s KV cache in `/api/garden` and `/api/link` for a bounded in-isolate memory cache. Tasks 2-3 add `packages/core/src/planner.ts` (`planActions`) driven by `data/planner.json`. Task 4 adds the one new piece of player input the planner needs (a per-Greenhouse watering interval). Task 5 renders the list. No backend schema, no D1, no cron (those are milestones B and C).

**Tech Stack:** TypeScript strict, Hono on Cloudflare Workers, React + Vite, vitest (+ Testing Library in `apps/web`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-07-phase-3-planner-sync-alerts-design.md` (section "A. Planner" and "Free-plan budget"). Read it first.

## Global Constraints

- TypeScript strict everywhere; **no `any` in `packages/core`**.
- Game numbers and thresholds come from `/data/*.json`, never magic numbers in code (CLAUDE.md §9).
- Every `core` function gets a vitest test; tests use fixtures/fakes, never live API calls.
- The Worker must make **no per-player KV writes**: KV free plan is 1,000 writes/day (spec, "Free-plan budget"). Shared data (election, contests, Mojang names) may keep using KV.
- Planner is pure: no fetch, no DOM, no clock reads (`now` is an input).
- Visitor copper / Garden XP value is **out** of the planner for now (owner decision). Leave a `// TODO(visitors.json)` at the visitors row.
- Mobile-first UI; must work at 380 px width. Follow existing component and CSS conventions.
- When a mechanic is uncertain add a `// VERIFY:` comment and an entry in `data/VERIFY.md`.
- Commits end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push; the owner pushes.
- Run commands from the repo root `C:\Users\azzaw\garden-hq` (Git Bash). Per-package test: `pnpm --filter <pkg> test -- <file>`; packages are `@garden-hq/core`, and the worker/web package names are in their `package.json`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/worker/src/memcache.ts` (new) | Bounded in-isolate TTL cache with the same `{ value, fetchedAt }` result as `cached()` |
| `apps/worker/src/memcache.test.ts` (new) | Unit tests for it |
| `apps/worker/src/app.ts`, `routes/garden.ts`, `routes/link.ts` | Create one `MemoryCache` per app instance, use it instead of KV for per-player data |
| `data/planner.json` (new) | Planner thresholds |
| `packages/core/src/planner.ts` (new) | `planActions` and its types |
| `packages/core/src/planner.test.ts` (new) | Planner tests |
| `packages/core/src/index.ts` | Export the planner |
| `apps/web/src/state/storage.ts` | `GreenhouseSave.wateringIntervalHours` + `setWateringInterval` |
| `apps/web/src/greenhouse/GreenhousePanel.tsx` | Interval input |
| `apps/web/src/components/DoNextCard.tsx` (new) + test | The list |
| `apps/web/src/screens/HomeScreen.tsx`, `index.css` | Mount the card, style |
| `data/VERIFY.md` | Record the new uncertainties |

---

### Task 1: Move per-player caching out of KV

**Files:**
- Create: `apps/worker/src/memcache.ts`, `apps/worker/src/memcache.test.ts`
- Modify: `apps/worker/src/app.ts:65-66`, `apps/worker/src/routes/garden.ts`, `apps/worker/src/routes/link.ts`, `apps/worker/src/routes/garden.test.ts`

**Interfaces:**
- Produces: `createMemoryCache(maxEntries?: number): MemoryCache`; `cachedInMemory<T>(cache: MemoryCache, key: string, ttlSeconds: number, now: () => number, produce: () => Promise<T>): Promise<{ value: T; fetchedAt: number }>`. `gardenRoute(deps, clientFor, playerCache)` and `linkRoute(deps, clientFor, playerCache)` take the cache as a third argument.

- [ ] **Step 1: Write the failing memory-cache tests**

Create `apps/worker/src/memcache.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeClock } from "../test/helpers";
import { cachedInMemory, createMemoryCache } from "./memcache";

describe("cachedInMemory", () => {
  it("produces on a miss and returns fetchedAt", async () => {
    const clock = makeClock(1_000_000);
    const produce = vi.fn(async () => ({ n: 1 }));

    const result = await cachedInMemory(
      createMemoryCache(),
      "k",
      60,
      clock.now,
      produce,
    );

    expect(result).toEqual({ value: { n: 1 }, fetchedAt: 1_000_000 });
    expect(produce).toHaveBeenCalledOnce();
  });

  it("serves a fresh entry without producing, keeping the original fetchedAt", async () => {
    const cache = createMemoryCache();
    const clock = makeClock(1_000_000);
    const produce = vi.fn(async () => "v");

    await cachedInMemory(cache, "k", 60, clock.now, produce);
    clock.advance(59_000);
    const second = await cachedInMemory(cache, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledOnce();
    expect(second.fetchedAt).toBe(1_000_000);
  });

  it("re-produces once the entry is as old as the TTL", async () => {
    const cache = createMemoryCache();
    const clock = makeClock(1_000_000);
    const produce = vi.fn(async () => "v");

    await cachedInMemory(cache, "k", 60, clock.now, produce);
    clock.advance(60_000);
    const second = await cachedInMemory(cache, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(second.fetchedAt).toBe(1_060_000);
  });

  it("never caches a failure", async () => {
    const cache = createMemoryCache();
    const clock = makeClock();

    await expect(
      cachedInMemory(cache, "k", 60, clock.now, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(cache.entries.size).toBe(0);
  });

  it("evicts the oldest entry beyond maxEntries", async () => {
    const cache = createMemoryCache(2);
    const clock = makeClock();

    for (const key of ["a", "b", "c"]) {
      await cachedInMemory(cache, key, 60, clock.now, async () => key);
    }

    expect([...cache.entries.keys()]).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- src/memcache.test.ts` (use the package's real name from `apps/worker/package.json`)
Expected: FAIL, cannot resolve `./memcache`.

- [ ] **Step 3: Implement**

Create `apps/worker/src/memcache.ts`:

```ts
interface Entry {
  fetchedAt: number;
  value: unknown;
}

export interface MemoryCache {
  readonly entries: Map<string, Entry>;
  readonly maxEntries: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createMemoryCache(
  maxEntries = DEFAULT_MAX_ENTRIES,
): MemoryCache {
  return { entries: new Map(), maxEntries };
}

/**
 * Per-isolate TTL cache for per-player data. Unlike `cached()` it never touches
 * KV (free plan: 1,000 writes/day). Best effort: another isolate or a restart
 * starts empty, which only costs one more upstream call. Failures are not cached.
 */
export async function cachedInMemory<T>(
  cache: MemoryCache,
  key: string,
  ttlSeconds: number,
  now: () => number,
  produce: () => Promise<T>,
): Promise<{ value: T; fetchedAt: number }> {
  const hit = cache.entries.get(key);
  if (hit !== undefined && now() - hit.fetchedAt < ttlSeconds * 1000) {
    return { value: hit.value as T, fetchedAt: hit.fetchedAt };
  }

  const value = await produce();
  const fetchedAt = now();

  // Re-insert so the Map's insertion order is also age order.
  cache.entries.delete(key);
  cache.entries.set(key, { fetchedAt, value });
  while (cache.entries.size > cache.maxEntries) {
    const oldest = cache.entries.keys().next();
    if (oldest.done === true) break;
    cache.entries.delete(oldest.value);
  }

  return { value, fetchedAt };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @garden-hq/worker test -- src/memcache.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing route test**

In `apps/worker/src/routes/garden.test.ts` add `FakeKV` to the existing import from `"../../test/helpers"`, then add inside `describe("GET /api/garden", ...)`:

```ts
  it("keeps per-player data out of KV", async () => {
    const { get, env } = harness();

    await get(`/api/garden?profile=${PROFILE}`);
    await get("/api/link?name=TestFarmer");

    const kv = env.CACHE as unknown as FakeKV;
    const playerKeys = [...kv.store.keys()].filter(
      (key) => key.startsWith("garden:") || key.startsWith("link:"),
    );
    expect(playerKeys).toEqual([]);
  });
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @garden-hq/worker test -- src/routes/garden.test.ts`
Expected: FAIL, `playerKeys` contains `garden:...` and `link:...`.

- [ ] **Step 7: Wire the routes**

`apps/worker/src/app.ts`: add `import { createMemoryCache } from "./memcache";`, and next to `const hypixelState = createRateLimitState();` add:

```ts
  // Per-player responses are cached in memory, never in KV (free-plan write limit).
  const playerCache = createMemoryCache();
```

Change lines 65-66 to:

```ts
  app.route("/api", linkRoute(deps, clientFor, playerCache));
  app.route("/api", gardenRoute(deps, clientFor, playerCache));
```

`apps/worker/src/routes/garden.ts`: replace `import { cached } from "../cache";` with `import { cachedInMemory, type MemoryCache } from "../memcache";`, change the signature to
`gardenRoute(deps: AppDeps, clientFor: ClientFactory, playerCache: MemoryCache)`, and replace the call head

```ts
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `garden:${profileId}`,
```
with
```ts
    const { value, fetchedAt } = await cachedInMemory(
      playerCache,
      `garden:${profileId}`,
```

`apps/worker/src/routes/link.ts`: same import swap, signature `linkRoute(deps, clientFor, playerCache)`, and

```ts
    const { value, fetchedAt } = await cachedInMemory(
      playerCache,
      `link:${name.toLowerCase()}`,
```
Leave `lookupUuid(deps.fetch, name, { kv: c.env.CACHE, ... })` unchanged (Mojang name cache stays in KV: it only writes for new names).

- [ ] **Step 8: Run the whole worker suite and typecheck**

Run: `pnpm --filter @garden-hq/worker test && pnpm --filter @garden-hq/worker typecheck`
Expected: all pass, including the existing "caches 60 s per profile" and "serves repeats within 60 s" tests (same TTL semantics).

- [ ] **Step 9: Commit**

```bash
git add apps/worker/src
git commit -m "fix(worker): cache per-player garden and link responses in memory, not KV" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Planner data, types, contest and composter rows

**Files:**
- Create: `data/planner.json`, `packages/core/src/planner.ts`, `packages/core/src/planner.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (used by Tasks 3-5):

```ts
export type ActionKind =
  | "contest_soon" | "composter_no_fuel" | "composter_fuel_low"
  | "visitors_waiting" | "greenhouse_water" | "plot_unlock" | "garden_level";
export interface PlannedAction {
  kind: ActionKind; id: string; title: string; detail: string;
  dueAt: number | null; rank: number;
}
export interface GreenhousePlan {
  lastWateredAt: number | null; wateringIntervalHours: number | null;
}
export interface PlannerInput {
  now: number; garden: GardenState; contests: Contest[];
  assignments: Record<string, string>;
  greenhouses: Record<string, GreenhousePlan>;
}
export const MAX_SHOWN_ACTIONS: number;
export function planActions(input: PlannerInput): PlannedAction[];
```

- [ ] **Step 1: Create the data file**

`data/planner.json`:

```json
{
  "version": 1,
  "thresholds": {
    "contestWindowMinutes": 60,
    "fuelEarlyWarningMinutes": 30,
    "greenhouseLeadMinutes": 30,
    "visitorQueueMax": 5
  },
  "maxActionsShown": 5
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/src/planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fuelPerHour } from "./composter";
import { planActions, type PlannerInput } from "./planner";
import type { GardenState } from "./types";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const UPGRADES = {
  speed: 0,
  multiDrop: 0,
  fuelCap: 0,
  organicMatterCap: 0,
  costReduction: 0,
};

function garden(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 1_000_000,
      fuel: 1_000_000,
      compostUnits: 3,
      lastSave: NOW,
      upgrades: UPGRADES,
    },
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

function input(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    now: NOW,
    garden: garden(),
    contests: [],
    assignments: {},
    greenhouses: {},
    ...over,
  };
}

function kinds(i: PlannerInput): string[] {
  return planActions(i).map((a) => a.kind);
}

describe("contest_soon", () => {
  const crops = ["wheat", "carrot", "potato"];

  it("fires for a contest within the window that includes an assigned crop", () => {
    const actions = planActions(
      input({
        assignments: { beginner_1: "wheat" },
        contests: [{ startsAt: NOW + 12 * MIN, crops }],
      }),
    );
    const action = actions.find((a) => a.kind === "contest_soon");
    expect(action?.title).toBe("Wheat contest in 12 min");
    expect(action?.id).toBe(`contest_soon:${NOW + 12 * MIN}`);
    expect(action?.dueAt).toBe(NOW + 12 * MIN);
  });

  it("ignores contests outside the window, already started, or for other crops", () => {
    const base = { assignments: { beginner_1: "wheat" } };
    expect(
      kinds(input({ ...base, contests: [{ startsAt: NOW + 61 * MIN, crops }] })),
    ).not.toContain("contest_soon");
    expect(
      kinds(input({ ...base, contests: [{ startsAt: NOW - MIN, crops }] })),
    ).not.toContain("contest_soon");
    expect(
      kinds(
        input({
          ...base,
          contests: [{ startsAt: NOW + 5 * MIN, crops: ["cactus"] }],
        }),
      ),
    ).not.toContain("contest_soon");
  });

  it("ignores assignments on plots the player has not unlocked", () => {
    expect(
      kinds(
        input({
          assignments: { advanced_5: "wheat" },
          contests: [{ startsAt: NOW + 5 * MIN, crops }],
        }),
      ),
    ).not.toContain("contest_soon");
  });
});

describe("composter", () => {
  function withComposter(fields: Partial<GardenState["composter"]>) {
    const base = garden();
    return input({
      garden: garden({ composter: { ...base.composter, ...fields } }),
    });
  }

  it("flags a composter that is out of fuel", () => {
    const action = planActions(withComposter({ fuel: 0 })).find(
      (a) => a.kind === "composter_no_fuel",
    );
    expect(action?.title).toBe("Composter is out of fuel");
    expect(action?.dueAt).toBeNull();
  });

  it("warns when fuel runs out inside the early-warning window", () => {
    const fuel = fuelPerHour(UPGRADES) * 0.25; // 15 minutes of fuel
    const action = planActions(withComposter({ fuel })).find(
      (a) => a.kind === "composter_fuel_low",
    );
    expect(action?.title).toBe("Composter fuel runs out in 15 min");
    expect(action?.dueAt).toBe(NOW + 15 * MIN);
  });

  it("stays quiet when fuel lasts beyond the window", () => {
    const fuel = fuelPerHour(UPGRADES) * 1; // 60 minutes
    const result = kinds(withComposter({ fuel }));
    expect(result).not.toContain("composter_fuel_low");
    expect(result).not.toContain("composter_no_fuel");
  });

  it("treats a missing last save as just saved", () => {
    expect(kinds(withComposter({ lastSave: 0 }))).not.toContain(
      "composter_no_fuel",
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @garden-hq/core test -- src/planner.test.ts`
Expected: FAIL, cannot resolve `./planner`.

- [ ] **Step 4: Implement**

`packages/core/src/planner.ts`:

```ts
import plannerData from "../../../data/planner.json";
import { forecastComposter } from "./composter";
import { getCrop } from "./crops";
import type { Contest, GardenState } from "./types";

interface PlannerData {
  thresholds: {
    contestWindowMinutes: number;
    fuelEarlyWarningMinutes: number;
    greenhouseLeadMinutes: number;
    visitorQueueMax: number;
  };
  maxActionsShown: number;
}

const DATA = plannerData as PlannerData;
const T = DATA.thresholds;

export const MAX_SHOWN_ACTIONS: number = DATA.maxActionsShown;

export type ActionKind =
  | "contest_soon"
  | "composter_no_fuel"
  | "composter_fuel_low"
  | "visitors_waiting"
  | "greenhouse_water"
  | "plot_unlock"
  | "garden_level";

export interface PlannedAction {
  kind: ActionKind;
  /** Stable across calls with the same input; safe as a React key and a dedupe key. */
  id: string;
  title: string;
  detail: string;
  /** When it becomes (or became) urgent; null means "now". */
  dueAt: number | null;
  /** Position in the ranked list, 0 first. */
  rank: number;
}

export interface GreenhousePlan {
  lastWateredAt: number | null;
  wateringIntervalHours: number | null;
}

export interface PlannerInput {
  /** Epoch ms. */
  now: number;
  garden: GardenState;
  contests: Contest[];
  /** plotId -> cropId (user input). */
  assignments: Record<string, string>;
  /** Marked Greenhouse plotId -> watering state (user input). */
  greenhouses: Record<string, GreenhousePlan>;
}

type Draft = Omit<PlannedAction, "rank">;

/** CLAUDE.md §7 order; lower tier is shown first. */
const TIER: Record<ActionKind, number> = {
  contest_soon: 1,
  composter_no_fuel: 2,
  composter_fuel_low: 2,
  visitors_waiting: 3,
  greenhouse_water: 4,
  plot_unlock: 5,
  garden_level: 6,
};

const MINUTE = 60_000;

function minutesUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / MINUTE));
}

function cropName(id: string): string {
  return getCrop(id)?.name ?? id;
}

function contestActions({
  now,
  garden,
  contests,
  assignments,
}: PlannerInput): Draft[] {
  const unlocked = new Set(garden.unlockedPlotIds);
  const mine = new Set(
    Object.entries(assignments)
      .filter(([plotId]) => unlocked.has(plotId))
      .map(([, cropId]) => cropId),
  );

  const drafts: Draft[] = [];
  for (const contest of contests) {
    const until = contest.startsAt - now;
    if (until < 0 || until > T.contestWindowMinutes * MINUTE) continue;
    const matching = contest.crops.filter((id) => mine.has(id));
    if (matching.length === 0) continue;

    drafts.push({
      kind: "contest_soon",
      id: `contest_soon:${contest.startsAt}`,
      title: `${matching.map(cropName).join(", ")} contest in ${minutesUntil(contest.startsAt, now)} min`,
      detail: "A crop you have planted is in the next Jacob's Contest.",
      dueAt: contest.startsAt,
    });
  }
  return drafts;
}

function composterActions({ now, garden }: PlannerInput): Draft[] {
  const { composter } = garden;
  // A missing last_save (0) would otherwise count decades of runtime.
  const safe =
    composter.lastSave > 0 ? composter : { ...composter, lastSave: now };
  const forecast = forecastComposter(safe, now);

  if (forecast.status === "no_fuel") {
    return [
      {
        kind: "composter_no_fuel",
        id: `composter_no_fuel:${composter.lastSave}`,
        title: "Composter is out of fuel",
        detail: "Add fuel so it keeps making Compost.",
        dueAt: null,
      },
    ];
  }

  if (
    forecast.status === "running" &&
    forecast.stopsBecause === "fuel" &&
    forecast.stopsAt !== null &&
    forecast.stopsAt - now <= T.fuelEarlyWarningMinutes * MINUTE
  ) {
    return [
      {
        kind: "composter_fuel_low",
        id: `composter_fuel_low:${composter.lastSave}`,
        title: `Composter fuel runs out in ${minutesUntil(forecast.stopsAt, now)} min`,
        detail: "Top up fuel before it stops.",
        dueAt: forecast.stopsAt,
      },
    ];
  }

  return [];
}

export function planActions(input: PlannerInput): PlannedAction[] {
  const drafts: Draft[] = [
    ...contestActions(input),
    ...composterActions(input),
  ];

  return drafts
    .sort(
      (a, b) =>
        TIER[a.kind] - TIER[b.kind] ||
        (a.dueAt ?? input.now) - (b.dueAt ?? input.now) ||
        a.id.localeCompare(b.id),
    )
    .map((draft, rank) => ({ ...draft, rank }));
}
```

In `packages/core/src/index.ts` add a line: `export * from "./planner";`

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @garden-hq/core test -- src/planner.test.ts && pnpm --filter @garden-hq/core typecheck`
Expected: PASS (7 tests), typecheck clean. If the "15 min" test is off by floating point, the cause is `forecastComposter` arithmetic; adjust the expected `Math.ceil` result, not the production code, and say so in the commit.

- [ ] **Step 6: Commit**

```bash
git add data/planner.json packages/core/src/planner.ts packages/core/src/planner.test.ts packages/core/src/index.ts
git commit -m "feat(core): planner with contest and composter actions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Visitors, Greenhouse, plot unlock, Garden level rows and ordering

**Files:**
- Modify: `packages/core/src/planner.ts`, `packages/core/src/planner.test.ts`

**Interfaces:**
- Consumes: Task 2 exports. Uses `cheapestNextPlot(unlockedIds: string[], gardenLevel: number): PlotOption | undefined` and `getPlot(id)` from `./plots`, `ALL_PLOTS`.
- Produces: `planActions` now returns all seven kinds.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/planner.test.ts` (add `import { ALL_PLOTS } from "./plots";` at the top):

```ts
describe("visitors_waiting", () => {
  it("lists visitor names with the queue size and no copper value", () => {
    const action = planActions(
      input({
        garden: garden({
          visitors: [
            { id: "a", name: "Jacob" },
            { id: "b", name: "Rhys" },
          ],
        }),
      }),
    ).find((a) => a.kind === "visitors_waiting");
    expect(action?.title).toBe("2/5 visitors waiting");
    expect(action?.detail).toBe("Jacob, Rhys");
    expect(action?.id).toBe("visitors_waiting:a,b");
  });

  it("is absent with an empty queue", () => {
    expect(kinds(input())).not.toContain("visitors_waiting");
  });
});

describe("greenhouse_water", () => {
  it("fires once the interval is due or within the lead time", () => {
    const due = planActions(
      input({
        greenhouses: {
          beginner_3: {
            lastWateredAt: NOW - 9 * HOUR,
            wateringIntervalHours: 8,
          },
        },
      }),
    ).find((a) => a.kind === "greenhouse_water");
    expect(due?.detail).toBe("Watering is due now.");
    expect(due?.dueAt).toBe(NOW - HOUR);

    const soon = planActions(
      input({
        greenhouses: {
          beginner_3: {
            lastWateredAt: NOW - 8 * HOUR + 20 * MIN,
            wateringIntervalHours: 8,
          },
        },
      }),
    ).find((a) => a.kind === "greenhouse_water");
    expect(soon?.detail).toBe("Due in 20 min.");
  });

  it("stays quiet without an interval, without a watering time, or when not yet due", () => {
    const quiet = (
      g: { lastWateredAt: number | null; wateringIntervalHours: number | null },
    ) => kinds(input({ greenhouses: { beginner_3: g } }));

    expect(quiet({ lastWateredAt: NOW - HOUR, wateringIntervalHours: null })).not.toContain("greenhouse_water");
    expect(quiet({ lastWateredAt: null, wateringIntervalHours: 8 })).not.toContain("greenhouse_water");
    expect(quiet({ lastWateredAt: NOW, wateringIntervalHours: 8 })).not.toContain("greenhouse_water");
  });
});

describe("plot_unlock and garden_level", () => {
  it("suggests the cheapest plot with its cost and the composter's ready Compost", () => {
    const action = planActions(input()).find((a) => a.kind === "plot_unlock");
    expect(action?.title).toMatch(/^Unlock plot \d+$/);
    expect(action?.detail).toMatch(/^Costs \d+ Compost\. Composter holds 3 ready\.$/);
  });

  it("shows the XP remaining to the next level", () => {
    // level 5 -> 6 needs cumulative 1120 XP; the player has 600.
    const action = planActions(input()).find((a) => a.kind === "garden_level");
    expect(action?.title).toBe("520 Garden XP to level 6");
  });

  it("is absent at max level with every plot owned", () => {
    const result = kinds(
      input({
        garden: garden({
          level: 15,
          experience: 60_120,
          unlockedPlotIds: ALL_PLOTS.map((p) => p.id),
        }),
      }),
    );
    expect(result).not.toContain("plot_unlock");
    expect(result).not.toContain("garden_level");
  });
});

describe("ordering", () => {
  const everything = (): PlannerInput => {
    const base = garden();
    return input({
      assignments: { beginner_1: "wheat" },
      contests: [{ startsAt: NOW + 10 * MIN, crops: ["wheat", "carrot", "potato"] }],
      garden: garden({
        visitors: [{ id: "a", name: "Jacob" }],
        composter: { ...base.composter, fuel: 0 },
      }),
      greenhouses: {
        beginner_3: { lastWateredAt: NOW - 9 * HOUR, wateringIntervalHours: 8 },
      },
    });
  };

  it("follows the CLAUDE.md §7 tier order and numbers the ranks", () => {
    const actions = planActions(everything());
    expect(actions.map((a) => a.kind)).toEqual([
      "contest_soon",
      "composter_no_fuel",
      "visitors_waiting",
      "greenhouse_water",
      "plot_unlock",
      "garden_level",
    ]);
    expect(actions.map((a) => a.rank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("orders inside a tier by dueAt, soonest first", () => {
    const crops = ["wheat", "carrot", "potato"];
    const actions = planActions(
      input({
        assignments: { beginner_1: "wheat" },
        contests: [
          { startsAt: NOW + 40 * MIN, crops },
          { startsAt: NOW + 10 * MIN, crops },
        ],
      }),
    ).filter((a) => a.kind === "contest_soon");
    expect(actions.map((a) => a.dueAt)).toEqual([NOW + 10 * MIN, NOW + 40 * MIN]);
  });

  it("is deterministic for the same input", () => {
    expect(planActions(everything())).toEqual(planActions(everything()));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/core test -- src/planner.test.ts`
Expected: the new tests FAIL (kinds missing); Task 2's tests still pass.

- [ ] **Step 3: Implement**

In `packages/core/src/planner.ts` add imports:

```ts
import gardenLevels from "../../../data/garden-levels.json";
import { cheapestNextPlot, getPlot } from "./plots";
```

Above `planActions` add:

```ts
interface GardenLevelEntry {
  level: number;
  cumulativeXp: number;
}
const LEVELS = gardenLevels as GardenLevelEntry[];

function visitorActions({ garden }: PlannerInput): Draft[] {
  // TODO(visitors.json): show copper and Garden XP value once data/visitors.json exists.
  const { visitors } = garden;
  if (visitors.length === 0) return [];
  return [
    {
      kind: "visitors_waiting",
      id: `visitors_waiting:${visitors
        .map((v) => v.id)
        .sort()
        .join(",")}`,
      title: `${visitors.length}/${T.visitorQueueMax} visitors waiting`,
      detail: visitors.map((v) => v.name).join(", "),
      dueAt: null,
    },
  ];
}

const HOUR_MS = 60 * MINUTE;

function greenhouseActions({ now, greenhouses }: PlannerInput): Draft[] {
  const drafts: Draft[] = [];
  for (const [plotId, plan] of Object.entries(greenhouses)) {
    // Never fires without a player-set interval AND a watering time: there is
    // no verified water duration to fall back on (data/VERIFY.md "Water/decay").
    if (plan.wateringIntervalHours === null || plan.lastWateredAt === null) {
      continue;
    }
    const dueAt = plan.lastWateredAt + plan.wateringIntervalHours * HOUR_MS;
    if (dueAt - now > T.greenhouseLeadMinutes * MINUTE) continue;

    const plotNumber = getPlot(plotId)?.plotNumber;
    drafts.push({
      kind: "greenhouse_water",
      id: `greenhouse_water:${plotId}:${plan.lastWateredAt}`,
      title: `Water the Greenhouse${plotNumber === undefined ? "" : ` (plot ${plotNumber})`}`,
      detail:
        dueAt <= now
          ? "Watering is due now."
          : `Due in ${minutesUntil(dueAt, now)} min.`,
      dueAt,
    });
  }
  return drafts;
}

function plotAction({ garden }: PlannerInput): Draft[] {
  const plot = cheapestNextPlot(garden.unlockedPlotIds, garden.level);
  if (plot === undefined) return [];
  // VERIFY: the API gives Compost in the composter bin only, not the player's
  // inventory, so a real shortfall cannot be computed (data/VERIFY.md).
  return [
    {
      kind: "plot_unlock",
      id: `plot_unlock:${plot.id}`,
      title: `Unlock plot ${plot.plotNumber}`,
      detail: `Costs ${plot.cost} Compost. Composter holds ${garden.composter.compostUnits} ready.`,
      dueAt: null,
    },
  ];
}

function levelAction({ garden }: PlannerInput): Draft[] {
  const next = LEVELS.find((entry) => entry.level === garden.level + 1);
  if (next === undefined) return [];
  const remaining = Math.max(0, next.cumulativeXp - garden.experience);
  return [
    {
      kind: "garden_level",
      id: `garden_level:${next.level}`,
      title: `${remaining} Garden XP to level ${next.level}`,
      detail: "Visitors and crop milestones give Garden XP.",
      dueAt: null,
    },
  ];
}
```

Replace the `drafts` array in `planActions` with:

```ts
  const drafts: Draft[] = [
    ...contestActions(input),
    ...composterActions(input),
    ...visitorActions(input),
    ...greenhouseActions(input),
    ...plotAction(input),
    ...levelAction(input),
  ];
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @garden-hq/core test && pnpm --filter @garden-hq/core typecheck`
Expected: PASS. If `cheapestNextPlot` returns `undefined` for the base fixture (so the plot tests fail), print `cheapestNextPlot(["beginner_1","beginner_2"], 5)` and adjust `unlockedPlotIds` in the test fixture to a set that has a buyable neighbour; do not change `plots.ts`.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec prettier --write packages/core/src/planner.ts packages/core/src/planner.test.ts
git add packages/core/src
git commit -m "feat(core): planner visitors, greenhouse, plot unlock and level rows" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Per-Greenhouse watering interval (player input)

**Files:**
- Modify: `apps/web/src/state/storage.ts`, `apps/web/src/state/storage.test.ts:139,189,207`, `apps/web/src/viewmodels/greenhouse.test.ts:14,35`, `apps/web/src/greenhouse/GreenhousePanel.tsx`, `apps/web/src/greenhouse/GreenhousePanel.test.tsx`

**Interfaces:**
- Produces: `GreenhouseSave.wateringIntervalHours: number | null`; `GardenStorage.setWateringInterval(plotId: string, hours: number | null): void`; `MAX_WATERING_INTERVAL_HOURS = 720`. This is the same field the cloud-sync op `setWateringInterval` will carry in milestone B, so keep the name.

- [ ] **Step 1: Write the failing storage tests**

In `apps/web/src/state/storage.test.ts`, inside `describe("greenhouse storage", ...)` add:

```ts
  it("stores a watering interval, rejects bad values, and clears with null", () => {
    const s = createGardenStorage(null);
    s.markGreenhouse("beginner_3");
    s.setWateringInterval("beginner_3", 8);
    expect(s.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours).toBe(8);
    s.setWateringInterval("beginner_3", 0);
    s.setWateringInterval("beginner_3", -2);
    s.setWateringInterval("beginner_3", Number.NaN);
    s.setWateringInterval("beginner_3", 721);
    expect(s.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours).toBe(8);
    s.setWateringInterval("beginner_3", null);
    expect(s.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours).toBeNull();
    s.setWateringInterval("beginner_1", 4); // not a Greenhouse: ignored
    expect(s.getSnapshot().greenhouses.beginner_1).toBeUndefined();
  });

  it("loads a saved interval and drops an invalid one", () => {
    const backing = new Map<string, string>();
    const store = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const first = createGardenStorage(store);
    first.markGreenhouse("beginner_3");
    first.setWateringInterval("beginner_3", 6);
    expect(
      createGardenStorage(store).getSnapshot().greenhouses.beginner_3
        ?.wateringIntervalHours,
    ).toBe(6);

    const raw = JSON.parse([...backing.values()][0] as string);
    raw.greenhouses.beginner_3.wateringIntervalHours = "soon";
    backing.set([...backing.keys()][0] as string, JSON.stringify(raw));
    expect(
      createGardenStorage(store).getSnapshot().greenhouses.beginner_3
        ?.wateringIntervalHours,
    ).toBeNull();
  });
```

Also update the three existing expectations that deep-compare a save so they include the new field: lines 139, 189 and 207 get `wateringIntervalHours: null` added to the expected object (e.g. `{ cells: {}, lastWateredAt: null, wateringIntervalHours: null }`), and likewise the object literals at `apps/web/src/viewmodels/greenhouse.test.ts:14` and `:35` if typecheck asks for it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/web test -- src/state/storage.test.ts` (real package name from `apps/web/package.json`)
Expected: FAIL (`setWateringInterval is not a function`).

- [ ] **Step 3: Implement in `storage.ts`**

- Export `export const MAX_WATERING_INTERVAL_HOURS = 720;` next to `MAX_GREENHOUSES`.
- Extend the interface:

```ts
export interface GreenhouseSave {
  /** Cell key "x,z" -> placed crop or mutation id. */
  cells: Record<string, string>;
  /** Epoch ms of the player's last "I watered it" press, or null. */
  lastWateredAt: number | null;
  /** Player-chosen "water again after N hours"; null until set (no verified default). */
  wateringIntervalHours: number | null;
}
```

- Add a helper above `parseGreenhouses`:

```ts
function validInterval(v: unknown): number | null {
  return typeof v === "number" &&
    Number.isFinite(v) &&
    v > 0 &&
    v <= MAX_WATERING_INTERVAL_HOURS
    ? v
    : null;
}
```

- In `parseGreenhouses`, add `wateringIntervalHours: validInterval(r.wateringIntervalHours),` to the object assigned to `out[plotId]`.
- Add `setWateringInterval(plotId: string, hours: number | null): void;` to `GardenStorage`.
- In `markGreenhouse`, the new save becomes `{ cells: {}, lastWateredAt: null, wateringIntervalHours: null }`.
- Add the method after `markGreenhouseWatered`:

```ts
    setWateringInterval(plotId, hours) {
      const save = data.greenhouses[plotId];
      if (save === undefined) return;
      if (hours !== null && validInterval(hours) === null) return;
      commit({
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [plotId]: { ...save, wateringIntervalHours: hours },
        },
      });
    },
```

- [ ] **Step 4: Run storage tests and typecheck**

Run: `pnpm --filter @garden-hq/web test -- src/state/storage.test.ts && pnpm --filter @garden-hq/web typecheck`
Expected: storage tests PASS; fix any remaining type errors in test fixtures flagged by typecheck.

- [ ] **Step 5: Write the failing panel test**

In `apps/web/src/greenhouse/GreenhousePanel.test.tsx` add next to the watering test:

```tsx
  it("stores a watering reminder interval and clears it", async () => {
    const { storage, user } = setup();
    const input = screen.getByLabelText(/remind me every/i);
    await user.type(input, "8");
    expect(
      storage.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours,
    ).toBe(8);
    await user.clear(input);
    expect(
      storage.getSnapshot().greenhouses.beginner_3?.wateringIntervalHours,
    ).toBeNull();
  });
```

- [ ] **Step 6: Run to verify it fails, then implement the input**

Run: `pnpm --filter @garden-hq/web test -- src/greenhouse/GreenhousePanel.test.tsx`
Expected: FAIL (no such label).

In `GreenhousePanel.tsx` import `MAX_WATERING_INTERVAL_HOURS` from `"../state/storage"` and add, directly after the watered `<p>` (before `<GreenhouseGrid`):

```tsx
      <p>
        <label>
          Remind me every{" "}
          <input
            type="number"
            min={1}
            max={MAX_WATERING_INTERVAL_HOURS}
            step={1}
            inputMode="numeric"
            value={save?.wateringIntervalHours ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              storage.setWateringInterval(
                plotId,
                raw === "" ? null : Number(raw),
              );
            }}
          />{" "}
          hours after watering
        </label>
      </p>
```

- [ ] **Step 7: Run web tests and commit**

Run: `pnpm --filter @garden-hq/web test -- src/greenhouse src/state src/viewmodels && pnpm --filter @garden-hq/web typecheck`
Expected: PASS.

```bash
pnpm exec prettier --write apps/web/src/state apps/web/src/greenhouse apps/web/src/viewmodels
git add apps/web/src
git commit -m "feat(web): per-Greenhouse watering interval" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: "Do next" card on Home

**Files:**
- Create: `apps/web/src/components/DoNextCard.tsx`, `apps/web/src/components/DoNextCard.test.tsx`
- Modify: `apps/web/src/screens/HomeScreen.tsx`, `apps/web/src/index.css` (append)

**Interfaces:**
- Consumes: `planActions`, `MAX_SHOWN_ACTIONS`, `PlannedAction`, `GardenState` from `@garden-hq/core`; `useContests` from `../state/queries` (returns `{ data?: { contests: Contest[] } }`); `useStoredData` from `../state/StorageProvider` (`assignments`, `greenhouses`, where each `GreenhouseSave` structurally satisfies `GreenhousePlan`); `useNow` from `../state/useNow`.
- Produces: `<DoNextCard garden={GardenState} />`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/DoNextCard.test.tsx`:

```tsx
import { ALL_PLOTS, type Contest, type GardenState } from "@garden-hq/core";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { DoNextCard } from "./DoNextCard";

const contests = vi.fn<() => Contest[]>();
vi.mock("../state/queries", () => ({
  useContests: () => ({ data: { contests: contests() } }),
}));

function gardenState(over: Partial<GardenState> = {}): GardenState {
  return {
    level: 5,
    experience: 600,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 1_000_000,
      fuel: 1_000_000,
      compostUnits: 3,
      lastSave: Date.now(),
      upgrades: {
        speed: 0,
        multiDrop: 0,
        fuelCap: 0,
        organicMatterCap: 0,
        costReduction: 0,
      },
    },
    visitorsServedTotal: 0,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...over,
  };
}

describe("DoNextCard", () => {
  beforeEach(() => contests.mockReturnValue([]));

  it("lists planned actions, linking the contest to the Contests screen", () => {
    contests.mockReturnValue([
      { startsAt: Date.now() + 10 * 60_000, crops: ["wheat", "carrot", "potato"] },
    ]);
    const storage = createGardenStorage(null);
    storage.setAssignment("beginner_1", "wheat");

    renderWithProviders(
      <DoNextCard
        garden={gardenState({ visitors: [{ id: "a", name: "Jacob" }] })}
      />,
      { storage },
    );

    expect(
      screen.getByRole("link", { name: /Wheat contest in \d+ min/ }),
    ).toHaveAttribute("href", "/contests");
    expect(screen.getByText("1/5 visitors waiting")).toBeInTheDocument();
    expect(screen.getByText(/^Unlock plot \d+$/)).toBeInTheDocument();
  });

  it("shows at most the configured number of actions", () => {
    const storage = createGardenStorage(null);
    storage.markGreenhouse("beginner_3");
    renderWithProviders(
      <DoNextCard
        garden={gardenState({
          visitors: [{ id: "a", name: "Jacob" }],
          composter: { ...gardenState().composter, fuel: 0 },
        })}
      />,
      { storage },
    );
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(5);
  });

  it("says there is nothing to do when the planner returns nothing", () => {
    renderWithProviders(
      <DoNextCard
        garden={gardenState({
          level: 15,
          experience: 60_120,
          unlockedPlotIds: ALL_PLOTS.map((plot) => plot.id),
        })}
      />,
    );
    expect(screen.getByText("Nothing to do right now.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @garden-hq/web test -- src/components/DoNextCard.test.tsx`
Expected: FAIL, cannot resolve `./DoNextCard`.

- [ ] **Step 3: Implement the component**

`apps/web/src/components/DoNextCard.tsx`:

```tsx
import {
  MAX_SHOWN_ACTIONS,
  planActions,
  type GardenState,
  type PlannedAction,
} from "@garden-hq/core";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useContests } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";

/** Only actions that have their own screen link out; the rest are on Home already. */
const SCREEN: Partial<Record<PlannedAction["kind"], string>> = {
  contest_soon: "/contests",
  greenhouse_water: "/greenhouse",
};

export function DoNextCard({ garden }: { garden: GardenState }) {
  const now = useNow(30_000);
  const contests = useContests();
  const { assignments, greenhouses } = useStoredData();

  const actions = useMemo(
    () =>
      planActions({
        now,
        garden,
        contests: contests.data?.contests ?? [],
        assignments,
        greenhouses,
      }).slice(0, MAX_SHOWN_ACTIONS),
    [now, garden, contests.data, assignments, greenhouses],
  );

  return (
    <section className="card" aria-label="Do next">
      <h2>Do next</h2>
      {actions.length === 0 ? (
        <p>Nothing to do right now.</p>
      ) : (
        <ol className="do-next">
          {actions.map((action) => {
            const to = SCREEN[action.kind];
            return (
              <li key={action.id}>
                <strong>
                  {to === undefined ? (
                    action.title
                  ) : (
                    <Link to={to}>{action.title}</Link>
                  )}
                </strong>
                <span className="muted">{action.detail}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
```

Append to `apps/web/src/index.css`:

```css
.do-next {
  margin: 0;
  padding-left: 1.25rem;
}

.do-next li {
  margin-bottom: 0.5rem;
}

.do-next .muted {
  display: block;
}
```

In `HomeScreen.tsx` add `import { DoNextCard } from "../components/DoNextCard";` and render `<DoNextCard garden={state} />` as the first child of the loaded fragment, directly above `<MapSection ...>`. (`SyncBar` sits right above it and already shows "Last synced X min ago", so the card does not repeat it.)

- [ ] **Step 4: Run web tests, typecheck, lint**

Run: `pnpm --filter @garden-hq/web test && pnpm --filter @garden-hq/web typecheck && pnpm lint`
Expected: PASS; lint shows only the pre-existing `Countdown.tsx` react-refresh warning.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/web/src/components apps/web/src/screens apps/web/src/index.css
git add apps/web/src
git commit -m "feat(web): Do next card on Home" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Record uncertainties and verify the milestone

**Files:**
- Modify: `data/VERIFY.md`

- [ ] **Step 1: Append to `data/VERIFY.md`**

```markdown

## Planner (Phase 3A, 2026-10-07)

- **Compost shortfall for a plot unlock** — the API exposes Compost sitting in the composter bin, not the player's inventory, so the planner shows "Costs N Compost. Composter holds M ready." and never claims a shortfall. Resolves if the API (or the player, via an input) gives inventory Compost.
- **Visitor copper / Garden XP value** — dropped from the planner. `data/visitors.json` (CLAUDE.md §5) does not exist yet; `planner.ts` has a `TODO(visitors.json)`. "Fastest source" for the next Garden level depends on it, so that row shows only the XP remaining.
- **Planner thresholds** (`data/planner.json`): contest window 60 min, fuel early warning 30 min, Greenhouse lead 30 min, visitor queue 5. These are product choices, not game facts, except the queue size of 5 (CLAUDE.md §2).
- **Greenhouse watering interval** — there is no verified water duration (see "Water/decay" above), so the row only fires when the player sets an interval AND has pressed "I watered it".
```

- [ ] **Step 2: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format`
Expected: typecheck clean; lint shows only the known `Countdown.tsx` warning; all tests pass; prettier clean (run `pnpm format:write` and re-commit if it reports files).

- [ ] **Step 3: Check the real app once**

Run `pnpm --filter @garden-hq/web dev` and `pnpm --filter @garden-hq/worker dev` (owner's linked account), open the Home screen at 380 px width, and confirm: the "Do next" card sits between the sync bar and the map, rows wrap without horizontal scroll, the contest/Greenhouse rows are links. In the Worker's wrangler output or `wrangler kv key list --binding CACHE`, confirm no `garden:` or `link:` keys are created. Report what was and was not checked; if the dev servers cannot be run, say so rather than claiming it works.

- [ ] **Step 4: Commit**

```bash
git add data/VERIFY.md
git commit -m "docs: record planner uncertainties in VERIFY" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (against the spec)

- **KV fix first (decision 8):** Task 1, before any planner work.
- **Planner interface, tiers, ranking, "my crop" rule, stale assignments:** Tasks 2-3 (`planner.ts`), with tests for each trigger and non-trigger, tier-then-`dueAt` order, determinism.
- **Fuel: alert-once semantics and optional early warning:** the planner shows `composter_no_fuel` always and `composter_fuel_low` inside the 30 min window; the "alert once / optional / editable" part is milestone C (alerts) and its settings UI, not here. Planner thresholds live in `data/planner.json` and become user-editable in milestone C.
- **Visitors threshold 5/5 for alerts:** an alert concern (C). The planner row appears for any waiting visitor and shows `n/5`.
- **Copper value dropped, TODO left (decision 10):** Task 3 (`TODO(visitors.json)`), Task 6 (VERIFY).
- **Greenhouse needs an interval:** Task 4 adds the field and input; the planner never fires without one.
- **Home "Do next" card, last-synced shown:** Task 5; last-synced comes from the `SyncBar` directly above.
- **Deviation from spec:** the spec said "tap opens the relevant screen (contests, composter gauge, map plot, Greenhouse tab)". Only contest and Greenhouse rows have their own screen; the others are already on Home, so they are not links.
- **Not in this plan (later milestones):** D1, accounts, sync, cron, Discord, Hypixel-key rotation docs, per-IP sync-code rate limit, the Settings sync-code UI.
- **Types consistent across tasks:** `PlannerInput`, `PlannedAction`, `GreenhousePlan`, `MAX_SHOWN_ACTIONS` (Task 2) are used unchanged in Tasks 3 and 5; `wateringIntervalHours` and `setWateringInterval` (Task 4) match the milestone B op name.
