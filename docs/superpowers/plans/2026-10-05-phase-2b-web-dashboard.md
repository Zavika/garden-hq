# Phase 2b — Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first, read-only React app that links a Minecraft username through the Worker API and shows the Garden: PixiJS 5x5 plot map with Barn and visitors, composter panel, and a HUD (SkyBlock date, season, day/night, next contest, Mayor).

**Architecture:** One-way data flow: API client → TanStack Query → pure view-models → DOM screens and a Pixi scene that only receives a `MapViewModel`. Game logic additions (season, visitors, plot layout, crops, composter capacity) live in `packages/core`; UI-dependent view-models live in `apps/web/src/viewmodels`. Persisted state (link, plot→crop assignments, time zone) sits behind a `GardenStorage` interface.

**Tech Stack:** React 19, Vite 8, TypeScript strict, React Router, TanStack Query, Zustand, PixiJS v8 (lazy-loaded), Vitest + jsdom + React Testing Library, Cloudflare Pages/Workers.

**Spec:** `docs/superpowers/specs/2026-10-05-phase-2b-web-dashboard-design.md` (approved with changes 2026-10-05; changes are already folded into it).

## Global Constraints

- TypeScript strict everywhere; **no `any` in `packages/core`**. `erasableSyntaxOnly` is on in web: no parameter properties, no enums — declare class fields explicitly.
- Game numbers come from `/data/*.json`, never magic numbers in code.
- Every new `core` function gets a vitest test. Tests use fixtures, **never live API calls**.
- Every API field is optional — handle missing data at the boundary (`garden.ts`).
- Mobile-first: the map must work at **380 px** width. Pixi art: nearest-neighbour, **integer zoom only**. No ripped Hypixel/Minecraft textures.
- Footer on every screen: "Not affiliated with Hypixel or Mojang."
- Only `useNow()` calls `Date.now()` in the UI; **only HUD/countdown components subscribe to `useNow()`**, never the whole tree or the map.
- PixiJS is **lazy-loaded** (dynamic `import()`); `/link` and `/settings` must not download it.
- Uncertain mechanics get a `// VERIFY:` comment and an entry in `data/VERIFY.md`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Test commands: core `pnpm --filter @garden-hq/core exec vitest run <file>`; web `pnpm --filter @garden-hq/web exec vitest run <file>`; everything `pnpm typecheck && pnpm lint && pnpm test`.

## File Structure

```
data/plots.json                       MODIFY  x/y filled, + top-level "grid"
data/VERIFY.md                        MODIFY
packages/core/src/plots.ts            MODIFY  x/y non-null, GRID_SIZE, BARN_CELL
packages/core/src/calendar.ts         MODIFY  + seasonOf, drop month VERIFY
packages/core/src/garden.ts           MODIFY  + visitors
packages/core/src/types.ts            MODIFY  GardenState.visitors
packages/core/src/crops.ts            CREATE  ALL_CROPS, getCrop
packages/core/src/composter.ts        MODIFY  + composterCapacity
packages/core/src/api.ts              CREATE  response envelope types + ApiErrorCode
packages/core/fixtures/garden-response.sample.json  MODIFY  active_commissions
apps/worker/src/errors.ts             MODIFY  ErrorCode = ApiErrorCode
apps/web/vite.config.ts               MODIFY  vitest config
apps/web/src/test/                    CREATE  setup.ts, renderWithProviders.tsx
apps/web/src/api/client.ts            CREATE  ApiError, createApiClient, api
apps/web/src/state/storage.ts         CREATE  GardenStorage
apps/web/src/state/StorageProvider.tsx CREATE
apps/web/src/state/useNow.ts          CREATE
apps/web/src/state/queryClient.ts     CREATE
apps/web/src/state/queries.ts         CREATE
apps/web/src/state/ui.ts              CREATE  Zustand UI store
apps/web/src/viewmodels/{map,hud,composter,contests}.ts  CREATE
apps/web/src/screens/{LinkScreen,HomeScreen,ContestsScreen,SettingsScreen}.tsx CREATE
apps/web/src/components/{Layout,Footer,TabBar,Hud,ComposterPanel,VisitorsPanel,SyncBar,Countdown,ErrorCard}.tsx CREATE
apps/web/src/map/{MapScene.ts,MapCanvas.tsx,palette.ts,PlotList.tsx,AssignCropSheet.tsx,MapSection.tsx} CREATE
apps/worker/README.md                 MODIFY  (Task 14)
.github/workflows/ci.yml              MODIFY  (Task 14)
```

---

### Task 1: Real plot layout (replaces the placeholder)

Source: SkyHanni `GardenPlotApi.kt` `plotMap`. Rows top→bottom, x = column 0-4, y = row 0-4, `0` = Barn:

```
21 13  9 14 22
15  5  1  6 16
10  2  0  3 11
17  7  4  8 18
23 19 12 20 24
```

Plot number → API id: 1-4 = `beginner_1-4`, 5-8 = `intermediate_1-4`, 9-12 = `advanced_1-4`, 13-24 = `expert_1-12`.

(There is no `placeholderPlotGrid()` in the repo at this commit — `grep -rn placeholderPlotGrid` returns nothing outside the spec — so "drop it" is a no-op; the real work is replacing the `null` x/y.)

**Files:**
- Modify: `data/plots.json`, `packages/core/src/plots.ts`, `packages/core/src/plots.test.ts`, `data/VERIFY.md`

**Interfaces:**
- Produces: `PlotDefinition.x: number`, `PlotDefinition.y: number` (no longer nullable); `GRID_SIZE: number` (5); `BARN_CELL: { x: number; y: number }` (2,2) — both read from `data/plots.json` `grid`.

- [ ] **Step 1: Write the failing tests** — append to `packages/core/src/plots.test.ts` (add `BARN_CELL, GRID_SIZE` to the import from `./plots`):

```ts
const SKYHANNI_GRID = [
  [21, 13, 9, 14, 22],
  [15, 5, 1, 6, 16],
  [10, 2, 0, 3, 11],
  [17, 7, 4, 8, 18],
  [23, 19, 12, 20, 24],
];

function idForNumber(n: number): string {
  if (n <= 4) return `beginner_${n}`;
  if (n <= 8) return `intermediate_${n - 4}`;
  if (n <= 12) return `advanced_${n - 8}`;
  return `expert_${n - 12}`;
}

describe("plot layout", () => {
  it("places every plot at its SkyHanni plotMap cell", () => {
    SKYHANNI_GRID.forEach((row, y) =>
      row.forEach((n, x) => {
        if (n === 0) return;
        const plot = getPlot(idForNumber(n));
        expect({ id: plot?.id, x: plot?.x, y: plot?.y }).toEqual({
          id: idForNumber(n),
          x,
          y,
        });
      }),
    );
  });

  it("uses 24 unique in-range cells that exclude the Barn", () => {
    const cells = ALL_PLOTS.map((p) => `${p.x},${p.y}`);
    expect(new Set(cells).size).toBe(24);
    for (const p of ALL_PLOTS) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(GRID_SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(GRID_SIZE);
    }
    expect(cells).not.toContain(`${BARN_CELL.x},${BARN_CELL.y}`);
  });

  it("puts the Barn in the centre of a 5x5 grid", () => {
    expect(GRID_SIZE).toBe(5);
    expect(BARN_CELL).toEqual({ x: 2, y: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @garden-hq/core exec vitest run src/plots.test.ts`
Expected: FAIL (`GRID_SIZE`/`BARN_CELL` not exported; x/y are `null`).

- [ ] **Step 3: Fill the data** — save this script outside the repo (e.g. your scratchpad) as `place-plots.mjs`, run it from the repo root with `node <path>/place-plots.mjs`, then `pnpm prettier --write data/plots.json`:

```js
import { readFileSync, writeFileSync } from "node:fs";

const GRID = [
  [21, 13, 9, 14, 22],
  [15, 5, 1, 6, 16],
  [10, 2, 0, 3, 11],
  [17, 7, 4, 8, 18],
  [23, 19, 12, 20, 24],
];
const idFor = (n) =>
  n <= 4
    ? `beginner_${n}`
    : n <= 8
      ? `intermediate_${n - 4}`
      : n <= 12
        ? `advanced_${n - 8}`
        : `expert_${n - 12}`;

const pos = new Map();
GRID.forEach((row, y) =>
  row.forEach((n, x) => {
    if (n !== 0) pos.set(idFor(n), { x, y });
  }),
);

const path = "data/plots.json";
const json = JSON.parse(readFileSync(path, "utf8"));
for (const tier of json.tiers) {
  for (const plot of tier.plots) {
    const p = pos.get(plot.id);
    if (!p) throw new Error(`no cell for ${plot.id}`);
    plot.x = p.x;
    plot.y = p.y;
  }
}
json.grid = { size: 5, barn: { x: 2, y: 2 } };
writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
```

Verify: `git diff --stat data/plots.json` shows only `plots.json`, and `grep -c '"x": null' data/plots.json` prints `0`.

- [ ] **Step 4: Update `plots.ts`** — change the three `x: number | null; y: number | null` declarations to `x: number; y: number` (in `PlotDefinition` and `PlotsJsonPlot`), and add after `TIERS`:

```ts
const GRID = (
  plotsData as { grid: { size: number; barn: { x: number; y: number } } }
).grid;

export const GRID_SIZE: number = GRID.size;
export const BARN_CELL: { x: number; y: number } = { ...GRID.barn };
```

- [ ] **Step 5: Update `data/VERIFY.md`** — in the `## Plots` section replace the first bullet ("Grid (x, y) coordinates…") with:

```md
- **Plot number → API id suffix mapping is inferred** — x/y come from SkyHanni's `GardenPlotApi.kt` `plotMap` (plot numbers 1-24); mapping numbers to API ids (1-4 `beginner_*`, 5-8 `intermediate_*`, 9-12 `advanced_*`, 13-24 `expert_1-12`) is inferred from the tier counts. Confirm with a real account.
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @garden-hq/core exec vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add data/plots.json data/VERIFY.md packages/core/src/plots.ts packages/core/src/plots.test.ts
git commit -m "feat(core): real 5x5 plot layout from SkyHanni plotMap"
```

---

### Task 2: `seasonOf()` and month-name VERIFY cleanup

**Files:**
- Modify: `packages/core/src/calendar.ts`, `packages/core/src/calendar.test.ts`, `data/VERIFY.md`

**Interfaces:**
- Produces: `seasonOf(date: SkyblockDate): string` — returns the season name for `date.month` (1-12: Early Spring, Spring, Late Spring, Early Summer, Summer, Late Summer, Early Autumn, Autumn, Late Autumn, Early Winter, Winter, Late Winter).

- [ ] **Step 1: Failing test** — append to `calendar.test.ts` (add `seasonOf, skyblockDate, SKYBLOCK_EPOCH_MS, MS_PER_SKYBLOCK_DAY, DAYS_PER_MONTH` to its import from `./calendar` if not present):

```ts
describe("seasonOf", () => {
  const expected = [
    "Early Spring",
    "Spring",
    "Late Spring",
    "Early Summer",
    "Summer",
    "Late Summer",
    "Early Autumn",
    "Autumn",
    "Late Autumn",
    "Early Winter",
    "Winter",
    "Late Winter",
  ];

  it.each(expected.map((name, i) => [i + 1, name] as const))(
    "month %i is %s",
    (month, name) => {
      const now = new Date(
        SKYBLOCK_EPOCH_MS + (month - 1) * DAYS_PER_MONTH * MS_PER_SKYBLOCK_DAY,
      );
      expect(seasonOf(skyblockDate(now))).toBe(name);
    },
  );
});
```

- [ ] **Step 2: Run** `pnpm --filter @garden-hq/core exec vitest run src/calendar.test.ts` → FAIL (`seasonOf` not defined).

- [ ] **Step 3: Implement** — in `calendar.ts` delete the 4-line `// VERIFY: month names…` comment above `MONTH_NAMES` and add after `skyblockDate`:

```ts
export function seasonOf(date: SkyblockDate): string {
  return MONTH_NAMES[date.month - 1] ?? "Unknown";
}
```

- [ ] **Step 4: VERIFY.md** — in `## Calendar` delete the first bullet ("The 12 SkyBlock month names…"); keep the day/night bullet.

- [ ] **Step 5: Run** `pnpm --filter @garden-hq/core exec vitest run` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/calendar.ts packages/core/src/calendar.test.ts data/VERIFY.md
git commit -m "feat(core): seasonOf and confirm month names"
```

---

### Task 3: Visitors in `GardenState`

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/garden.ts`, `packages/core/src/garden.test.ts`, `packages/core/fixtures/garden-response.sample.json`, `data/VERIFY.md`

**Interfaces:**
- Produces: `GardenState.visitors: { id: string; name: string }[]`. `id` = the `active_commissions` key (e.g. `liam`); `name` = prettified id (`farmer_jon` → `Farmer Jon`) until `data/visitors.json` exists.

- [ ] **Step 1: Extend the fixture** — in `garden-response.sample.json` replace `"active_commissions": {},` with:

```json
  "active_commissions": {
    "liam": {},
    "farmer_jon": {}
  },
```

- [ ] **Step 2: Failing tests** — append to `garden.test.ts` (use the file's existing fixture import; if it imports the fixture as `sample`, reuse that name):

```ts
describe("visitors", () => {
  it("lists active_commissions keys with prettified names", () => {
    expect(normalizeGarden(sample).visitors).toEqual([
      { id: "liam", name: "Liam" },
      { id: "farmer_jon", name: "Farmer Jon" },
    ]);
  });

  it("is empty when active_commissions is missing or malformed", () => {
    expect(normalizeGarden({}).visitors).toEqual([]);
    expect(normalizeGarden({ active_commissions: 5 }).visitors).toEqual([]);
    expect(normalizeGarden(null).visitors).toEqual([]);
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter @garden-hq/core exec vitest run src/garden.test.ts` → FAIL.

- [ ] **Step 4: Implement** — `types.ts`: add `visitors: { id: string; name: string }[];` to `GardenState`. `garden.ts`: add `import { asRecord } from "./coerce";` and

```ts
function prettifyVisitorId(id: string): string {
  return id
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// VERIFY: active_commissions keys are internal visitor ids (e.g. "liam");
// other key formats are unconfirmed (see data/VERIFY.md). Display names come
// from prettifying the id until data/visitors.json (id -> name) exists.
function normalizeVisitors(raw: unknown): { id: string; name: string }[] {
  return Object.keys(asRecord(raw)).map((id) => ({
    id,
    name: prettifyVisitorId(id),
  }));
}
```

and in `normalizeGarden` add `visitors: normalizeVisitors(data.active_commissions),`. If `asRecord` has a different signature than `(unknown) => Record<string, unknown>`, read `coerce.ts` and adapt; do not duplicate it.

- [ ] **Step 5: Run everything** `pnpm typecheck && pnpm test`. Any object literal typed `GardenState` elsewhere (core/worker tests) now fails typecheck — add `visitors: []` there; any test comparing a whole normalized garden with `toEqual` needs the two new visitors. Expected: PASS.

- [ ] **Step 6: VERIFY.md** — under `## Garden API fixture` add:

```md
- **`active_commissions` key format** — the fixture uses internal ids like `liam` / `farmer_jon`; `normalizeGarden` prettifies them into display names. Real key format and the id → display-name table (`data/visitors.json`, later phase) are unconfirmed.
```

- [ ] **Step 7: Commit**

```bash
git add packages/core data/VERIFY.md
git commit -m "feat(core): expose active visitors on GardenState"
```

---

### Task 4: Core support — crops, composter capacity, API envelope types

**Files:**
- Create: `packages/core/src/crops.ts`, `packages/core/src/crops.test.ts`, `packages/core/src/api.ts`
- Modify: `packages/core/src/composter.ts`, `packages/core/src/composter.test.ts`, `packages/core/src/index.ts`, `apps/worker/src/errors.ts`, `data/VERIFY.md`

**Interfaces:**
- Produces:
  - `ALL_CROPS: CropDefinition[]`, `getCrop(id: string): CropDefinition | undefined`, `interface CropDefinition { id: string; name: string; unlockLevel: number; contestCrop: boolean }`
  - `composterCapacity(): { fuel: number; organicMatter: number }` (fully-upgraded caps from `data/composter.json`)
  - `type ApiErrorCode`, `ContestsSource { name: string; url: string }`, `LinkResponse`, `GardenResponse`, `ContestsResponse`, `MayorResponse` (each with `fetchedAt: string`)

- [ ] **Step 1: Failing tests.** `crops.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_CROPS, getCrop } from "./crops";

describe("crops", () => {
  it("has 13 crops", () => {
    expect(ALL_CROPS).toHaveLength(13);
  });

  it("finds a crop by id", () => {
    expect(getCrop("wheat")?.name).toBe("Wheat");
    expect(getCrop("wheat")?.unlockLevel).toBe(1);
  });

  it("returns undefined for an unknown id", () => {
    expect(getCrop("nope")).toBeUndefined();
  });
});
```

Append to `composter.test.ts` (add `composterCapacity` to the import and `import composterData from "../../../data/composter.json";` if absent):

```ts
describe("composterCapacity", () => {
  it("returns the fully-upgraded caps from data/composter.json", () => {
    expect(composterCapacity()).toEqual({
      fuel: composterData.upgrades.fuelCap.maxEffect,
      organicMatter: composterData.upgrades.organicMatterCap.maxEffect,
    });
    expect(composterCapacity().fuel).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @garden-hq/core exec vitest run src/crops.test.ts src/composter.test.ts` → FAIL.

- [ ] **Step 3: Implement.** `crops.ts`:

```ts
import cropData from "../../../data/crops.json";

export interface CropDefinition {
  id: string;
  name: string;
  unlockLevel: number;
  contestCrop: boolean;
}

export const ALL_CROPS: CropDefinition[] = (
  cropData as CropDefinition[]
).map((crop) => ({
  id: crop.id,
  name: crop.name,
  unlockLevel: crop.unlockLevel,
  contestCrop: crop.contestCrop,
}));

export function getCrop(id: string): CropDefinition | undefined {
  return ALL_CROPS.find((crop) => crop.id === id);
}
```

`composter.ts` (after `effectAtTier`):

```ts
// VERIFY: the per-player cap (base + tiers) is unconfirmed; the gauge uses
// the fully-upgraded cap as its denominator (see data/VERIFY.md).
export function composterCapacity(): { fuel: number; organicMatter: number } {
  return {
    fuel: DATA.upgrades.fuelCap.maxEffect,
    organicMatter: DATA.upgrades.organicMatterCap.maxEffect,
  };
}
```

`api.ts`:

```ts
import type { Contest, GardenState, Mayor, ProfileSummary } from "./types";

export type ApiErrorCode =
  | "unknown_player"
  | "no_garden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "upstream_down"
  | "missing_api_key"
  | "internal";

export interface ContestsSource {
  name: string;
  url: string;
}

export interface LinkResponse {
  uuid: string;
  name: string;
  profileId: string;
  profiles: ProfileSummary[];
  fetchedAt: string;
}

export interface GardenResponse {
  garden: GardenState;
  fetchedAt: string;
}

export interface ContestsResponse {
  contests: Contest[];
  source: ContestsSource;
  fetchedAt: string;
}

export interface MayorResponse {
  mayor: Mayor;
  fetchedAt: string;
}
```

`index.ts`: add `export * from "./crops"; export * from "./api";`.

`apps/worker/src/errors.ts`: replace the `export type ErrorCode = | …` union with

```ts
import type { ApiErrorCode } from "@garden-hq/core";

export type ErrorCode = ApiErrorCode;
```

Also open `apps/worker/src/contests.ts` lines 1-20 and confirm `ContestsSource` there is `{ name: string; url: string }` and the route returns `{ contests, source, fetchedAt }`; if it differs, change `api.ts` to match the Worker (the Worker is the source of truth).

- [ ] **Step 4: VERIFY.md** — under `## Composter` append: "`composterCapacity()` uses the fully-upgraded caps (`maxEffect`) as the gauge denominator; the real per-player cap (base + purchased tiers) is unconfirmed."

- [ ] **Step 5: Run** `pnpm typecheck && pnpm lint && pnpm test` → PASS (worker included).

- [ ] **Step 6: Commit**

```bash
git add packages/core apps/worker/src/errors.ts data/VERIFY.md
git commit -m "feat(core): crops lookup, composter capacity, API envelope types"
```

---

### Task 5: Web tooling (deps, vitest, test script)

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`
- Create: `apps/web/src/test/setup.ts`, `apps/web/src/smoke.test.ts` (deleted at the end of the task)

- [ ] **Step 1: Install**

```bash
pnpm --filter @garden-hq/web add react-router-dom @tanstack/react-query zustand pixi.js
pnpm --filter @garden-hq/web add -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Scripts** — in `apps/web/package.json` add `"test": "vitest run",` to `scripts`.

- [ ] **Step 3: `vite.config.ts`**

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 4: `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Smoke test** `src/smoke.test.ts`:

```ts
import { pingCore } from "@garden-hq/core";
import { expect, it } from "vitest";

it("web tests run and can import core", () => {
  expect(pingCore()).toContain("alive");
});
```

Run: `pnpm test` → web suite runs and passes (root `pnpm test` now includes web). Then `pnpm typecheck && pnpm lint`. If `tsc -b` complains about test types, add `"vitest/globals"` nothing — tests import from `vitest` explicitly, so no config change should be needed.

- [ ] **Step 6: Remove the smoke test and commit**

```bash
git rm -f apps/web/src/smoke.test.ts
git add apps/web pnpm-lock.yaml
git commit -m "chore(web): add router, query, zustand, pixi and vitest tooling"
```

---

### Task 6: API client

**Files:**
- Create: `apps/web/src/api/client.ts`, `apps/web/src/api/client.test.ts`

**Interfaces:**
- Consumes: `LinkResponse`, `GardenResponse`, `ContestsResponse`, `MayorResponse`, `ApiErrorCode` from `@garden-hq/core`.
- Produces:
  - `type ClientErrorCode = ApiErrorCode | "network" | "bad_response"`
  - `class ApiError extends Error { code: ClientErrorCode; status: number; retryAfter: number | undefined }` (`status` 0 for `network`)
  - `createApiClient(fetchFn?: typeof fetch, baseUrl?: string): { link(name: string): Promise<LinkResponse>; garden(profileId: string): Promise<GardenResponse>; contests(): Promise<ContestsResponse>; mayor(): Promise<MayorResponse> }`
  - `api` — the default client instance.

- [ ] **Step 1: Failing tests** `client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function clientWith(response: Response | Error) {
  const fetchFn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { fetchFn, client: createApiClient(fetchFn, "http://api.test") };
}

describe("api client", () => {
  it("GETs /api/link with the encoded name and returns the body", async () => {
    const body = {
      uuid: "u",
      name: "Steve",
      profileId: "p",
      profiles: [],
      fetchedAt: "2026-10-05T10:00:00.000Z",
    };
    const { client, fetchFn } = clientWith(jsonResponse(body));
    await expect(client.link("Steve 1")).resolves.toEqual(body);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit?];
    expect(url).toBe("http://api.test/api/link?name=Steve+1");
    expect(init?.credentials).toBeUndefined();
  });

  it("GETs /api/garden, /api/contests and /api/mayor", async () => {
    const { client, fetchFn } = clientWith(jsonResponse({ ok: 1 }));
    await client.garden("abc");
    await client.contests();
    await client.mayor();
    const urls = fetchFn.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      "http://api.test/api/garden?profile=abc",
      "http://api.test/api/contests",
      "http://api.test/api/mayor",
    ]);
  });

  it.each([
    ["bad_request", 400],
    ["unknown_player", 404],
    ["no_garden", 404],
    ["not_found", 404],
    ["missing_api_key", 500],
    ["internal", 500],
    ["upstream_down", 502],
  ] as const)("maps a %s error body (HTTP %i)", async (code, status) => {
    const { client } = clientWith(
      jsonResponse({ error: { code, message: "boom" } }, { status }),
    );
    const err = await client.mayor().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code, status, retryAfter: undefined });
  });

  it("maps rate_limited with retryAfter from the body", async () => {
    const { client } = clientWith(
      jsonResponse(
        { error: { code: "rate_limited", message: "slow down", retryAfter: 12 } },
        { status: 429 },
      ),
    );
    await expect(client.mayor()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfter: 12,
    });
  });

  it("falls back to the Retry-After header", async () => {
    const { client } = clientWith(
      jsonResponse(
        { error: { code: "rate_limited", message: "x" } },
        { status: 429, headers: { "Retry-After": "30" } },
      ),
    );
    await expect(client.mayor()).rejects.toMatchObject({ retryAfter: 30 });
  });

  it("maps a non-JSON error to a code derived from the status", async () => {
    const { client } = clientWith(new Response("oops", { status: 502 }));
    await expect(client.mayor()).rejects.toMatchObject({
      code: "upstream_down",
      status: 502,
    });
  });

  it("maps a network failure to code 'network' with status 0", async () => {
    const { client } = clientWith(new TypeError("Failed to fetch"));
    await expect(client.mayor()).rejects.toMatchObject({
      code: "network",
      status: 0,
    });
  });

  it("maps a 200 with a non-object body to 'bad_response'", async () => {
    const { client } = clientWith(jsonResponse("hello"));
    await expect(client.mayor()).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @garden-hq/web exec vitest run src/api/client.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `client.ts`:

```ts
import type {
  ApiErrorCode,
  ContestsResponse,
  GardenResponse,
  LinkResponse,
  MayorResponse,
} from "@garden-hq/core";

export type ClientErrorCode = ApiErrorCode | "network" | "bad_response";

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(
    code: ClientErrorCode,
    status: number,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const API_BASE: string =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:8787" : "");

const KNOWN_CODES: readonly ApiErrorCode[] = [
  "unknown_player",
  "no_garden",
  "not_found",
  "bad_request",
  "rate_limited",
  "upstream_down",
  "missing_api_key",
  "internal",
];

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 502) return "upstream_down";
  return "internal";
}

function parseRetryAfter(value: unknown, header: string | null): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds;
  }
  return undefined;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: Record<string, unknown> }).error
      : null;

  const rawCode = error?.code;
  const code =
    typeof rawCode === "string" &&
    (KNOWN_CODES as readonly string[]).includes(rawCode)
      ? (rawCode as ApiErrorCode)
      : codeFromStatus(res.status);
  const message =
    typeof error?.message === "string" ? error.message : `HTTP ${res.status}`;

  return new ApiError(
    code,
    res.status,
    message,
    parseRetryAfter(error?.retryAfter, res.headers.get("Retry-After")),
  );
}

export type FetchFn = typeof fetch;

export function createApiClient(
  fetchFn: FetchFn = (input, init) => fetch(input, init),
  baseUrl: string = API_BASE,
) {
  async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}${query}`);
    } catch {
      throw new ApiError("network", 0, "Network request failed");
    }

    if (!res.ok) throw await toApiError(res);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError("bad_response", res.status, "Response was not JSON");
    }
    if (typeof body !== "object" || body === null) {
      throw new ApiError("bad_response", res.status, "Unexpected response shape");
    }
    return body as T;
  }

  return {
    link: (name: string) => get<LinkResponse>("/api/link", { name }),
    garden: (profileId: string) =>
      get<GardenResponse>("/api/garden", { profile: profileId }),
    contests: () => get<ContestsResponse>("/api/contests"),
    mayor: () => get<MayorResponse>("/api/mayor"),
  };
}

export const api = createApiClient();
```

- [ ] **Step 4: Run** the test file → PASS. Then `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api
git commit -m "feat(web): typed API client with unified ApiError"
```

---

### Task 7: `GardenStorage`

**Files:**
- Create: `apps/web/src/state/storage.ts`, `apps/web/src/state/storage.test.ts`

**Interfaces:**
- Consumes: `ProfileSummary` from core.
- Produces:
  - `interface StoredLink { name: string; uuid: string; profileId: string; profiles: ProfileSummary[] }`
  - `interface StoredData { link: StoredLink | null; assignments: Record<string, string>; timeZone: string }`
  - `DEFAULT_TIME_ZONE = "Europe/Warsaw"`
  - `interface GardenStorage { getSnapshot(): StoredData; subscribe(l: () => void): () => void; setLink(l: StoredLink): void; clearLink(): void; setAssignment(plotId: string, cropId: string | null): void; setTimeZone(tz: string): void; clearAll(): void }` — `getSnapshot()` returns the same object reference until something changes (needed by `useSyncExternalStore`).
  - `type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem">`
  - `createGardenStorage(backing: Backing | null): GardenStorage` (null ⇒ in-memory only)
  - `browserBacking(): Backing | null`

- [ ] **Step 1: Failing tests** `storage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createGardenStorage,
  DEFAULT_TIME_ZONE,
  type Backing,
  type StoredLink,
} from "./storage";

function fakeBacking(initial: Record<string, string> = {}): Backing & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const LINK: StoredLink = {
  name: "Steve",
  uuid: "u1",
  profileId: "p1",
  profiles: [{ profileId: "p1", name: "Apple", selected: true }],
};

const throwing: Backing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("createGardenStorage", () => {
  it("starts empty with the default time zone", () => {
    const s = createGardenStorage(fakeBacking());
    expect(s.getSnapshot()).toEqual({
      link: null,
      assignments: {},
      timeZone: DEFAULT_TIME_ZONE,
    });
  });

  it("persists under the versioned key and reloads", () => {
    const backing = fakeBacking();
    const s = createGardenStorage(backing);
    s.setLink(LINK);
    s.setAssignment("beginner_1", "wheat");
    s.setTimeZone("America/New_York");
    expect(Object.keys(backing.data)).toEqual(["garden-hq:v1"]);

    const reloaded = createGardenStorage(backing).getSnapshot();
    expect(reloaded.link).toEqual(LINK);
    expect(reloaded.assignments).toEqual({ beginner_1: "wheat" });
    expect(reloaded.timeZone).toBe("America/New_York");
  });

  it("removes an assignment when cropId is null", () => {
    const s = createGardenStorage(null);
    s.setAssignment("beginner_1", "wheat");
    s.setAssignment("beginner_1", null);
    expect(s.getSnapshot().assignments).toEqual({});
  });

  it("clearLink keeps assignments; clearAll wipes everything", () => {
    const s = createGardenStorage(null);
    s.setLink(LINK);
    s.setAssignment("beginner_1", "wheat");
    s.clearLink();
    expect(s.getSnapshot().link).toBeNull();
    expect(s.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
    s.clearAll();
    expect(s.getSnapshot().assignments).toEqual({});
    expect(s.getSnapshot().timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it("returns a stable snapshot until something changes, and notifies", () => {
    const s = createGardenStorage(null);
    const first = s.getSnapshot();
    expect(s.getSnapshot()).toBe(first);
    const listener = vi.fn();
    const off = s.subscribe(listener);
    s.setTimeZone("UTC");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot()).not.toBe(first);
    off();
    s.setTimeZone("Europe/Warsaw");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores corrupt or wrongly-shaped stored JSON", () => {
    for (const raw of ["{not json", "42", '{"link":5,"assignments":[],"timeZone":9}']) {
      const s = createGardenStorage(fakeBacking({ "garden-hq:v1": raw }));
      expect(s.getSnapshot()).toEqual({
        link: null,
        assignments: {},
        timeZone: DEFAULT_TIME_ZONE,
      });
    }
  });

  it("falls back to in-memory when storage throws", () => {
    const s = createGardenStorage(throwing);
    expect(() => s.setLink(LINK)).not.toThrow();
    expect(s.getSnapshot().link).toEqual(LINK);
    expect(() => s.setAssignment("beginner_1", "wheat")).not.toThrow();
    expect(() => s.clearAll()).not.toThrow();
  });

  it("works with no backing at all", () => {
    const s = createGardenStorage(null);
    s.setLink(LINK);
    expect(s.getSnapshot().link).toEqual(LINK);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `storage.ts`:

```ts
import type { ProfileSummary } from "@garden-hq/core";

export interface StoredLink {
  name: string;
  uuid: string;
  profileId: string;
  profiles: ProfileSummary[];
}

export interface StoredData {
  link: StoredLink | null;
  assignments: Record<string, string>;
  timeZone: string;
}

export const DEFAULT_TIME_ZONE = "Europe/Warsaw";
const STORAGE_KEY = "garden-hq:v1";

export type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface GardenStorage {
  getSnapshot(): StoredData;
  subscribe(listener: () => void): () => void;
  setLink(link: StoredLink): void;
  clearLink(): void;
  setAssignment(plotId: string, cropId: string | null): void;
  setTimeZone(timeZone: string): void;
  clearAll(): void;
}

const EMPTY: StoredData = {
  link: null,
  assignments: {},
  timeZone: DEFAULT_TIME_ZONE,
};

function isProfile(v: unknown): v is ProfileSummary {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.profileId === "string" &&
    typeof p.name === "string" &&
    typeof p.selected === "boolean"
  );
}

function parseLink(v: unknown): StoredLink | null {
  if (typeof v !== "object" || v === null) return null;
  const l = v as Record<string, unknown>;
  if (
    typeof l.name !== "string" ||
    typeof l.uuid !== "string" ||
    typeof l.profileId !== "string" ||
    !Array.isArray(l.profiles)
  ) {
    return null;
  }
  return {
    name: l.name,
    uuid: l.uuid,
    profileId: l.profileId,
    profiles: l.profiles.filter(isProfile),
  };
}

function parseAssignments(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function load(backing: Backing | null): StoredData {
  if (backing === null) return EMPTY;
  try {
    const raw = backing.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const d = parsed as Record<string, unknown>;
    return {
      link: parseLink(d.link),
      assignments: parseAssignments(d.assignments),
      timeZone: typeof d.timeZone === "string" ? d.timeZone : DEFAULT_TIME_ZONE,
    };
  } catch {
    return EMPTY;
  }
}

export function createGardenStorage(backing: Backing | null): GardenStorage {
  let data = load(backing);
  const listeners = new Set<() => void>();

  function commit(next: StoredData): void {
    data = next;
    if (backing !== null) {
      try {
        backing.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable or full: keep going with in-memory state only.
      }
    }
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => data,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLink: (link) => commit({ ...data, link }),
    clearLink: () => commit({ ...data, link: null }),
    setAssignment(plotId, cropId) {
      const assignments = { ...data.assignments };
      if (cropId === null) delete assignments[plotId];
      else assignments[plotId] = cropId;
      commit({ ...data, assignments });
    },
    setTimeZone: (timeZone) => commit({ ...data, timeZone }),
    clearAll: () => commit({ ...EMPTY }),
  };
}

export function browserBacking(): Backing | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run** tests → PASS; `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/storage.ts apps/web/src/state/storage.test.ts
git commit -m "feat(web): versioned GardenStorage with in-memory fallback"
```

---

### Task 8: `useNow`, query client, queries, providers, UI store, test helper

**Files:**
- Create: `apps/web/src/state/{useNow.ts,useNow.test.ts,queryClient.ts,queryClient.test.ts,queries.ts,StorageProvider.tsx,ui.ts}`, `apps/web/src/test/renderWithProviders.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 6); `GardenStorage`, `createGardenStorage`, `browserBacking`, `StoredData` (Task 7).
- Produces:
  - `useNow(intervalMs?: number): number` — epoch ms, ticks every `intervalMs` (default 1000). **The only `Date.now()` caller in the UI.**
  - `shouldRetry(failureCount: number, error: unknown): boolean`; `createQueryClient(): QueryClient`
  - `useLink(): UseMutationResult<LinkResponse, ApiError, string>`; `useGarden(profileId: string | null)`; `useContests()`; `useMayor()`
  - `StorageProvider({ storage?, children })`, `useStorage(): GardenStorage`, `useStoredData(): StoredData`
  - `useUi` Zustand hook: `{ selectedPlotId: string | null; hoveredPlotId: string | null; selectPlot(id: string | null): void; hoverPlot(id: string | null): void }`
  - `renderWithProviders(ui, { storage?, route? })` test helper returning RTL render result plus `storage`.

- [ ] **Step 1: Failing tests.** `useNow.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time and ticks once per interval", () => {
    const { result } = renderHook(() => useNow(1000));
    const start = result.current;
    expect(start).toBe(Date.parse("2026-10-05T10:00:00Z"));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(start + 3000);
  });

  it("stops ticking after unmount", () => {
    const { result, unmount } = renderHook(() => useNow(1000));
    unmount();
    const frozen = result.current;
    vi.advanceTimersByTime(5000);
    expect(result.current).toBe(frozen);
  });
});
```

`queryClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { shouldRetry } from "./queryClient";

describe("shouldRetry", () => {
  it("never retries rate_limited or other 4xx", () => {
    expect(shouldRetry(0, new ApiError("rate_limited", 429, "x", 10))).toBe(false);
    expect(shouldRetry(0, new ApiError("unknown_player", 404, "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError("bad_request", 400, "x"))).toBe(false);
  });

  it("retries 5xx and network errors once", () => {
    expect(shouldRetry(0, new ApiError("upstream_down", 502, "x"))).toBe(true);
    expect(shouldRetry(1, new ApiError("upstream_down", 502, "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError("network", 0, "x"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run** both → FAIL.

- [ ] **Step 3: Implement.** `useNow.ts`:

```ts
import { useEffect, useState } from "react";

/** The only place the UI reads the clock. Subscribe only from HUD/countdown components. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
```

`queryClient.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry } },
  });
}
```

`queries.ts`:

```ts
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type ApiError } from "../api/client";

const MINUTE = 60_000;

export function useLink() {
  return useMutation<Awaited<ReturnType<typeof api.link>>, ApiError, string>({
    mutationFn: (name) => api.link(name),
  });
}

export function useGarden(profileId: string | null) {
  return useQuery({
    queryKey: ["garden", profileId],
    queryFn: () => api.garden(profileId as string),
    enabled: profileId !== null,
    refetchInterval: MINUTE,
  });
}

export function useContests() {
  return useQuery({
    queryKey: ["contests"],
    queryFn: () => api.contests(),
    refetchInterval: 15 * MINUTE,
  });
}

export function useMayor() {
  return useQuery({
    queryKey: ["mayor"],
    queryFn: () => api.mayor(),
    refetchInterval: 60 * MINUTE,
  });
}
```

`StorageProvider.tsx`:

```tsx
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  browserBacking,
  createGardenStorage,
  type GardenStorage,
  type StoredData,
} from "./storage";

const StorageContext = createContext<GardenStorage | null>(null);

export function StorageProvider({
  storage,
  children,
}: {
  storage?: GardenStorage;
  children: ReactNode;
}) {
  const value = useMemo(
    () => storage ?? createGardenStorage(browserBacking()),
    [storage],
  );
  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStorage(): GardenStorage {
  const storage = useContext(StorageContext);
  if (storage === null) throw new Error("useStorage outside StorageProvider");
  return storage;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStoredData(): StoredData {
  const storage = useStorage();
  return useSyncExternalStore(storage.subscribe, storage.getSnapshot);
}
```

`ui.ts`:

```ts
import { create } from "zustand";

interface UiState {
  selectedPlotId: string | null;
  hoveredPlotId: string | null;
  selectPlot: (id: string | null) => void;
  hoverPlot: (id: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  selectedPlotId: null,
  hoveredPlotId: null,
  selectPlot: (selectedPlotId) => set({ selectedPlotId }),
  hoverPlot: (hoveredPlotId) => set({ hoveredPlotId }),
}));
```

`test/renderWithProviders.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { StorageProvider } from "../state/StorageProvider";
import { createQueryClient } from "../state/queryClient";
import { createGardenStorage, type GardenStorage } from "../state/storage";

export function renderWithProviders(
  ui: ReactElement,
  options: { storage?: GardenStorage; route?: string } = {},
) {
  const storage = options.storage ?? createGardenStorage(null);
  const client = createQueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <StorageProvider storage={storage}>
        <MemoryRouter initialEntries={[options.route ?? "/"]}>{ui}</MemoryRouter>
      </StorageProvider>
    </QueryClientProvider>,
  );
  return { ...result, storage, client };
}
```

- [ ] **Step 4: Run** `pnpm --filter @garden-hq/web exec vitest run && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): useNow, query client, queries, storage provider, UI store"
```

---

### Task 9: View-models (map, HUD, composter, contests)

**Files:**
- Create: `apps/web/src/viewmodels/{map,hud,composter,contests}.ts` and a `*.test.ts` for each.

**Interfaces:**
- Consumes: `GardenState`, `ALL_PLOTS`, `getPlot`, `BARN_CELL`, `Contest`, `Mayor`, `MayorPerk`, `skyblockDate`, `seasonOf`, `isDaytime`, `forecastComposter`, `composterCapacity`, `SkyblockDate` from core.
- Produces:
  - `buildMapViewModel(garden: GardenState, assignments: Record<string, string>): MapViewModel` where `MapViewModel = { tiles: (PlotTile | BarnTile)[] }`, `PlotTile = { kind: "plot"; plotId: string; x: number; y: number; state: "locked" | "unlocked" | "assigned"; cropId?: string; lockedCost: number | null }`, `BarnTile = { kind: "barn"; x: number; y: number; visitors: { id: string; name: string }[]; overflow: number }`, and `export const MAX_VISITOR_MARKERS = 5`.
  - `buildHudViewModel(now: number, contests: Contest[] | null, mayor: Mayor | null, assignedCropIds: string[]): HudViewModel` (`null` ⇒ that source is unavailable).
  - `buildComposterViewModel(composter: ComposterState, now: number): ComposterViewModel`.
  - `buildContestsViewModel(contests: Contest[], assignedCropIds: string[], now: number, timeZone: string): ContestsViewModel`.

**Deviation from spec, deliberate:** `buildMapViewModel` takes no `now` — the map must not depend on the clock (Global Constraints) and an unused parameter fails `noUnusedParameters`.

- [ ] **Step 1: Failing tests.** `map.test.ts`:

```ts
import { ALL_PLOTS, BARN_CELL, normalizeGarden } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildMapViewModel, type BarnTile, type PlotTile } from "./map";

function garden(overrides: Record<string, unknown> = {}) {
  return normalizeGarden({
    garden_experience: 0,
    unlocked_plots_ids: ["beginner_1", "beginner_2"],
    active_commissions: { liam: {}, farmer_jon: {} },
    ...overrides,
  });
}

function plots(vm: ReturnType<typeof buildMapViewModel>): PlotTile[] {
  return vm.tiles.filter((t): t is PlotTile => t.kind === "plot");
}

describe("buildMapViewModel", () => {
  it("has 24 plot tiles and one barn tile at the barn cell", () => {
    const vm = buildMapViewModel(garden(), {});
    expect(plots(vm)).toHaveLength(ALL_PLOTS.length);
    const barns = vm.tiles.filter((t): t is BarnTile => t.kind === "barn");
    expect(barns).toHaveLength(1);
    expect(barns[0]).toMatchObject({ x: BARN_CELL.x, y: BARN_CELL.y });
  });

  it("marks locked, unlocked and assigned plots", () => {
    const vm = buildMapViewModel(garden(), { beginner_1: "wheat" });
    const byId = new Map(plots(vm).map((t) => [t.plotId, t]));
    expect(byId.get("beginner_1")).toMatchObject({ state: "assigned", cropId: "wheat" });
    expect(byId.get("beginner_2")).toMatchObject({ state: "unlocked" });
    expect(byId.get("beginner_2")?.cropId).toBeUndefined();
    expect(byId.get("beginner_3")).toMatchObject({ state: "locked", lockedCost: 4 });
  });

  it("ignores an assignment on a still-locked plot", () => {
    const vm = buildMapViewModel(garden(), { beginner_4: "wheat" });
    expect(plots(vm).find((t) => t.plotId === "beginner_4")?.state).toBe("locked");
  });

  it("reports a null cost for plots whose cost is unknown", () => {
    const vm = buildMapViewModel(garden(), {});
    expect(plots(vm).find((t) => t.plotId === "expert_1")?.lockedCost).toBeNull();
  });

  it("puts visitors on the barn and counts overflow past 5", () => {
    const many = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f", "g"].map((k) => [k, {}]),
    );
    const barn = buildMapViewModel(garden({ active_commissions: many }), {}).tiles.find(
      (t): t is BarnTile => t.kind === "barn",
    );
    expect(barn?.visitors).toHaveLength(5);
    expect(barn?.overflow).toBe(2);
  });
});
```

`composter.test.ts`:

```ts
import { composterCapacity, normalizeGarden } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildComposterViewModel } from "./composter";

const HOUR = 3_600_000;

function composter(fields: Record<string, unknown>) {
  return normalizeGarden({
    composter_data: {
      organic_matter: 40_000,
      fuel_units: 20_000,
      compost_units: 3,
      last_save: 1_000_000,
      upgrades: {},
      ...fields,
    },
  }).composter;
}

describe("buildComposterViewModel", () => {
  it("uses the save snapshot when now equals last_save", () => {
    const c = composter({});
    const vm = buildComposterViewModel(c, 1_000_000);
    expect(vm.fuel).toBe(20_000);
    expect(vm.organicMatter).toBe(40_000);
    expect(vm.compostReady).toBe(3);
    expect(vm.fuelRatio).toBeCloseTo(20_000 / composterCapacity().fuel);
    expect(vm.organicMatterRatio).toBeCloseTo(
      40_000 / composterCapacity().organicMatter,
    );
  });

  it("drains over time and reports depletion times after last_save", () => {
    const c = composter({});
    const later = buildComposterViewModel(c, 1_000_000 + 2 * HOUR);
    expect(later.fuel).toBeLessThan(20_000);
    expect(later.fuelRunsOutAt).toBeGreaterThan(1_000_000);
    expect(later.organicMatterRunsOutAt).toBeGreaterThan(1_000_000);
  });

  it("clamps ratios to [0, 1]", () => {
    const vm = buildComposterViewModel(
      composter({ fuel_units: 99_999_999, organic_matter: 99_999_999 }),
      1_000_000,
    );
    expect(vm.fuelRatio).toBe(1);
    expect(vm.organicMatterRatio).toBe(1);
  });

  it("treats a missing last_save (0) as 'just saved' instead of draining to zero", () => {
    const vm = buildComposterViewModel(composter({ last_save: 0 }), 5_000_000_000);
    expect(vm.fuel).toBe(20_000);
    expect(vm.fuelRunsOutAt).toBeGreaterThan(5_000_000_000);
  });
});
```

`hud.test.ts`:

```ts
import { SKYBLOCK_EPOCH_MS, type Contest, type Mayor } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildHudViewModel } from "./hud";

const MAYOR: Mayor = {
  key: "finnegan",
  name: "Finnegan",
  perks: [{ name: "Farming Simulator", description: "…" }],
  minister: null,
};

const now = SKYBLOCK_EPOCH_MS;
const SOON: Contest = { startsAt: now + 600_000, crops: ["wheat", "carrot", "potato"] };
const LATER: Contest = { startsAt: now + 3_600_000, crops: ["melon", "cactus", "pumpkin"] };
const PAST: Contest = { startsAt: now - 1000, crops: ["wheat"] };

describe("buildHudViewModel", () => {
  it("derives date, season and day/night from the clock", () => {
    const vm = buildHudViewModel(now, [], MAYOR, []);
    expect(vm.date).toMatchObject({ year: 1, month: 1, day: 1 });
    expect(vm.season).toBe("Early Spring");
    expect(vm.isDay).toBe(true);
  });

  it("picks the earliest upcoming contest and flags assigned-crop matches", () => {
    const vm = buildHudViewModel(now, [LATER, PAST, SOON], MAYOR, ["carrot"]);
    expect(vm.nextContest).toEqual({
      status: "ok",
      startsAt: SOON.startsAt,
      crops: SOON.crops,
      matchesAssigned: true,
    });
  });

  it("reports matchesAssigned=false when no crop overlaps", () => {
    const vm = buildHudViewModel(now, [SOON], MAYOR, ["melon"]);
    expect(vm.nextContest).toMatchObject({ status: "ok", matchesAssigned: false });
  });

  it("distinguishes 'none upcoming' from 'unavailable'", () => {
    expect(buildHudViewModel(now, [PAST], MAYOR, []).nextContest).toEqual({
      status: "none",
    });
    expect(buildHudViewModel(now, null, MAYOR, []).nextContest).toEqual({
      status: "unavailable",
    });
  });

  it("passes the mayor through, or null when unavailable", () => {
    expect(buildHudViewModel(now, [], MAYOR, []).mayor).toBe(MAYOR);
    expect(buildHudViewModel(now, [], null, []).mayor).toBeNull();
  });
});
```

`contests.test.ts`:

```ts
import type { Contest } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { buildContestsViewModel } from "./contests";

const now = Date.UTC(2026, 9, 5, 10, 0); // 12:00 in Warsaw (CEST)
const AT_1230_UTC = Date.UTC(2026, 9, 5, 12, 30); // 14:30 in Warsaw

const contests: Contest[] = [
  { startsAt: now - 1000, crops: ["wheat"] },
  { startsAt: AT_1230_UTC, crops: ["wheat", "carrot", "potato"] },
  { startsAt: AT_1230_UTC + 3_600_000, crops: ["melon", "cactus", "pumpkin"] },
];

describe("buildContestsViewModel", () => {
  it("shows only upcoming contests, formatted in the given time zone", () => {
    const vm = buildContestsViewModel(contests, [], now, "Europe/Warsaw");
    expect(vm.rows).toHaveLength(2);
    expect(vm.rows[0]?.label).toContain("14:30");
  });

  it("shows everything with filtered=false when no crops are assigned", () => {
    const vm = buildContestsViewModel(contests, [], now, "UTC");
    expect(vm.filtered).toBe(false);
    expect(vm.rows).toHaveLength(2);
  });

  it("filters to contests that include an assigned crop", () => {
    const vm = buildContestsViewModel(contests, ["melon"], now, "UTC");
    expect(vm.filtered).toBe(true);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0]?.crops).toContain("melon");
  });

  it("falls back to the default time zone for an invalid zone name", () => {
    const vm = buildContestsViewModel(contests, [], now, "Not/AZone");
    expect(vm.rows[0]?.label).toContain("14:30");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @garden-hq/web exec vitest run src/viewmodels` → FAIL.

- [ ] **Step 3: Implement.** `map.ts`:

```ts
import { ALL_PLOTS, BARN_CELL, type GardenState } from "@garden-hq/core";

export const MAX_VISITOR_MARKERS = 5;

export interface PlotTile {
  kind: "plot";
  plotId: string;
  x: number;
  y: number;
  state: "locked" | "unlocked" | "assigned";
  cropId?: string;
  /** null = cost unknown (see data/VERIFY.md). */
  lockedCost: number | null;
}

export interface BarnTile {
  kind: "barn";
  x: number;
  y: number;
  visitors: { id: string; name: string }[];
  overflow: number;
}

export interface MapViewModel {
  tiles: (PlotTile | BarnTile)[];
}

export function buildMapViewModel(
  garden: GardenState,
  assignments: Record<string, string>,
): MapViewModel {
  const unlocked = new Set(garden.unlockedPlotIds);

  const plots: PlotTile[] = ALL_PLOTS.map((plot) => {
    const base = { kind: "plot" as const, plotId: plot.id, x: plot.x, y: plot.y };
    if (!unlocked.has(plot.id)) {
      return { ...base, state: "locked" as const, lockedCost: plot.cost };
    }
    const cropId = assignments[plot.id];
    return cropId === undefined
      ? { ...base, state: "unlocked" as const, lockedCost: null }
      : { ...base, state: "assigned" as const, cropId, lockedCost: null };
  });

  const barn: BarnTile = {
    kind: "barn",
    x: BARN_CELL.x,
    y: BARN_CELL.y,
    visitors: garden.visitors.slice(0, MAX_VISITOR_MARKERS),
    overflow: Math.max(0, garden.visitors.length - MAX_VISITOR_MARKERS),
  };

  return { tiles: [...plots, barn] };
}
```

`composter.ts`:

```ts
import {
  composterCapacity,
  forecastComposter,
  type ComposterState,
} from "@garden-hq/core";

export interface ComposterViewModel {
  fuel: number;
  fuelRatio: number;
  organicMatter: number;
  organicMatterRatio: number;
  fuelRunsOutAt: number | null;
  organicMatterRunsOutAt: number | null;
  compostReady: number;
}

function ratio(value: number, cap: number): number {
  return cap > 0 ? Math.min(1, Math.max(0, value / cap)) : 0;
}

export function buildComposterViewModel(
  composter: ComposterState,
  now: number,
): ComposterViewModel {
  // A missing last_save (0) would drain everything to zero; treat as just saved.
  const safe = composter.lastSave > 0 ? composter : { ...composter, lastSave: now };
  const forecast = forecastComposter(safe, now);
  const cap = composterCapacity();

  return {
    fuel: forecast.fuel,
    fuelRatio: ratio(forecast.fuel, cap.fuel),
    organicMatter: forecast.organicMatter,
    organicMatterRatio: ratio(forecast.organicMatter, cap.organicMatter),
    fuelRunsOutAt: forecast.fuelDepletesAt,
    organicMatterRunsOutAt: forecast.organicMatterDepletesAt,
    compostReady: composter.compostUnits,
  };
}
```

`hud.ts`:

```ts
import {
  isDaytime,
  seasonOf,
  skyblockDate,
  type Contest,
  type Mayor,
  type SkyblockDate,
} from "@garden-hq/core";

export type NextContest =
  | { status: "unavailable" }
  | { status: "none" }
  | { status: "ok"; startsAt: number; crops: string[]; matchesAssigned: boolean };

export interface HudViewModel {
  date: SkyblockDate;
  season: string;
  isDay: boolean;
  nextContest: NextContest;
  /** null = Mayor data unavailable. */
  mayor: Mayor | null;
}

export function buildHudViewModel(
  now: number,
  contests: Contest[] | null,
  mayor: Mayor | null,
  assignedCropIds: string[],
): HudViewModel {
  const when = new Date(now);
  const date = skyblockDate(when);

  let nextContest: NextContest;
  if (contests === null) {
    nextContest = { status: "unavailable" };
  } else {
    const next = contests
      .filter((c) => c.startsAt > now)
      .sort((a, b) => a.startsAt - b.startsAt)[0];
    nextContest =
      next === undefined
        ? { status: "none" }
        : {
            status: "ok",
            startsAt: next.startsAt,
            crops: next.crops,
            matchesAssigned: next.crops.some((c) => assignedCropIds.includes(c)),
          };
  }

  return { date, season: seasonOf(date), isDay: isDaytime(when), nextContest, mayor };
}
```

`contests.ts`:

```ts
import type { Contest } from "@garden-hq/core";
import { DEFAULT_TIME_ZONE } from "../state/storage";

const MAX_ROWS = 20;

export interface ContestRow {
  startsAt: number;
  label: string;
  crops: string[];
  matchesAssigned: boolean;
}

export interface ContestsViewModel {
  rows: ContestRow[];
  /** true when the list was narrowed to the player's assigned crops. */
  filtered: boolean;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      ...options,
      timeZone: DEFAULT_TIME_ZONE,
    });
  }
}

export function buildContestsViewModel(
  contests: Contest[],
  assignedCropIds: string[],
  now: number,
  timeZone: string,
): ContestsViewModel {
  const fmt = formatter(timeZone);
  const filtered = assignedCropIds.length > 0;

  const rows = contests
    .filter((c) => c.startsAt >= now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((c) => ({
      startsAt: c.startsAt,
      label: fmt.format(new Date(c.startsAt)),
      crops: c.crops,
      matchesAssigned: c.crops.some((crop) => assignedCropIds.includes(crop)),
    }))
    .filter((row) => !filtered || row.matchesAssigned)
    .slice(0, MAX_ROWS);

  return { rows, filtered };
}
```

- [ ] **Step 4: Run** tests → PASS; `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/viewmodels
git commit -m "feat(web): pure view-models for map, HUD, composter and contests"
```

---

### Task 10: App shell, routing, footer, Link screen

**Files:**
- Create: `apps/web/src/components/{Layout,Footer,TabBar,ErrorCard,Countdown}.tsx`, `apps/web/src/screens/LinkScreen.tsx`, `apps/web/src/screens/LinkScreen.test.tsx`, `apps/web/src/screens/{HomeScreen,ContestsScreen,SettingsScreen}.tsx` (placeholders `return <p>…</p>` filled in Tasks 11-13), `apps/web/src/App.tsx` (rewrite), `apps/web/src/main.tsx`, `apps/web/src/index.css` (rewrite)
- Delete: `apps/web/src/App.css`, `apps/web/src/assets/{hero.png,react.svg,vite.svg}` and any remaining references.

**Interfaces:**
- Consumes: `useLink`, `useContests`, `useStorage`, `useStoredData`, `useNow`, `ApiError`.
- Produces: routes `/link`, `/`, `/contests`, `/settings`; `<Countdown seconds: number>`-free helper `formatRemaining(ms: number): string` is not needed — screens format inline. `<ErrorCard title, message, onRetry?>`.

- [ ] **Step 1: Failing tests** `LinkScreen.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import { renderWithProviders } from "../test/renderWithProviders";
import { LinkScreen } from "./LinkScreen";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, link: vi.fn() } };
});

const link = vi.mocked(api.link);

function renderLink() {
  return renderWithProviders(
    <Routes>
      <Route path="/link" element={<LinkScreen />} />
      <Route path="/" element={<p>HOME</p>} />
    </Routes>,
    { route: "/link" },
  );
}

const ONE = {
  uuid: "u1",
  name: "Steve",
  profileId: "p1",
  profiles: [{ profileId: "p1", name: "Apple", selected: true }],
  fetchedAt: "2026-10-05T10:00:00.000Z",
};

describe("LinkScreen", () => {
  beforeEach(() => {
    link.mockReset();
  });

  it("links a single-profile player, stores the link and goes home", async () => {
    link.mockResolvedValue(ONE);
    const { storage } = renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));
    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(storage.getSnapshot().link).toMatchObject({ uuid: "u1", profileId: "p1" });
    expect(link).toHaveBeenCalledWith("Steve");
  });

  it("shows a picker for several profiles with the selected one preselected", async () => {
    link.mockResolvedValue({
      ...ONE,
      profileId: "p2",
      profiles: [
        { profileId: "p1", name: "Apple", selected: false },
        { profileId: "p2", name: "Banana", selected: true },
      ],
    });
    const { storage } = renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));

    const banana = await screen.findByRole("radio", { name: /banana/i });
    expect(banana).toBeChecked();
    expect(storage.getSnapshot().link).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: /apple/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(storage.getSnapshot().link?.profileId).toBe("p1");
  });

  it.each([
    [new ApiError("bad_request", 400, "x"), /valid minecraft username/i],
    [new ApiError("unknown_player", 404, "x"), /couldn.t find that player/i],
    [new ApiError("no_garden", 404, "x"), /no skyblock garden/i],
    [new ApiError("upstream_down", 502, "x"), /hypixel is unavailable/i],
    [new ApiError("network", 0, "x"), /couldn.t reach the server/i],
    [new ApiError("rate_limited", 429, "x", 30), /too many requests.*30/i],
  ])("shows an inline error for %o", async (error, message) => {
    link.mockRejectedValue(error);
    renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
  });

  it("shows a developer hint for missing_api_key only in dev builds", async () => {
    link.mockRejectedValue(new ApiError("missing_api_key", 500, "x"));
    renderLink();
    await userEvent.type(screen.getByLabelText(/minecraft username/i), "Steve");
    await userEvent.click(screen.getByRole("button", { name: /link/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/temporarily unavailable/i);
    // vitest runs with import.meta.env.DEV === true
    expect(alert).toHaveTextContent(/HYPIXEL_API_KEY/);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement the shell.**

`components/ErrorCard.tsx`:

```tsx
export function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card error-card" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
```

`components/Countdown.tsx` (subscribes to `useNow`; this and `Hud` are the only per-second subscribers):

```tsx
import { useNow } from "../state/useNow";

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function Countdown({ target }: { target: number }) {
  const now = useNow();
  return <time>{formatDuration(target - now)}</time>;
}
```

`components/Footer.tsx`:

```tsx
import { useContests } from "../state/queries";

export function Footer() {
  const contests = useContests();
  const source = contests.data?.source;

  return (
    <footer className="footer">
      <p>Not affiliated with Hypixel or Mojang.</p>
      <p>
        Credits: Jacob&apos;s Contest schedule from{" "}
        {source ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.name}
          </a>
        ) : (
          <a href="https://api.elitebot.dev" target="_blank" rel="noreferrer">
            EliteBot
          </a>
        )}
        ; game facts from the{" "}
        <a href="https://hypixelskyblock.minecraft.wiki" target="_blank" rel="noreferrer">
          SkyBlock wiki
        </a>
        ; plot layout after SkyHanni.
      </p>
    </footer>
  );
}
```

`components/TabBar.tsx`:

```tsx
import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/", label: "Home", end: true },
  { to: "/contests", label: "Contests", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function TabBar() {
  return (
    <nav className="tab-bar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
```

`components/Layout.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useStoredData } from "../state/StorageProvider";
import { Footer } from "./Footer";
import { TabBar } from "./TabBar";

export function Layout() {
  const { link } = useStoredData();
  const { pathname } = useLocation();
  const onLinkRoute = pathname === "/link";

  if (link === null && !onLinkRoute) return <Navigate to="/link" replace />;

  return (
    <div className="app">
      <main className="main">
        <Outlet />
      </main>
      <Footer />
      {link !== null && !onLinkRoute ? <TabBar /> : null}
    </div>
  );
}
```

`App.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ContestsScreen } from "./screens/ContestsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StorageProvider } from "./state/StorageProvider";
import { createQueryClient } from "./state/queryClient";

export default function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <StorageProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomeScreen />} />
              <Route path="link" element={<LinkScreen />} />
              <Route path="contests" element={<ContestsScreen />} />
              <Route path="settings" element={<SettingsScreen />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StorageProvider>
    </QueryClientProvider>
  );
}
```

`main.tsx` keeps its shape (it already imports `./index.css` and `App`).

`screens/LinkScreen.tsx`:

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { LinkResponse } from "@garden-hq/core";
import { ApiError } from "../api/client";
import { useLink } from "../state/queries";
import { useStorage } from "../state/StorageProvider";
import { useNow } from "../state/useNow";

function RateLimitNotice({ retryAfter }: { retryAfter: number | undefined }) {
  const now = useNow();
  const [startedAt] = useState(now);
  const total = retryAfter ?? 60;
  const remaining = Math.max(0, Math.ceil(total - (now - startedAt) / 1000));
  return (
    <p role="alert">
      Too many requests. Try again in {remaining}s.
    </p>
  );
}

function errorMessage(error: ApiError): string {
  switch (error.code) {
    case "bad_request":
      return "Enter a valid Minecraft username (3-16 letters, numbers or underscores).";
    case "unknown_player":
      return "We couldn't find that player.";
    case "no_garden":
    case "not_found":
      return "That player has no SkyBlock garden yet.";
    case "missing_api_key":
      return import.meta.env.DEV
        ? "Linking is temporarily unavailable. Dev hint: set HYPIXEL_API_KEY in apps/worker/.dev.vars."
        : "Linking is temporarily unavailable. Please try again later.";
    case "network":
      return "We couldn't reach the server. Check your connection.";
    default:
      return "Hypixel is unavailable right now. Try again in a moment.";
  }
}

export function LinkScreen() {
  const navigate = useNavigate();
  const storage = useStorage();
  const link = useLink();
  const [name, setName] = useState("");
  const [pending, setPending] = useState<LinkResponse | null>(null);
  const [chosen, setChosen] = useState<string>("");

  function finish(result: LinkResponse, profileId: string) {
    storage.setLink({
      name: result.name,
      uuid: result.uuid,
      profileId,
      profiles: result.profiles,
    });
    navigate("/", { replace: true });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    link.mutate(name.trim(), {
      onSuccess: (result) => {
        if (result.profiles.length > 1) {
          setPending(result);
          setChosen(result.profileId);
        } else {
          finish(result, result.profileId);
        }
      },
    });
  }

  if (pending !== null) {
    return (
      <section className="card">
        <h1>Choose a profile</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            finish(pending, chosen);
          }}
        >
          {pending.profiles.map((p) => (
            <label key={p.profileId} className="radio-row">
              <input
                type="radio"
                name="profile"
                value={p.profileId}
                checked={chosen === p.profileId}
                onChange={() => setChosen(p.profileId)}
              />
              {p.name}
            </label>
          ))}
          <button type="submit">Continue</button>
        </form>
      </section>
    );
  }

  const error = link.error;
  return (
    <section className="card">
      <h1>Garden HQ</h1>
      <form onSubmit={onSubmit}>
        <label>
          Minecraft username
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" disabled={link.isPending || name.trim() === ""}>
          {link.isPending ? "Linking…" : "Link"}
        </button>
      </form>
      {error instanceof ApiError ? (
        error.code === "rate_limited" ? (
          <RateLimitNotice key={link.submittedAt} retryAfter={error.retryAfter} />
        ) : (
          <p role="alert">{errorMessage(error)}</p>
        )
      ) : null}
    </section>
  );
}
```

Verify `link.submittedAt` exists on TanStack Query's mutation result in the installed version (`pnpm --filter @garden-hq/web exec tsc --noEmit`); if not, use `key={link.failureCount}` or drop the `key`. The rate-limit test regex expects "Too many requests … 30": the countdown starts at `retryAfter` (30) on first render.

Placeholders — `screens/HomeScreen.tsx`, `ContestsScreen.tsx`, `SettingsScreen.tsx` each: `export function XScreen() { return <p>X</p>; }`.

`index.css` (replace the stock file; mobile-first, tokens for light/dark):

```css
:root {
  --bg: #f6f3ea;
  --fg: #1d2a1a;
  --card: #ffffff;
  --accent: #3f7d2a;
  --muted: #667260;
  --danger: #a3341f;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141a12;
    --fg: #e9efe2;
    --card: #1f281c;
    --accent: #7ccf5c;
    --muted: #9aa893;
    --danger: #ff8a73;
  }
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.4 system-ui, sans-serif;
}
.app {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  max-width: 720px;
  margin: 0 auto;
  padding: 0 16px 64px;
}
.main {
  flex: 1;
  display: grid;
  gap: 12px;
  align-content: start;
  padding-top: 12px;
}
.card {
  background: var(--card);
  border-radius: 8px;
  padding: 12px;
}
.card h1,
.card h2 {
  margin: 0 0 8px;
  font-size: 1.1rem;
}
.error-card,
[role="alert"] {
  color: var(--danger);
}
input,
select,
button {
  font: inherit;
  min-height: 44px;
  padding: 0 12px;
}
label {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}
.radio-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.footer {
  color: var(--muted);
  font-size: 0.8rem;
  padding: 16px 0;
}
.tab-bar {
  position: fixed;
  inset: auto 0 0 0;
  display: flex;
  background: var(--card);
  border-top: 1px solid var(--muted);
}
.tab-bar a {
  flex: 1;
  text-align: center;
  padding: 14px 0;
  color: var(--fg);
  text-decoration: none;
}
.tab-bar a.active {
  color: var(--accent);
  font-weight: 600;
}
.hud {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.map-wrap {
  display: grid;
  justify-items: center;
}
.map-wrap canvas {
  image-rendering: pixelated;
}
.gauge {
  height: 10px;
  background: var(--bg);
  border-radius: 5px;
  overflow: hidden;
}
.gauge > span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.sheet {
  position: fixed;
  inset: auto 0 0 0;
  max-height: 70dvh;
  overflow: auto;
  background: var(--card);
  border-radius: 12px 12px 0 0;
  padding: 16px;
  box-shadow: 0 -4px 16px rgb(0 0 0 / 0.3);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
```

Delete `App.css`, the three stock assets, and any import of them; `pnpm build` must still pass.

- [ ] **Step 4: Run** `pnpm --filter @garden-hq/web exec vitest run && pnpm typecheck && pnpm lint && pnpm --filter @garden-hq/web build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): app shell, routing, footer and link screen"
```

---

### Task 11: Home screen panels (HUD, composter, visitors, sync bar)

**Files:**
- Create: `apps/web/src/components/{Hud,ComposterPanel,VisitorsPanel,SyncBar}.tsx`, `apps/web/src/components/Hud.test.tsx`
- Modify: `apps/web/src/screens/HomeScreen.tsx`

**Interfaces:**
- Consumes: view-models (Task 9), queries (Task 8), `useNow`, `Countdown`, `ErrorCard`, `getCrop`.
- Produces: `<Hud assignedCropIds: string[] />`, `<ComposterPanel composter: ComposterState />`, `<VisitorsPanel visitors: {id,name}[] />`, `<SyncBar fetchedAt: string | undefined; isFetching; isStale; rateLimitedUntil: number | null; onRefresh />`. **`HomeScreen` itself must not call `useNow`.**

- [ ] **Step 1: Failing test** `Hud.test.tsx` (mock the queries module so no network):

```tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKYBLOCK_EPOCH_MS } from "@garden-hq/core";
import { renderWithProviders } from "../test/renderWithProviders";
import { Hud } from "./Hud";

const contests = vi.fn();
const mayor = vi.fn();
vi.mock("../state/queries", () => ({
  useContests: () => contests(),
  useMayor: () => mayor(),
}));

describe("Hud", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(SKYBLOCK_EPOCH_MS);
    contests.mockReset();
    mayor.mockReset();
  });

  it("shows date, season, next contest crops and the mayor", () => {
    contests.mockReturnValue({
      data: {
        contests: [{ startsAt: SKYBLOCK_EPOCH_MS + 600_000, crops: ["wheat", "carrot", "potato"] }],
        source: { name: "EliteBot", url: "https://x" },
        fetchedAt: "",
      },
    });
    mayor.mockReturnValue({
      data: {
        mayor: { key: "finnegan", name: "Finnegan", perks: [], minister: null },
        fetchedAt: "",
      },
    });
    renderWithProviders(<Hud assignedCropIds={["carrot"]} />);
    expect(screen.getByText(/early spring/i)).toBeInTheDocument();
    expect(screen.getByText(/wheat/i)).toBeInTheDocument();
    expect(screen.getByText(/finnegan/i)).toBeInTheDocument();
    expect(screen.getByText(/you have a plot for this/i)).toBeInTheDocument();
  });

  it("degrades per slot when contests or mayor are unavailable", () => {
    contests.mockReturnValue({ data: undefined });
    mayor.mockReturnValue({ data: undefined });
    renderWithProviders(<Hud assignedCropIds={[]} />);
    expect(screen.getAllByText(/unavailable/i)).toHaveLength(2);
    expect(screen.getByText(/early spring/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`Hud.tsx`:

```tsx
import { getCrop } from "@garden-hq/core";
import { useContests, useMayor } from "../state/queries";
import { useNow } from "../state/useNow";
import { buildHudViewModel } from "../viewmodels/hud";
import { Countdown } from "./Countdown";

function cropNames(ids: string[]): string {
  return ids.map((id) => getCrop(id)?.name ?? id).join(", ");
}

export function Hud({ assignedCropIds }: { assignedCropIds: string[] }) {
  const now = useNow();
  const contests = useContests();
  const mayor = useMayor();

  const vm = buildHudViewModel(
    now,
    contests.data?.contests ?? null,
    mayor.data?.mayor ?? null,
    assignedCropIds,
  );

  return (
    <section className="card hud" aria-label="SkyBlock status">
      <span>
        Year {vm.date.year}, {vm.season} {vm.date.day}
      </span>
      <span>{vm.isDay ? "☀ Day" : "☾ Night"}</span>
      <span>
        {vm.nextContest.status === "unavailable" ? (
          "Contest: unavailable"
        ) : vm.nextContest.status === "none" ? (
          "Contest: none scheduled"
        ) : (
          <>
            Contest in <Countdown target={vm.nextContest.startsAt} /> —{" "}
            {cropNames(vm.nextContest.crops)}
            {vm.nextContest.matchesAssigned ? " (you have a plot for this)" : ""}
          </>
        )}
      </span>
      <span>
        {vm.mayor === null ? "Mayor: unavailable" : `Mayor: ${vm.mayor.name}`}
      </span>
    </section>
  );
}
```

The test's `getAllByText(/unavailable/i)` requires exactly the contest and mayor spans to match — the date/day spans must not contain the word.

`ComposterPanel.tsx` (subscribes to `useNow` itself — it is a countdown component, and keeps `HomeScreen` clock-free):

```tsx
import type { ComposterState } from "@garden-hq/core";
import { useNow } from "../state/useNow";
import { buildComposterViewModel } from "../viewmodels/composter";

function at(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleString();
}

function Gauge({ label, ratio, value }: { label: string; ratio: number; value: number }) {
  return (
    <div>
      <div>
        {label}: {Math.round(value).toLocaleString()}
      </div>
      <div
        className="gauge"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function ComposterPanel({ composter }: { composter: ComposterState }) {
  const now = useNow(10_000);
  const vm = buildComposterViewModel(composter, now);

  return (
    <section className="card" aria-label="Composter">
      <h2>Composter</h2>
      <Gauge label="Fuel" ratio={vm.fuelRatio} value={vm.fuel} />
      <Gauge label="Organic matter" ratio={vm.organicMatterRatio} value={vm.organicMatter} />
      <p>Compost ready: {vm.compostReady}</p>
      <p>Fuel runs out at {at(vm.fuelRunsOutAt)}</p>
      <p>Organic matter runs out at {at(vm.organicMatterRunsOutAt)}</p>
    </section>
  );
}
```

`VisitorsPanel.tsx`:

```tsx
export function VisitorsPanel({
  visitors,
}: {
  visitors: { id: string; name: string }[];
}) {
  return (
    <section className="card" aria-label="Visitors">
      <h2>Visitors ({visitors.length}/5)</h2>
      {visitors.length === 0 ? (
        <p>Nobody is waiting at the Barn.</p>
      ) : (
        <ul>
          {visitors.map((v) => (
            <li key={v.id}>{v.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`SyncBar.tsx` (uses `useNow(30_000)` for the label — a countdown-class component):

```tsx
import { useNow } from "../state/useNow";

export function SyncBar({
  fetchedAt,
  isFetching,
  isStale,
  refreshDisabledUntil,
  onRefresh,
}: {
  fetchedAt: string | undefined;
  isFetching: boolean;
  isStale: boolean;
  /** epoch ms until which refresh is disabled (rate limit), or null. */
  refreshDisabledUntil: number | null;
  onRefresh: () => void;
}) {
  const now = useNow(30_000);
  const minutes =
    fetchedAt === undefined
      ? null
      : Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 60_000));
  const limited = refreshDisabledUntil !== null && refreshDisabledUntil > now;

  return (
    <div className="card">
      <span>
        {minutes === null ? "Not synced yet" : `Last synced ${minutes} min ago`}
        {isStale ? " (stale — showing last good data)" : ""}
      </span>{" "}
      <button type="button" onClick={onRefresh} disabled={isFetching || limited}>
        {limited ? "Rate limited" : isFetching ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
```

`HomeScreen.tsx`:

```tsx
import { Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { ComposterPanel } from "../components/ComposterPanel";
import { ErrorCard } from "../components/ErrorCard";
import { Hud } from "../components/Hud";
import { SyncBar } from "../components/SyncBar";
import { VisitorsPanel } from "../components/VisitorsPanel";
import { MapSection } from "../map/MapSection";
import { useGarden } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";

export function HomeScreen() {
  const { link, assignments } = useStoredData();
  const garden = useGarden(link?.profileId ?? null);

  if (link === null) return <Navigate to="/link" replace />;

  const error = garden.error;
  const rateLimitedUntil =
    error instanceof ApiError && error.code === "rate_limited"
      ? garden.errorUpdatedAt + (error.retryAfter ?? 60) * 1000
      : null;
  const state = garden.data?.garden;
  const assignedCropIds = Object.values(assignments);

  return (
    <>
      <Hud assignedCropIds={assignedCropIds} />
      <SyncBar
        fetchedAt={garden.data?.fetchedAt}
        isFetching={garden.isFetching}
        isStale={garden.isError && state !== undefined}
        refreshDisabledUntil={rateLimitedUntil}
        onRefresh={() => void garden.refetch()}
      />
      {state === undefined ? (
        garden.isError ? (
          <ErrorCard
            title="Couldn't load your Garden"
            message={error instanceof ApiError ? error.message : "Unknown error"}
            onRetry={() => void garden.refetch()}
          />
        ) : (
          <p>Loading your Garden…</p>
        )
      ) : (
        <>
          <MapSection garden={state} assignments={assignments} />
          <ComposterPanel composter={state.composter} />
          <VisitorsPanel visitors={state.visitors} />
        </>
      )}
    </>
  );
}
```

`MapSection` is built in Task 12; until then create a stub `map/MapSection.tsx` exporting `MapSection({garden, assignments})` that returns `null`, so this task compiles on its own.

- [ ] **Step 4: Run** `pnpm --filter @garden-hq/web exec vitest run && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): home screen HUD, composter, visitors and sync bar"
```

---

### Task 12: The map (lazy Pixi scene, DOM plot list, crop-assignment sheet)

**Files:**
- Create: `apps/web/src/map/{palette.ts,MapScene.ts,MapCanvas.tsx,PlotList.tsx,AssignCropSheet.tsx}`, `apps/web/src/map/AssignCropSheet.test.tsx`
- Modify: `apps/web/src/map/MapSection.tsx` (replace the stub)

**Interfaces:**
- Consumes: `MapViewModel`/`PlotTile`/`BarnTile` (Task 9), `useUi` (Task 8), `useStorage`, `ALL_CROPS`, `getCrop`.
- Produces:
  - `class MapScene { mount(canvas: HTMLCanvasElement): Promise<void>; update(vm: MapViewModel): void; setHandlers(h: SceneHandlers): void; resize(cssWidth: number): void; destroy(): void }` — `mount` and `destroy` idempotent and safe in either order (React 19 strict-mode double mount).
  - `interface SceneHandlers { onPlotTap(plotId: string, state: PlotTile["state"]): void; onPlotHover(plotId: string | null): void }`
  - `<AssignCropSheet plotId: string; currentCropId?: string; gardenLevel: number; onPick(cropId: string | null): void; onClose(): void />` (`role="dialog"`, Escape closes).
  - `<PlotList viewModel; onSelect(plotId: string): void />`.

- [ ] **Step 1: Failing test** `AssignCropSheet.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssignCropSheet } from "./AssignCropSheet";

describe("AssignCropSheet", () => {
  it("offers the crops unlocked at the garden level and reports the pick", async () => {
    const onPick = vi.fn();
    render(
      <AssignCropSheet plotId="beginner_1" gardenLevel={2} onPick={onPick} onClose={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: /beginner_1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wheat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carrot" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Potato" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Carrot" }));
    expect(onPick).toHaveBeenCalledWith("carrot");
  });

  it("can clear the assignment and closes on Escape", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <AssignCropSheet
        plotId="beginner_1"
        currentCropId="wheat"
        gardenLevel={1}
        onPick={onPick}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onPick).toHaveBeenCalledWith(null);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
```

Also add `MapSection.test.tsx` covering the whole flow without WebGL (jsdom has none, so the scene fails to mount and the DOM list becomes the interface — this doubles as the no-WebGL fallback test):

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { normalizeGarden } from "@garden-hq/core";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import { useUi } from "../state/ui";
import { MapSection } from "./MapSection";

const garden = normalizeGarden({
  garden_experience: 0,
  unlocked_plots_ids: ["beginner_1"],
});

describe("MapSection", () => {
  it("assigns a crop through the DOM plot list and persists it", async () => {
    useUi.setState({ selectedPlotId: null, hoveredPlotId: null });
    const { storage } = renderWithProviders(
      <MapSection garden={garden} assignments={{}} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /beginner_1/i }));
    await userEvent.click(screen.getByRole("button", { name: "Wheat" }));
    expect(storage.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the compost cost of a locked plot in the list", async () => {
    renderWithProviders(<MapSection garden={garden} assignments={{}} />);
    expect(await screen.findByText(/beginner_2.*2 compost/i)).toBeInTheDocument();
    expect(screen.getByText(/expert_1.*cost unknown/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`palette.ts` (original flat colours; verify the ids against `data/crops.json` — unknown ids fall back to grey):

```ts
export const COLORS = {
  grass: 0x4c7a34,
  grassAlt: 0x558640,
  soil: 0x6b4a2b,
  lock: 0x7a7a7a,
  lockDark: 0x555555,
  barnWall: 0x9c3b2e,
  barnRoof: 0x5e2a22,
  visitor: 0xf2d21b,
  selected: 0xffffff,
} as const;

const CROP_COLORS: Record<string, number> = {
  wheat: 0xe0c040,
  carrot: 0xe87a1e,
  potato: 0xc9a66b,
  pumpkin: 0xe07b12,
  sugar_cane: 0x7bd36b,
  melon: 0x4fa83d,
  cactus: 0x2f7d3a,
  cocoa_beans: 0x6b3f1d,
  mushroom: 0xb04a4a,
  nether_wart: 0x8a1c2b,
  sunflower: 0xf2d21b,
  moonflower: 0x8d7bd6,
  wild_rose: 0xe0558f,
};

export function cropColor(cropId: string): number {
  return CROP_COLORS[cropId] ?? 0xaaaaaa;
}
```

`MapScene.ts`:

```ts
import { Application, Container, Graphics } from "pixi.js";
import { GRID_SIZE } from "@garden-hq/core";
import type { BarnTile, MapViewModel, PlotTile } from "../viewmodels/map";
import { COLORS, cropColor } from "./palette";

/** Logical pixels per tile; the whole scene is scaled by an integer factor. */
const TILE = 16;

export interface SceneHandlers {
  onPlotTap(plotId: string, state: PlotTile["state"]): void;
  onPlotHover(plotId: string | null): void;
}

const NOOP: SceneHandlers = { onPlotTap: () => {}, onPlotHover: () => {} };

export class MapScene {
  private app: Application | null = null;
  private mounting: Promise<void> | null = null;
  private destroyed = false;
  private world = new Container();
  private vm: MapViewModel | null = null;
  private handlers: SceneHandlers = NOOP;
  private scale = 1;

  mount(canvas: HTMLCanvasElement): Promise<void> {
    if (this.mounting !== null) return this.mounting;

    this.mounting = (async () => {
      const app = new Application();
      await app.init({
        canvas,
        width: GRID_SIZE * TILE,
        height: GRID_SIZE * TILE,
        antialias: false,
        roundPixels: true,
        backgroundAlpha: 0,
        resolution: 1,
        autoDensity: false,
      });
      if (this.destroyed) {
        app.destroy(false, { children: true });
        return;
      }
      this.app = app;
      app.stage.addChild(this.world);
      this.applyScale();
      if (this.vm !== null) this.draw(this.vm);
    })();

    return this.mounting;
  }

  setHandlers(handlers: SceneHandlers): void {
    this.handlers = handlers;
  }

  update(vm: MapViewModel): void {
    this.vm = vm;
    if (this.app !== null) this.draw(vm);
  }

  /** Picks the largest integer scale that fits `cssWidth`; never below 1. */
  resize(cssWidth: number): void {
    this.scale = Math.max(1, Math.floor(cssWidth / (GRID_SIZE * TILE)));
    if (this.app !== null) this.applyScale();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app !== null) {
      this.app.destroy(false, { children: true });
      this.app = null;
    }
  }

  private applyScale(): void {
    if (this.app === null) return;
    const size = GRID_SIZE * TILE * this.scale;
    this.app.renderer.resize(size, size);
    this.world.scale.set(this.scale);
  }

  private draw(vm: MapViewModel): void {
    for (const child of this.world.removeChildren()) child.destroy();
    for (const tile of vm.tiles) {
      this.world.addChild(
        tile.kind === "barn" ? this.barnGraphic(tile) : this.plotGraphic(tile),
      );
    }
  }

  private plotGraphic(tile: PlotTile): Graphics {
    const g = new Graphics();
    const x = tile.x * TILE;
    const y = tile.y * TILE;
    const checker = (tile.x + tile.y) % 2 === 0;

    g.rect(x, y, TILE, TILE).fill(checker ? COLORS.grass : COLORS.grassAlt);

    if (tile.state === "locked") {
      g.rect(x, y, TILE, TILE).fill(COLORS.lock);
      g.rect(x + 5, y + 7, 6, 5).fill(COLORS.lockDark);
      g.rect(x + 6, y + 4, 4, 3).fill(COLORS.lockDark);
    } else {
      g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill(COLORS.soil);
      if (tile.state === "assigned" && tile.cropId !== undefined) {
        const colour = cropColor(tile.cropId);
        // A 3x3 pattern of 3px "plants" — original, flat-colour glyph.
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            g.rect(x + 2 + col * 4, y + 2 + row * 4, 3, 3).fill(colour);
          }
        }
      }
    }

    g.eventMode = "static";
    g.cursor = "pointer";
    g.on("pointertap", () => {
      this.handlers.onPlotTap(tile.plotId, tile.state);
      if (tile.state === "locked") this.handlers.onPlotHover(tile.plotId);
    });
    g.on("pointerover", () => this.handlers.onPlotHover(tile.plotId));
    g.on("pointerout", () => this.handlers.onPlotHover(null));
    return g;
  }

  private barnGraphic(tile: BarnTile): Graphics {
    const g = new Graphics();
    const x = tile.x * TILE;
    const y = tile.y * TILE;
    g.rect(x, y, TILE, TILE).fill(COLORS.grass);
    g.rect(x + 1, y + 5, TILE - 2, TILE - 6).fill(COLORS.barnWall);
    g.rect(x, y + 1, TILE, 5).fill(COLORS.barnRoof);
    tile.visitors.forEach((_, i) => {
      g.rect(x + 1 + i * 3, y + TILE - 3, 2, 2).fill(COLORS.visitor);
    });
    return g;
  }
}
```

Check against the installed Pixi v8: `Application.init` options, `Graphics.rect().fill()`, `app.destroy(removeView, options)` and `Container.removeChildren()` exist as used; adjust to the installed typings if `tsc` disagrees.

`MapCanvas.tsx` — **imports `MapScene` as a type only; the runtime import is dynamic**, so Pixi stays out of the main bundle:

```tsx
import { useEffect, useRef, useState } from "react";
import type { MapScene, SceneHandlers } from "./MapScene";
import type { MapViewModel } from "../viewmodels/map";

export function MapCanvas({
  viewModel,
  handlers,
  onUnavailable,
}: {
  viewModel: MapViewModel;
  handlers: SceneHandlers;
  onUnavailable: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<MapScene | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) return;

    let cancelled = false;
    let created: MapScene | null = null;
    let observer: ResizeObserver | null = null;

    void (async () => {
      try {
        const { MapScene: Scene } = await import("./MapScene");
        if (cancelled) return;
        const next = new Scene();
        created = next;
        await next.mount(canvas);
        if (cancelled) {
          next.destroy();
          return;
        }
        next.resize(wrap.clientWidth);
        observer = new ResizeObserver(() => next.resize(wrap.clientWidth));
        observer.observe(wrap);
        setScene(next);
      } catch {
        if (!cancelled) onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      created?.destroy();
      setScene(null);
    };
  }, [onUnavailable]);

  useEffect(() => {
    scene?.setHandlers(handlers);
    scene?.update(viewModel);
  }, [scene, viewModel, handlers]);

  return (
    <div ref={wrapRef} className="map-wrap">
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
```

Callers must pass a stable `onUnavailable` and `handlers` (memoised) to avoid remounting.

`AssignCropSheet.tsx`:

```tsx
import { useEffect } from "react";
import { ALL_CROPS } from "@garden-hq/core";

export function AssignCropSheet({
  plotId,
  currentCropId,
  gardenLevel,
  onPick,
  onClose,
}: {
  plotId: string;
  currentCropId?: string;
  gardenLevel: number;
  onPick: (cropId: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Assign crop to ${plotId}`} className="sheet">
      <h2>Assign crop — {plotId}</h2>
      <div className="crop-grid">
        {ALL_CROPS.filter((crop) => crop.unlockLevel <= gardenLevel).map((crop) => (
          <button
            key={crop.id}
            type="button"
            aria-pressed={crop.id === currentCropId}
            onClick={() => onPick(crop.id)}
          >
            {crop.name}
          </button>
        ))}
      </div>
      {currentCropId !== undefined ? (
        <button type="button" onClick={() => onPick(null)}>
          Clear
        </button>
      ) : null}
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
```

Add to `index.css`: `.crop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin: 8px 0; }`.

`PlotList.tsx`:

```tsx
import type { MapViewModel, PlotTile } from "../viewmodels/map";

function describe(tile: PlotTile): string {
  if (tile.state === "locked") {
    return tile.lockedCost === null
      ? "locked — cost unknown"
      : `locked — ${tile.lockedCost} Compost`;
  }
  return tile.state === "assigned" ? `crop: ${tile.cropId}` : "unlocked — no crop";
}

export function PlotList({
  viewModel,
  onSelect,
}: {
  viewModel: MapViewModel;
  onSelect: (plotId: string) => void;
}) {
  const plots = viewModel.tiles.filter((t): t is PlotTile => t.kind === "plot");
  return (
    <ul className="plot-list">
      {plots.map((tile) => (
        <li key={tile.plotId}>
          {tile.state === "locked" ? (
            <span>
              {tile.plotId} — {describe(tile)}
            </span>
          ) : (
            <button type="button" onClick={() => onSelect(tile.plotId)}>
              {tile.plotId} — {describe(tile)}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

(The tests locate unlocked plots by button name `beginner_1` and locked ones by the text `beginner_2 … 2 Compost`.)

`MapSection.tsx` (replaces the stub; no `useNow`):

```tsx
import { useCallback, useMemo, useState } from "react";
import type { GardenState } from "@garden-hq/core";
import { useStorage } from "../state/StorageProvider";
import { useUi } from "../state/ui";
import { buildMapViewModel, type PlotTile } from "../viewmodels/map";
import { AssignCropSheet } from "./AssignCropSheet";
import { MapCanvas } from "./MapCanvas";
import { PlotList } from "./PlotList";
import type { SceneHandlers } from "./MapScene";

export function MapSection({
  garden,
  assignments,
}: {
  garden: GardenState;
  assignments: Record<string, string>;
}) {
  const storage = useStorage();
  const selectedPlotId = useUi((s) => s.selectedPlotId);
  const hoveredPlotId = useUi((s) => s.hoveredPlotId);
  const selectPlot = useUi((s) => s.selectPlot);
  const hoverPlot = useUi((s) => s.hoverPlot);
  const [webglFailed, setWebglFailed] = useState(false);

  const viewModel = useMemo(
    () => buildMapViewModel(garden, assignments),
    [garden, assignments],
  );

  const handlers = useMemo<SceneHandlers>(
    () => ({
      onPlotTap: (plotId, state) => {
        if (state !== "locked") selectPlot(plotId);
      },
      onPlotHover: hoverPlot,
    }),
    [selectPlot, hoverPlot],
  );
  const onUnavailable = useCallback(() => setWebglFailed(true), []);

  const plots = viewModel.tiles.filter((t): t is PlotTile => t.kind === "plot");
  const hovered = plots.find((t) => t.plotId === hoveredPlotId);
  const selected = plots.find((t) => t.plotId === selectedPlotId);

  return (
    <section className="card" aria-label="Garden map">
      {webglFailed ? null : (
        <MapCanvas
          viewModel={viewModel}
          handlers={handlers}
          onUnavailable={onUnavailable}
        />
      )}
      {hovered !== undefined && hovered.state === "locked" ? (
        <p>
          {hovered.plotId}:{" "}
          {hovered.lockedCost === null
            ? "cost unknown"
            : `${hovered.lockedCost} Compost`}
        </p>
      ) : null}
      <details open={webglFailed}>
        <summary>Plot list</summary>
        <PlotList viewModel={viewModel} onSelect={selectPlot} />
      </details>
      {selected !== undefined ? (
        <AssignCropSheet
          plotId={selected.plotId}
          currentCropId={selected.cropId}
          gardenLevel={garden.level}
          onPick={(cropId) => {
            storage.setAssignment(selected.plotId, cropId);
            selectPlot(null);
          }}
          onClose={() => selectPlot(null)}
        />
      ) : null}
    </section>
  );
}
```

In jsdom `<details>` content is in the DOM even when closed, so the tests find the list buttons; `findBy*` also covers the async scene failure.

- [ ] **Step 4: Run** `pnpm --filter @garden-hq/web exec vitest run && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Verify lazy loading.** `pnpm --filter @garden-hq/web build`, then confirm Pixi is in its own chunk, not the entry:

```bash
cd apps/web/dist/assets && grep -l "WebGLRenderer" *.js && ls -la *.js
```

Expected: the file listed is **not** the `index-*.js` entry chunk, and a separate `MapScene-*.js`-style chunk exists. If Pixi landed in the entry chunk, find the static import of `./MapScene` (only `import type` is allowed) and fix it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): lazy PixiJS plot map with DOM fallback and crop assignment"
```

---

### Task 13: Contests and Settings screens

**Files:**
- Modify: `apps/web/src/screens/ContestsScreen.tsx`, `apps/web/src/screens/SettingsScreen.tsx`
- Create: `apps/web/src/screens/SettingsScreen.test.tsx`, `apps/web/src/screens/ContestsScreen.test.tsx`

**Interfaces:**
- Consumes: `useContests`, `useStoredData`, `useStorage`, `buildContestsViewModel`, `getCrop`, `useNow`.
- Produces: `/contests` (list, tz-aware, filtered, source credit link), `/settings` (time zone, switch profile/username, clear local data).

- [ ] **Step 1: Failing tests.** `ContestsScreen.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { ContestsScreen } from "./ContestsScreen";

const contests = vi.fn();
vi.mock("../state/queries", () => ({ useContests: () => contests() }));

const AT = Date.now() + 3_600_000;
const data = {
  contests: [
    { startsAt: AT, crops: ["wheat", "carrot", "potato"] },
    { startsAt: AT + 3_600_000, crops: ["melon", "cactus", "pumpkin"] },
  ],
  source: { name: "Strassburger", url: "https://jacobs.strassburger.dev" },
  fetchedAt: "",
};

describe("ContestsScreen", () => {
  beforeEach(() => contests.mockReset());

  it("shows all contests with a hint when no crops are assigned", () => {
    contests.mockReturnValue({ data });
    renderWithProviders(<ContestsScreen />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/assign crops to your plots/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /strassburger/i })).toHaveAttribute(
      "href",
      "https://jacobs.strassburger.dev",
    );
  });

  it("filters to assigned crops", () => {
    contests.mockReturnValue({ data });
    const storage = createGardenStorage(null);
    storage.setAssignment("beginner_1", "melon");
    renderWithProviders(<ContestsScreen />, { storage });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says so when the schedule is unavailable", () => {
    contests.mockReturnValue({ data: undefined, isError: true });
    renderWithProviders(<ContestsScreen />);
    expect(screen.getByText(/contest schedule is unavailable/i)).toBeInTheDocument();
  });
});
```

`SettingsScreen.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createGardenStorage } from "../state/storage";
import { renderWithProviders } from "../test/renderWithProviders";
import { SettingsScreen } from "./SettingsScreen";

function linkedStorage() {
  const storage = createGardenStorage(null);
  storage.setLink({
    name: "Steve",
    uuid: "u1",
    profileId: "p1",
    profiles: [
      { profileId: "p1", name: "Apple", selected: true },
      { profileId: "p2", name: "Banana", selected: false },
    ],
  });
  return storage;
}

describe("SettingsScreen", () => {
  it("changes the time zone", async () => {
    const storage = linkedStorage();
    renderWithProviders(<SettingsScreen />, { storage });
    await userEvent.selectOptions(screen.getByLabelText(/time zone/i), "UTC");
    expect(storage.getSnapshot().timeZone).toBe("UTC");
  });

  it("switches profile", async () => {
    const storage = linkedStorage();
    renderWithProviders(<SettingsScreen />, { storage });
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), "p2");
    expect(storage.getSnapshot().link?.profileId).toBe("p2");
  });

  it("clears local data", async () => {
    const storage = linkedStorage();
    storage.setAssignment("beginner_1", "wheat");
    renderWithProviders(<SettingsScreen />, { storage });
    await userEvent.click(screen.getByRole("button", { name: /clear local data/i }));
    expect(storage.getSnapshot().link).toBeNull();
    expect(storage.getSnapshot().assignments).toEqual({});
  });
});
```

(The tz `<select>` must contain an option with value `UTC` — see implementation.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `ContestsScreen.tsx`:

```tsx
import { getCrop } from "@garden-hq/core";
import { useContests } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";
import { buildContestsViewModel } from "../viewmodels/contests";

export function ContestsScreen() {
  const now = useNow(60_000);
  const { assignments, timeZone } = useStoredData();
  const contests = useContests();

  if (contests.data === undefined) {
    return (
      <p>
        {contests.isError
          ? "The contest schedule is unavailable right now."
          : "Loading contests…"}
      </p>
    );
  }

  const vm = buildContestsViewModel(
    contests.data.contests,
    Object.values(assignments),
    now,
    timeZone,
  );
  const { source } = contests.data;

  return (
    <section className="card">
      <h1>Jacob&apos;s Contests</h1>
      {vm.filtered ? (
        <p>Showing contests that include your assigned crops.</p>
      ) : (
        <p>Assign crops to your plots on the map to filter this list.</p>
      )}
      <ul>
        {vm.rows.map((row) => (
          <li key={row.startsAt}>
            {row.label} ({timeZone}) —{" "}
            {row.crops.map((id) => getCrop(id)?.name ?? id).join(", ")}
          </li>
        ))}
      </ul>
      <p>
        Source:{" "}
        <a href={source.url} target="_blank" rel="noreferrer">
          {source.name}
        </a>
      </p>
    </section>
  );
}
```

(The `<p>Source:` paragraph is not a `listitem`, so the list-item counts in the tests hold; the tab-bar is not rendered in these tests since `Layout` is not.)

`SettingsScreen.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import { useStorage, useStoredData } from "../state/StorageProvider";

function timeZones(current: string): string[] {
  const zones = new Set<string>(["UTC", "Europe/Warsaw", current]);
  try {
    for (const zone of Intl.supportedValuesOf("timeZone")) zones.add(zone);
  } catch {
    // Older engines: keep the short list.
  }
  return [...zones].sort();
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const storage = useStorage();
  const { link, timeZone } = useStoredData();

  return (
    <section className="card">
      <h1>Settings</h1>

      <label>
        Time zone
        <select value={timeZone} onChange={(e) => storage.setTimeZone(e.target.value)}>
          {timeZones(timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>

      {link !== null ? (
        <>
          <p>Linked as {link.name}</p>
          {link.profiles.length > 1 ? (
            <label>
              Profile
              <select
                value={link.profileId}
                onChange={(e) => storage.setLink({ ...link, profileId: e.target.value })}
              >
                {link.profiles.map((p) => (
                  <option key={p.profileId} value={p.profileId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" onClick={() => navigate("/link")}>
            Switch username
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => {
          storage.clearAll();
          navigate("/link");
        }}
      >
        Clear local data
      </button>
    </section>
  );
}
```

`SettingsScreen` must not import anything from `../map/` (it must not pay for Pixi); `/link` and `/settings` stay Pixi-free because only `MapCanvas`'s dynamic import references it.

- [ ] **Step 4: Run** `pnpm --filter @garden-hq/web exec vitest run && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): contests and settings screens"
```

---

### Task 14: Deploy gap — Worker URL, `VITE_API_URL`, `WEB_ORIGIN` (HARD STOP)

CI deploys web to Pages but never sets `VITE_API_URL`, and the Worker URL is not in the repo. `apps/worker/wrangler.toml` already carries a **guessed** `WEB_ORIGIN = "https://garden-hq-web.pages.dev"`; treat it as unconfirmed.

**Files:**
- Modify: `apps/worker/README.md`, `apps/worker/wrangler.toml` (only if the Pages URL differs), `.github/workflows/ci.yml`

- [ ] **Step 1: STOP and ask the user.** Do not guess, invent, or derive any URL. Tell the user: "Phase 2b code is done. I need two things to close the deploy gap: (a) run the first manual `pnpm --filter @garden-hq/worker exec wrangler deploy` and give me the workers.dev URL it prints; (b) confirm the Cloudflare Pages URL for project `garden-hq-web` (I have `https://garden-hq-web.pages.dev` in `wrangler.toml` but never verified it)." Wait for the answers before continuing. Local development works against `wrangler dev` in the meantime.

- [ ] **Step 2: Record the Worker URL.** In `apps/worker/README.md` add under the title:

```md
## Deployed URL

Production API: `<WORKER_URL_FROM_USER>` (workers.dev). Set as the GitHub repo variable `VITE_API_URL` (see below).
```

- [ ] **Step 3: Set the repo variable** (user's account; ask them to run it, or run it only if they say to):

```bash
gh variable set VITE_API_URL --body "<WORKER_URL_FROM_USER>"
```

No trailing slash.

- [ ] **Step 4: Use it in both CI web builds.** In `.github/workflows/ci.yml`, give the `build` job's `Build` step and the `deploy` job's `Build web` step the variable:

```yaml
      - name: Build
        run: pnpm build
        env:
          VITE_API_URL: ${{ vars.VITE_API_URL }}
```

```yaml
      - name: Build web
        run: pnpm --filter @garden-hq/web build
        env:
          VITE_API_URL: ${{ vars.VITE_API_URL }}
```

- [ ] **Step 5: `WEB_ORIGIN`.** Set `WEB_ORIGIN` in `apps/worker/wrangler.toml` `[vars]` to the **confirmed Pages URL** (origin only, no path or trailing slash). If the confirmed URL equals the existing value, leave the file untouched and say so.

- [ ] **Step 6: Verify and commit.** `pnpm typecheck && pnpm lint && pnpm test`, then:

```bash
git add apps/worker/README.md apps/worker/wrangler.toml .github/workflows/ci.yml
git commit -m "ci: wire VITE_API_URL and record Worker URL"
```

Then tell the user to re-run `wrangler deploy` (if `WEB_ORIGIN` changed) and push to `main`.

---

### Task 15: Exit verification

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm format` — all green (run `pnpm format:write` and commit if Prettier complains).
- [ ] **Step 2: Real-browser smoke test** (use the `run` skill). Start `pnpm --filter @garden-hq/worker dev` and `pnpm --filter @garden-hq/web dev`. With no Hypixel key `/api/link` returns `missing_api_key`, so seed state manually: in the browser console set `localStorage["garden-hq:v1"]` to a link JSON, and — because `/api/garden` also needs the key — either supply a dev key in `apps/worker/.dev.vars` or stop here and report that the Home map could only be verified against fixtures. Check at **380 px** and desktop widths:
  - `/link` and `/settings`: Network tab shows **no** Pixi chunk request.
  - `/`: map renders crisp (integer scale), grid fits at 380 px with no horizontal scroll, tapping an unlocked plot opens the sheet, locked plot tap shows its cost, composter and visitors render, HUD ticks.
  - Footer text "Not affiliated with Hypixel or Mojang." appears on every screen.
  - React DevTools profiler (or a temporary `console.count` in `MapSection`) shows the map does **not** re-render on the 1 s tick.
- [ ] **Step 3: `data/VERIFY.md` check** contains: plot number → API id mapping (Task 1), visitor key format (Task 3), composter capacity (Task 4); the old "grid x/y" and "month names" entries are gone.
- [ ] **Step 4:** Report honestly what was and wasn't verified (no real Hypixel key ⇒ fixtures only), then use superpowers:finishing-a-development-branch.

---

## Self-Review

**Spec coverage**
- Your 5 approved changes: (1) plot layout → Task 1 (x/y into data, `grid` block, tests, one VERIFY entry; `placeholderPlotGrid` does not exist in the repo so there is nothing to drop — flagged in the task); (2) `seasonOf` → Task 2, including removing the now-contradicted VERIFY comment/bullet; (3) visitors prettified id + VERIFY entry → Task 3; (4) `useNow` only in HUD/countdown components (Hud, Countdown, ComposterPanel, SyncBar, ContestsScreen, link rate-limit notice — none of them are `HomeScreen`/`MapSection`) + lazy Pixi with a bundle check → Tasks 8, 11, 12; (5) deploy gap with a hard stop → Task 14.
- Spec sections: API client (6), queries (8), storage (7), view-models (9), screens (10-13), map incl. integer scale, no-WebGL fallback, strict-mode safety (12), error handling per panel (Hud slots, ErrorCard + stale badge, rate-limit disable) (10-11), footer + inline credits (10), testing (every task), exit criteria (15).

**Deliberate deviations from the spec (please confirm or veto)**
1. `buildMapViewModel(garden, assignments)` has no `now` parameter (unused; would break `noUnusedParameters` and contradict "the map doesn't tick").
2. `GardenStorage` exposes `getSnapshot()/subscribe()` plus mutators instead of `getLink/getAssignments/getTimeZone` — needed for `useSyncExternalStore`; same data, one snapshot read.
3. Composter gauge denominator is the fully-upgraded cap from `data/composter.json` (the real per-player cap is unknown; VERIFY entry added).
4. Added small core pieces the spec implied but didn't list: `crops.ts` (`ALL_CROPS`/`getCrop`), `api.ts` envelope types (so web never redeclares them), `composterCapacity()`, and `GRID_SIZE`/`BARN_CELL` from `plots.json`.
5. Long-press on locked plots is implemented as tap-to-show (pointer events), with hover on desktop.

**Known risks the executor should watch**
- Pixi v8 and TanStack Query exact typings (`mutation.submittedAt`, `Application.init` options) are written from memory; Task 10/12 say to adapt to the installed typings rather than the plan's code.
- Crop ids in `palette.ts` are checked against `data/crops.json` only for the first three (`wheat`, `carrot`, `potato`); others fall back to grey if mismatched.
- Fixtures are reconstructed, not captured; real-account verification stays blocked on a Hypixel key.
