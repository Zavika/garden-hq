# Phase 2a — Worker API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only Hono Worker API (`/api/link`, `/api/garden`, `/api/contests`, `/api/mayor`) with input validation, per-IP rate limiting, short server-side caching, CORS, and key-safe logging — fully fixture-driven, no Hypixel key needed to build or test.

**Architecture:** Pure normalizers (`normalizeProfiles`, `normalizeContests`, `normalizeMayor`, `unwrapGardenResponse`) go in `packages/core` (no fetch). The Worker owns all I/O: an injectable-`fetch` Hypixel client, a Mojang lookup, a contests service with fallback, KV-backed `cached()` and a KV/binding rate limiter, and thin Hono route modules assembled by a `createApp(deps)` factory so tests inject a fake `fetch`, clock and sleep.

**Tech Stack:** TypeScript strict, Hono 4 (`hono/cors`), Cloudflare Workers + KV (+ optional rate-limit binding), Vitest (plain Node env, `app.request(path, init, env)`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-2a-worker-api-design.md` (approved with changes). Parent: `CLAUDE.md` §3, §4, §9.

## Global Constraints

- TypeScript strict; **no `any` in `packages/core`** (ESLint-enforced). Prefer `unknown` + narrowing in the Worker too.
- Every `core` function gets a vitest test; **no live network calls in any test** — all upstream traffic goes through the injected fake `fetch`.
- Every upstream field is optional; normalizers never throw on missing/malformed data (CLAUDE.md §9).
- Game/upstream facts that are unconfirmed get a `// VERIFY:` comment **and** an entry in `data/VERIFY.md` (Task 10).
- **The API key** (`HYPIXEL_API_KEY`) is sent only as the `API-Key` request header. It must never appear in a URL, a log line, an error message, or a response body.
- Per-IP limit: **10 req/min**, shared bucket across `/api/link` + `/api/garden`, keyed on `CF-Connecting-IP`. Per-uuid/profile cache: **60 s**. Contests cache: **15 min**. Mayor cache: **1 h**.
- Validation: `name` must match `^[A-Za-z0-9_]{1,16}$`; `profile` must be a UUID (32 hex digits, or canonical 8-4-4-4-12). Failure → `bad_request` (400).
- CORS: only `WEB_ORIGIN`, plus `http://localhost:5173` when `ENVIRONMENT=dev`. `GET`/`OPTIONS` only, no credentials.
- Browser/edge responses to `/api/link` and `/api/garden` carry `Cache-Control: no-store`. Only our own normalized output is cached, server-side, in KV.
- Code style: Prettier defaults as in the repo (double quotes, semicolons, trailing commas). Run `pnpm exec prettier --write <files>` before each commit.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass as a second `-m`).
- Run tests per package with `pnpm --filter @garden-hq/core exec vitest run <file>` / `pnpm --filter @garden-hq/worker exec vitest run <file>`.

## File Structure

```
packages/core/
├─ fixtures/
│  ├─ mojang-profile.sample.json        (Task 1)
│  ├─ profiles-response.sample.json     (Task 1)
│  ├─ election-response.sample.json     (Task 2)
│  ├─ contests-elitebot.sample.json     (Task 2)
│  └─ contests-strassburger.sample.json (Task 2)
└─ src/
   ├─ coerce.ts / coerce.test.ts        (Task 1)  asRecord/asString/asNumber/asArray
   ├─ profiles.ts / profiles.test.ts    (Task 1)  normalizeProfiles
   ├─ garden.ts (+ unwrapGardenResponse) / garden.test.ts   (Task 1)
   ├─ mayor.ts / mayor.test.ts          (Task 2)  normalizeMayor
   ├─ contests.ts / contests.test.ts    (Task 2)  normalizeContests
   ├─ types.ts (+ Profile/Contest/Mayor types)   (Tasks 1-2)
   └─ index.ts (re-export all modules)  (Task 1)

apps/worker/
├─ test/helpers.ts                      (Task 3)  FakeKV, routedFetch, makeClock, makeEnv, makeHarness
├─ wrangler.toml, .dev.vars.example     (Task 10)
└─ src/
   ├─ env.ts                            (Task 3)
   ├─ errors.ts / errors.test.ts        (Task 3)
   ├─ validate.ts / validate.test.ts    (Task 3)
   ├─ log.ts / log.test.ts              (Task 3)
   ├─ cache.ts / cache.test.ts          (Task 4)
   ├─ ratelimit.ts / ratelimit.test.ts  (Task 4)
   ├─ hypixel.ts / hypixel.test.ts      (Task 5)
   ├─ mojang.ts / mojang.test.ts        (Task 5)
   ├─ contests.ts / contests.test.ts    (Task 6)
   ├─ cors.ts                           (Task 7)
   ├─ app.ts / app.test.ts              (Task 7)  createApp, CORS, onError, /health
   ├─ routes/link.ts + link.test.ts     (Task 8)
   ├─ routes/garden.ts + garden.test.ts (Task 8)
   ├─ routes/contests.ts + contests.test.ts (Task 9)
   ├─ routes/mayor.ts + mayor.test.ts   (Task 9)
   └─ index.ts                          (Task 7)  `export default createApp()`
```

## Response shapes (contract for Phase 2b)

- `GET /api/link?name=` → `{ uuid, name, profileId, profiles: { profileId, name, selected }[], fetchedAt }`
- `GET /api/garden?profile=` → `{ garden: GardenState, fetchedAt }`
- `GET /api/contests` → `{ contests: { startsAt: number /*ms*/, crops: string[] /*crop ids*/ }[], source: { name, url }, fetchedAt }`
- `GET /api/mayor` → `{ mayor: Mayor | null, fetchedAt }`
- Errors → `{ error: { code, message, retryAfter? } }`; `rate_limited` also sets a `Retry-After` header.
- `fetchedAt` is ISO-8601; on a cache hit it is the time of the original upstream fetch.

---

### Task 1: Core — `coerce`, `normalizeProfiles`, `unwrapGardenResponse`, index exports

**Files:**
- Create: `packages/core/src/coerce.ts`, `packages/core/src/coerce.test.ts`
- Create: `packages/core/src/profiles.ts`, `packages/core/src/profiles.test.ts`
- Create: `packages/core/fixtures/profiles-response.sample.json`, `packages/core/fixtures/mojang-profile.sample.json`
- Modify: `packages/core/src/types.ts`, `packages/core/src/garden.ts`, `packages/core/src/garden.test.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Produces (`coerce.ts`): `asRecord(v: unknown): Record<string, unknown>`, `asString(v: unknown, fallback?: string): string`, `asNumber(v: unknown, fallback?: number): number`, `asArray(v: unknown): unknown[]`.
- Produces (`types.ts`): `ProfileSummary { profileId: string; name: string; selected: boolean }`, `ProfilesResult { profiles: ProfileSummary[]; selectedProfileId: string | null }`.
- Produces (`profiles.ts`): `normalizeProfiles(raw: unknown): ProfilesResult` — selected profile, else the first profile, else `null`.
- Produces (`garden.ts`): `unwrapGardenResponse(raw: unknown): unknown` — returns the inner garden object, or `null` if absent/`success:false`.
- Produces (`index.ts`): re-exports every core module so the Worker can `import { normalizeGarden, ... } from "@garden-hq/core"`.

- [ ] **Step 1: Write the fixtures**

`packages/core/fixtures/profiles-response.sample.json`:

```json
{
  "success": true,
  "profiles": [
    {
      "profile_id": "22222222-2222-2222-2222-222222222222",
      "cute_name": "Apple",
      "selected": false,
      "members": {}
    },
    {
      "profile_id": "33333333-3333-3333-3333-333333333333",
      "cute_name": "Banana",
      "selected": true,
      "members": {}
    }
  ]
}
```

`packages/core/fixtures/mojang-profile.sample.json`:

```json
{
  "id": "11111111111111111111111111111111",
  "name": "TestFarmer"
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/src/coerce.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { asArray, asNumber, asRecord, asString } from "./coerce";

describe("coerce helpers", () => {
  it("asRecord returns objects and {} for everything else", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toEqual({});
    expect(asRecord([1, 2])).toEqual({});
    expect(asRecord("x")).toEqual({});
  });

  it("asString returns strings, else the fallback", () => {
    expect(asString("hi")).toBe("hi");
    expect(asString(5)).toBe("");
    expect(asString(undefined, "none")).toBe("none");
  });

  it("asNumber returns finite numbers, else the fallback", () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber(Number.NaN)).toBe(0);
    expect(asNumber("3", 9)).toBe(9);
  });

  it("asArray returns arrays, else []", () => {
    expect(asArray([1])).toEqual([1]);
    expect(asArray({})).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });
});
```

`packages/core/src/profiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import profilesResponse from "../fixtures/profiles-response.sample.json";
import { normalizeProfiles } from "./profiles";

describe("normalizeProfiles", () => {
  it("lists profiles and picks the selected one", () => {
    expect(normalizeProfiles(profilesResponse)).toEqual({
      profiles: [
        {
          profileId: "22222222-2222-2222-2222-222222222222",
          name: "Apple",
          selected: false,
        },
        {
          profileId: "33333333-3333-3333-3333-333333333333",
          name: "Banana",
          selected: true,
        },
      ],
      selectedProfileId: "33333333-3333-3333-3333-333333333333",
    });
  });

  it("falls back to the first profile when none is flagged selected", () => {
    const result = normalizeProfiles({
      profiles: [{ profile_id: "aaa", cute_name: "One" }, { profile_id: "bbb" }],
    });
    expect(result.selectedProfileId).toBe("aaa");
    expect(result.profiles[1]).toEqual({
      profileId: "bbb",
      name: "",
      selected: false,
    });
  });

  it("skips entries without a profile_id", () => {
    const result = normalizeProfiles({
      profiles: [{ cute_name: "NoId" }, "junk", null, { profile_id: "ccc" }],
    });
    expect(result.profiles.map((p) => p.profileId)).toEqual(["ccc"]);
  });

  it("returns an empty result for null / missing / malformed input", () => {
    const empty = { profiles: [], selectedProfileId: null };
    expect(normalizeProfiles(null)).toEqual(empty);
    expect(normalizeProfiles({ success: true, profiles: null })).toEqual(empty);
    expect(normalizeProfiles("nope")).toEqual(empty);
  });
});
```

Append to `packages/core/src/garden.test.ts` (and add `unwrapGardenResponse` to its existing import from `./garden`):

```ts
describe("unwrapGardenResponse", () => {
  it("unwraps a nested { garden } response", () => {
    expect(unwrapGardenResponse({ success: true, garden: { a: 1 } })).toEqual({
      a: 1,
    });
  });

  it("returns a flat response (the fixture shape) unchanged", () => {
    expect(unwrapGardenResponse(sampleResponse)).toBe(sampleResponse);
  });

  it("returns null for garden:null, success:false, null and non-objects", () => {
    expect(unwrapGardenResponse({ success: true, garden: null })).toBeNull();
    expect(unwrapGardenResponse({ success: false, cause: "x" })).toBeNull();
    expect(unwrapGardenResponse(null)).toBeNull();
    expect(unwrapGardenResponse("nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/core exec vitest run`
Expected: FAIL — `./coerce`, `./profiles` not found; `unwrapGardenResponse` is not exported.

- [ ] **Step 4: Implement**

`packages/core/src/coerce.ts`:

```ts
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
```

Append to `packages/core/src/types.ts`:

```ts
export interface ProfileSummary {
  profileId: string;
  name: string;
  selected: boolean;
}

export interface ProfilesResult {
  profiles: ProfileSummary[];
  selectedProfileId: string | null;
}
```

`packages/core/src/profiles.ts`:

```ts
import { asArray, asRecord, asString } from "./coerce";
import type { ProfileSummary, ProfilesResult } from "./types";

// VERIFY: field names (`profiles[].profile_id`, `cute_name`, `selected`) come from
// public docs / a reconstructed spec, not a captured /v2/skyblock/profiles response.
export function normalizeProfiles(raw: unknown): ProfilesResult {
  const profiles: ProfileSummary[] = [];

  for (const entry of asArray(asRecord(raw).profiles)) {
    const data = asRecord(entry);
    const profileId = asString(data.profile_id);
    if (profileId === "") continue;

    profiles.push({
      profileId,
      name: asString(data.cute_name),
      selected: data.selected === true,
    });
  }

  const selected = profiles.find((profile) => profile.selected) ?? profiles[0];

  return { profiles, selectedProfileId: selected?.profileId ?? null };
}
```

Append to `packages/core/src/garden.ts`:

```ts
// VERIFY: the live /v2/skyblock/garden response nests the garden under `garden`;
// the Phase 1 fixture is flat. Accept both until a real response is captured.
export function unwrapGardenResponse(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return null;

  const data = raw as Record<string, unknown>;
  if ("garden" in data) {
    return typeof data.garden === "object" ? data.garden : null;
  }

  return data.success === false ? null : raw;
}
```

Replace `packages/core/src/index.ts`:

```ts
export function pingCore(): string {
  return "garden-hq core is alive";
}

export * from "./types";
export * from "./calendar";
export * from "./composter";
export * from "./garden";
export * from "./plots";
export * from "./profiles";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @garden-hq/core exec vitest run && pnpm --filter @garden-hq/core typecheck`
Expected: all PASS. If `export *` reports a duplicate-name conflict, rename the *new* symbol, not the Phase 1 one.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/core
git add packages/core
git commit -m "feat(core): add profiles normalizer, garden unwrap and core index exports" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core — `normalizeMayor` and `normalizeContests`

**Files:**
- Create: `packages/core/src/mayor.ts`, `packages/core/src/mayor.test.ts`
- Create: `packages/core/src/contests.ts`, `packages/core/src/contests.test.ts`
- Create: `packages/core/fixtures/election-response.sample.json`, `contests-elitebot.sample.json`, `contests-strassburger.sample.json`
- Modify: `packages/core/src/types.ts`, `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `asArray/asNumber/asRecord/asString` (Task 1), `data/crops.json` (`{ id, name }[]`).
- Produces (`types.ts`): `MayorPerk { name: string; description: string }`, `Mayor { key: string; name: string; perks: MayorPerk[]; minister: { key: string; name: string; perk: MayorPerk | null } | null }`, `Contest { startsAt: number /* ms */; crops: string[] /* crop ids */ }`.
- Produces: `normalizeMayor(raw: unknown): Mayor | null`; `normalizeContests(raw: unknown): Contest[]` (ascending by `startsAt`).

- [ ] **Step 1: Write the fixtures**

`packages/core/fixtures/election-response.sample.json` (perk text is placeholder fixture text, not game data):

```json
{
  "success": true,
  "mayor": {
    "key": "finnegan",
    "name": "Finnegan",
    "perks": [
      { "name": "Farming Simulator", "description": "Fixture text." },
      { "name": "Pelt-pocalypse", "description": "Fixture text." }
    ],
    "minister": {
      "key": "jerry",
      "name": "Jerry",
      "perk": { "name": "Fixture Perk", "description": "Fixture text." }
    }
  }
}
```

`packages/core/fixtures/contests-elitebot.sample.json`:

```json
{
  "contests": [
    { "timestamp": 1790812800, "crops": ["Wheat", "Cactus", "Pumpkin"] },
    { "timestamp": 1790819300, "crops": ["Cocoa Beans", "Sugar Cane", "Nether Wart"] }
  ]
}
```

`packages/core/fixtures/contests-strassburger.sample.json` (deliberately a different shape — a map keyed by timestamp):

```json
{
  "contests": {
    "1790819300": ["Cocoa Beans", "Sugar Cane", "Nether Wart"],
    "1790812800": ["Wheat", "Cactus", "Pumpkin"]
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/src/mayor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import electionResponse from "../fixtures/election-response.sample.json";
import { normalizeMayor } from "./mayor";

describe("normalizeMayor", () => {
  it("normalizes mayor, perks and minister", () => {
    expect(normalizeMayor(electionResponse)).toEqual({
      key: "finnegan",
      name: "Finnegan",
      perks: [
        { name: "Farming Simulator", description: "Fixture text." },
        { name: "Pelt-pocalypse", description: "Fixture text." },
      ],
      minister: {
        key: "jerry",
        name: "Jerry",
        perk: { name: "Fixture Perk", description: "Fixture text." },
      },
    });
  });

  it("handles a mayor with no minister and drops nameless perks", () => {
    expect(
      normalizeMayor({
        mayor: { key: "x", name: "X", perks: [{ description: "no name" }, "junk"] },
      }),
    ).toEqual({ key: "x", name: "X", perks: [], minister: null });
  });

  it("returns null when there is no mayor name", () => {
    expect(normalizeMayor(null)).toBeNull();
    expect(normalizeMayor({ mayor: {} })).toBeNull();
    expect(normalizeMayor({ mayor: { key: "x" } })).toBeNull();
  });
});
```

`packages/core/src/contests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import elitebot from "../fixtures/contests-elitebot.sample.json";
import strassburger from "../fixtures/contests-strassburger.sample.json";
import { normalizeContests } from "./contests";

const EXPECTED = [
  { startsAt: 1790812800000, crops: ["wheat", "cactus", "pumpkin"] },
  { startsAt: 1790819300000, crops: ["cocoa_beans", "sugar_cane", "nether_wart"] },
];

describe("normalizeContests", () => {
  it("normalizes the array shape (EliteBot) to ms + crop ids", () => {
    expect(normalizeContests(elitebot)).toEqual(EXPECTED);
  });

  it("normalizes the map-by-timestamp shape (Strassburger), sorted ascending", () => {
    expect(normalizeContests(strassburger)).toEqual(EXPECTED);
  });

  it("leaves millisecond timestamps alone", () => {
    expect(
      normalizeContests({ contests: [{ timestamp: 1790812800000, crops: ["Wheat"] }] }),
    ).toEqual([{ startsAt: 1790812800000, crops: ["wheat"] }]);
  });

  it("drops unknown crop names and contests with no recognised crops", () => {
    expect(
      normalizeContests({
        contests: [
          { timestamp: 1790812800, crops: ["Wheat", "Dirt"] },
          { timestamp: 1790819300, crops: ["Dirt"] },
        ],
      }),
    ).toEqual([{ startsAt: 1790812800000, crops: ["wheat"] }]);
  });

  it("returns [] for malformed input and skips bad timestamps", () => {
    expect(normalizeContests(null)).toEqual([]);
    expect(normalizeContests({ contests: "x" })).toEqual([]);
    expect(normalizeContests({ contests: { nope: ["Wheat"] } })).toEqual([]);
    expect(normalizeContests({ contests: [{ crops: ["Wheat"] }] })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/core exec vitest run src/mayor.test.ts src/contests.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

Append to `packages/core/src/types.ts`:

```ts
export interface MayorPerk {
  name: string;
  description: string;
}

export interface Mayor {
  key: string;
  name: string;
  perks: MayorPerk[];
  minister: { key: string; name: string; perk: MayorPerk | null } | null;
}

export interface Contest {
  /** Contest start, epoch milliseconds. */
  startsAt: number;
  /** Crop ids from data/crops.json. */
  crops: string[];
}
```

`packages/core/src/mayor.ts`:

```ts
import { asArray, asRecord, asString } from "./coerce";
import type { Mayor, MayorPerk } from "./types";

function normalizePerk(raw: unknown): MayorPerk | null {
  const data = asRecord(raw);
  const name = asString(data.name);
  if (name === "") return null;
  return { name, description: asString(data.description) };
}

// VERIFY: shape of /v2/resources/skyblock/election (`mayor.key|name|perks[]`,
// `mayor.minister.{key,name,perk}`) is from public docs, not a captured response.
export function normalizeMayor(raw: unknown): Mayor | null {
  const mayor = asRecord(asRecord(raw).mayor);
  const name = asString(mayor.name);
  if (name === "") return null;

  const minister = asRecord(mayor.minister);
  const ministerName = asString(minister.name);

  return {
    key: asString(mayor.key),
    name,
    perks: asArray(mayor.perks)
      .map(normalizePerk)
      .filter((perk): perk is MayorPerk => perk !== null),
    minister:
      ministerName === ""
        ? null
        : {
            key: asString(minister.key),
            name: ministerName,
            perk: normalizePerk(minister.perk),
          },
  };
}
```

`packages/core/src/contests.ts`:

```ts
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

function rawEntries(contests: unknown): { timestamp: number; crops: unknown }[] {
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
```

Append to `packages/core/src/index.ts`:

```ts
export * from "./mayor";
export * from "./contests";
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @garden-hq/core exec vitest run && pnpm --filter @garden-hq/core typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/core
git add packages/core
git commit -m "feat(core): add mayor and contests normalizers with fixtures" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Worker foundation — `env`, `errors`, `validate`, `log`, test helpers

**Files:**
- Create: `apps/worker/src/env.ts`, `errors.ts` + `errors.test.ts`, `validate.ts` + `validate.test.ts`, `log.ts` + `log.test.ts`
- Create: `apps/worker/test/helpers.ts`
- Modify: `apps/worker/tsconfig.json` (include `test`)

**Interfaces:**
- Produces (`env.ts`): `RateLimiterBinding { limit(options: { key: string }): Promise<{ success: boolean }> }`; `Env { HYPIXEL_API_KEY?: string; CACHE: KVNamespace; WEB_ORIGIN?: string; ENVIRONMENT?: string; RATE_LIMITER?: RateLimiterBinding }`.
- Produces (`errors.ts`): `ErrorCode` = `"unknown_player" | "no_garden" | "bad_request" | "rate_limited" | "upstream_down" | "missing_api_key" | "internal"`; `class AppError extends Error { code: ErrorCode; retryAfter?: number; get status(): 400 | 404 | 429 | 500 | 502 }` with constructor `(code: ErrorCode, message: string, retryAfter?: number)`; `errorBody(err: AppError): { error: { code: ErrorCode; message: string; retryAfter?: number } }`.
- Produces (`validate.ts`): `parseName(value: string | undefined): string`, `parseUuid(value: string | undefined): string` (canonical lowercase dashed), `toDashedUuid(value: string): string | null` — `parse*` throw `AppError("bad_request", …)`.
- Produces (`log.ts`): `redact(text: string, secret: string | undefined): string`; `logUpstream(entry: { host: string; path: string; status: number | "error"; ms: number }): void` (console.log JSON line); `logError(event: string, detail?: Record<string, string | number>): void` (console.error JSON line).
- Produces (`test/helpers.ts`): see Step 5 — used by every later Worker test.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError, errorBody, type ErrorCode } from "./errors";

describe("AppError", () => {
  const cases: [ErrorCode, number][] = [
    ["bad_request", 400],
    ["unknown_player", 404],
    ["no_garden", 404],
    ["rate_limited", 429],
    ["missing_api_key", 500],
    ["internal", 500],
    ["upstream_down", 502],
  ];

  it.each(cases)("maps %s to HTTP %i", (code, status) => {
    expect(new AppError(code, "msg").status).toBe(status);
  });

  it("builds the uniform error body, including retryAfter when set", () => {
    expect(errorBody(new AppError("bad_request", "nope"))).toEqual({
      error: { code: "bad_request", message: "nope" },
    });
    expect(errorBody(new AppError("rate_limited", "slow down", 12))).toEqual({
      error: { code: "rate_limited", message: "slow down", retryAfter: 12 },
    });
  });
});
```

`apps/worker/src/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { parseName, parseUuid, toDashedUuid } from "./validate";

const DASHED = "11111111-2222-3333-4444-555555555555";

describe("parseName", () => {
  it("accepts valid Minecraft names", () => {
    expect(parseName("Test_Farmer1")).toBe("Test_Farmer1");
    expect(parseName("a")).toBe("a");
    expect(parseName("a".repeat(16))).toHaveLength(16);
  });

  it.each([undefined, "", "a".repeat(17), "bad name", "bad-name", "bad.name", "名前"])(
    "rejects %j with bad_request",
    (value) => {
      expect(() => parseName(value)).toThrowError(AppError);
      try {
        parseName(value);
      } catch (err) {
        expect((err as AppError).code).toBe("bad_request");
      }
    },
  );
});

describe("parseUuid / toDashedUuid", () => {
  it("accepts dashed and undashed UUIDs and returns canonical dashed lowercase", () => {
    expect(parseUuid(DASHED)).toBe(DASHED);
    expect(parseUuid("11111111222233334444555555555555".toUpperCase())).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it.each([undefined, "", "not-a-uuid", "1111111-2222-3333-4444-555555555555", `${DASHED}0`, "zzzzzzzz-2222-3333-4444-555555555555", "11111111-22223333-4444-555555555555"])(
    "rejects %j with bad_request",
    (value) => {
      expect(() => parseUuid(value)).toThrowError(AppError);
    },
  );

  it("toDashedUuid returns null instead of throwing", () => {
    expect(toDashedUuid("11111111222233334444555555555555")).toBe(DASHED);
    expect(toDashedUuid("nope")).toBeNull();
  });
});
```

`apps/worker/src/log.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logUpstream, redact } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("replaces every occurrence of the secret", () => {
    expect(redact("a SECRET b SECRET", "SECRET")).toBe("a [redacted] b [redacted]");
  });

  it("leaves text alone when there is no secret", () => {
    expect(redact("hello", undefined)).toBe("hello");
    expect(redact("hello", "")).toBe("hello");
  });
});

describe("logging", () => {
  it("logUpstream writes one JSON line with host, path template, status, ms", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logUpstream({ host: "api.hypixel.net", path: "/v2/skyblock/garden", status: 200, ms: 12 });
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({
      event: "upstream",
      host: "api.hypixel.net",
      path: "/v2/skyblock/garden",
      status: 200,
      ms: 12,
    });
  });

  it("logError writes a JSON line to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("unhandled", { name: "Error" });
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({
      event: "unhandled",
      name: "Error",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/errors.test.ts src/validate.test.ts src/log.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/worker/src/env.ts`:

```ts
export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Secret — set with `wrangler secret put HYPIXEL_API_KEY`. */
  HYPIXEL_API_KEY?: string;
  CACHE: KVNamespace;
  /** The deployed web app origin allowed by CORS. */
  WEB_ORIGIN?: string;
  /** "dev" enables the localhost CORS origin. */
  ENVIRONMENT?: string;
  /** Cloudflare rate-limit binding; the KV counter is used when absent. */
  RATE_LIMITER?: RateLimiterBinding;
}
```

`apps/worker/src/errors.ts`:

```ts
export type ErrorCode =
  | "unknown_player"
  | "no_garden"
  | "bad_request"
  | "rate_limited"
  | "upstream_down"
  | "missing_api_key"
  | "internal";

type ErrorStatus = 400 | 404 | 429 | 500 | 502;

const STATUS: Record<ErrorCode, ErrorStatus> = {
  bad_request: 400,
  unknown_player: 404,
  no_garden: 404,
  rate_limited: 429,
  missing_api_key: 500,
  internal: 500,
  upstream_down: 502,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter: number | undefined;

  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryAfter = retryAfter;
  }

  get status(): ErrorStatus {
    return STATUS[this.code];
  }
}

export function errorBody(err: AppError): {
  error: { code: ErrorCode; message: string; retryAfter?: number };
} {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
    },
  };
}
```

`apps/worker/src/validate.ts`:

```ts
import { AppError } from "./errors";

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const PLAIN_UUID_RE = /^[0-9a-f]{32}$/i;
const DASHED_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseName(value: string | undefined): string {
  if (value === undefined || !NAME_RE.test(value)) {
    throw new AppError(
      "bad_request",
      "name must be 1-16 characters: letters, digits or underscore",
    );
  }
  return value;
}

/** Canonical lowercase dashed form, or null if `value` is not a UUID. */
export function toDashedUuid(value: string): string | null {
  if (DASHED_UUID_RE.test(value)) return value.toLowerCase();
  if (!PLAIN_UUID_RE.test(value)) return null;

  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseUuid(value: string | undefined): string {
  const uuid = value === undefined ? null : toDashedUuid(value);
  if (uuid === null) {
    throw new AppError("bad_request", "profile must be a valid UUID");
  }
  return uuid;
}
```

`apps/worker/src/log.ts`:

```ts
/** Replace every occurrence of `secret` in `text`. */
export function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret === "") return text;
  return text.split(secret).join("[redacted]");
}

/**
 * `path` must be a path *template* (e.g. "/users/profiles/minecraft/:name"),
 * never a full URL — and never anything containing the API key.
 */
export function logUpstream(entry: {
  host: string;
  path: string;
  status: number | "error";
  ms: number;
}): void {
  console.log(JSON.stringify({ event: "upstream", ...entry }));
}

export function logError(
  event: string,
  detail: Record<string, string | number> = {},
): void {
  console.error(JSON.stringify({ event, ...detail }));
}
```

Edit `apps/worker/tsconfig.json` — change `"include": ["src"]` to `"include": ["src", "test"]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/errors.test.ts src/validate.test.ts src/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the shared test helpers**

`apps/worker/test/helpers.ts` (imports `createApp` from Task 7 — it will not typecheck until then; Tasks 4–6 tests do not import it, and Task 7 makes it green):

```ts
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import contestsElitebot from "../../../packages/core/fixtures/contests-elitebot.sample.json";
import contestsStrassburger from "../../../packages/core/fixtures/contests-strassburger.sample.json";
import electionResponse from "../../../packages/core/fixtures/election-response.sample.json";
import gardenResponse from "../../../packages/core/fixtures/garden-response.sample.json";
import mojangProfile from "../../../packages/core/fixtures/mojang-profile.sample.json";
import profilesResponse from "../../../packages/core/fixtures/profiles-response.sample.json";

export const TEST_KEY = "test-hypixel-key-123";
export const START_TIME = Date.UTC(2026, 9, 1, 12, 0, 0);
export const START_ISO = "2026-10-01T12:00:00.000Z";

export const fixtures = {
  contestsElitebot,
  contestsStrassburger,
  electionResponse,
  gardenResponse,
  mojangProfile,
  profilesResponse,
};

// Keys are `${host}${pathname}` (no query string).
export const MOJANG_ROUTE = "api.mojang.com/users/profiles/minecraft/TestFarmer";
export const PROFILES_ROUTE = "api.hypixel.net/v2/skyblock/profiles";
export const GARDEN_ROUTE = "api.hypixel.net/v2/skyblock/garden";
export const ELECTION_ROUTE = "api.hypixel.net/v2/resources/skyblock/election";
export const ELITEBOT_ROUTE = "api.elitebot.dev/contests/at/now";
export const STRASSBURGER_ROUTE = "jacobs.strassburger.dev/api/jacobcontests";

/** In-memory KV. Expiry is NOT simulated — code under test checks ages itself. */
export class FakeKV {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    HYPIXEL_API_KEY: TEST_KEY,
    CACHE: new FakeKV() as unknown as KVNamespace,
    WEB_ORIGIN: "https://app.example",
    ...overrides,
  };
}

export function makeClock(start = START_TIME): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

export function makeSleep(): {
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export interface FakeRequest {
  url: URL;
  headers: Headers;
}

export type FakeHandler = (req: FakeRequest) => Response | Promise<Response>;

/** Routes keyed by `${host}${pathname}`. Unmatched requests reject (a network error). */
export function routedFetch(routes: Record<string, FakeHandler>): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const key = `${url.host}${url.pathname}`;
    calls.push(key);

    const handler = routes[key];
    if (handler === undefined) throw new Error(`unexpected fetch: ${key}`);
    return handler({ url, headers: new Headers(init?.headers) });
  }) as typeof fetch;

  return { fetch: fakeFetch, calls };
}

/** Happy-path routes for every upstream, overridable per test. */
export function happyRoutes(
  overrides: Record<string, FakeHandler> = {},
): Record<string, FakeHandler> {
  return {
    [MOJANG_ROUTE]: () => json(fixtures.mojangProfile),
    [PROFILES_ROUTE]: () => json(fixtures.profilesResponse),
    [GARDEN_ROUTE]: () => json({ success: true, garden: fixtures.gardenResponse }),
    [ELECTION_ROUTE]: () => json(fixtures.electionResponse),
    [ELITEBOT_ROUTE]: () => json(fixtures.contestsElitebot),
    ...overrides,
  };
}

export function makeHarness(
  routes: Record<string, FakeHandler> = happyRoutes(),
  envOverrides: Partial<Env> = {},
) {
  const clock = makeClock();
  const { sleep, sleeps } = makeSleep();
  const net = routedFetch(routes);
  const app = createApp({ fetch: net.fetch, now: clock.now, sleep });
  const env = makeEnv(envOverrides);

  return {
    app,
    env,
    clock,
    net,
    sleeps,
    get: (path: string, headers: Record<string, string> = {}) =>
      app.request(path, { headers }, env),
  };
}
```

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add env, errors, validation, logging and test helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Worker — KV `cached()` and the rate limiter

**Files:**
- Create: `apps/worker/src/cache.ts`, `cache.test.ts`, `ratelimit.ts`, `ratelimit.test.ts`

**Interfaces:**
- Consumes: `Env`, `RateLimiterBinding` (`env.ts`), `AppError` (`errors.ts`), `logError` (`log.ts`), `FakeKV`/`makeClock` (`test/helpers.ts` — import only these; do not import `makeHarness` here).
- Produces (`cache.ts`): `cached<T>(kv: KVNamespace, key: string, ttlSeconds: number, now: () => number, produce: () => Promise<T>): Promise<{ value: T; fetchedAt: number }>` — age is checked against `now()` (KV `expirationTtl` is only cleanup); errors from `produce` propagate and are never cached; KV read/write failures degrade to "no cache".
- Produces (`ratelimit.ts`): `Limiter { allow(key: string): Promise<{ ok: boolean; retryAfter: number }> }`; `createKvLimiter(kv, now, limit?, windowMs?)` (defaults 10 / 60 000); `createBindingLimiter(binding)`; `pickLimiter(env, now)`; `enforceRateLimit(env: Env, ip: string | undefined, now: () => number): Promise<void>` — throws `AppError("rate_limited", …, retryAfter)`; IP falls back to `"unknown"`.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/cache.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { FakeKV, makeClock } from "../test/helpers";
import { cached } from "./cache";

function setup() {
  const kv = new FakeKV();
  const clock = makeClock(1_000_000);
  return { kv: kv as unknown as KVNamespace, fake: kv, clock };
}

describe("cached", () => {
  it("produces on a miss and stores the value with fetchedAt", async () => {
    const { kv, clock } = setup();
    const produce = vi.fn(async () => ({ n: 1 }));

    const result = await cached(kv, "k", 60, clock.now, produce);

    expect(result).toEqual({ value: { n: 1 }, fetchedAt: 1_000_000 });
    expect(produce).toHaveBeenCalledOnce();
  });

  it("serves a fresh entry without calling produce, keeping the original fetchedAt", async () => {
    const { kv, clock } = setup();
    const produce = vi.fn(async () => "v");

    await cached(kv, "k", 60, clock.now, produce);
    clock.advance(59_000);
    const second = await cached(kv, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledOnce();
    expect(second.fetchedAt).toBe(1_000_000);
  });

  it("re-produces once the entry is older than the TTL", async () => {
    const { kv, clock } = setup();
    const produce = vi.fn(async () => "v");

    await cached(kv, "k", 60, clock.now, produce);
    clock.advance(60_000);
    const second = await cached(kv, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(second.fetchedAt).toBe(1_060_000);
  });

  it("never caches a failure", async () => {
    const { kv, fake, clock } = setup();

    await expect(
      cached(kv, "k", 60, clock.now, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(fake.store.size).toBe(0);
  });

  it("falls back to producing when KV reads or writes fail", async () => {
    const clock = makeClock();
    const broken = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {
        throw new Error("kv down");
      },
    } as unknown as KVNamespace;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await cached(broken, "k", 60, clock.now, async () => 7);

    expect(result.value).toBe(7);
  });

  it("ignores a corrupt cache entry", async () => {
    const { kv, fake, clock } = setup();
    fake.store.set("k", "{not json");

    const result = await cached(kv, "k", 60, clock.now, async () => "fresh");

    expect(result.value).toBe("fresh");
  });
});
```

`apps/worker/src/ratelimit.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { FakeKV, makeClock, makeEnv } from "../test/helpers";
import { AppError } from "./errors";
import {
  createBindingLimiter,
  createKvLimiter,
  enforceRateLimit,
  pickLimiter,
} from "./ratelimit";

describe("createKvLimiter", () => {
  it("allows 10 requests per window and denies the 11th with a retryAfter", async () => {
    const clock = makeClock(120_000 + 15_000); // 15 s into a 60 s window
    const limiter = createKvLimiter(new FakeKV() as unknown as KVNamespace, clock.now);

    for (let i = 0; i < 10; i++) {
      expect((await limiter.allow("1.1.1.1")).ok).toBe(true);
    }
    expect(await limiter.allow("1.1.1.1")).toEqual({ ok: false, retryAfter: 45 });
  });

  it("tracks keys independently and resets in the next window", async () => {
    const clock = makeClock(0);
    const limiter = createKvLimiter(new FakeKV() as unknown as KVNamespace, clock.now, 1);

    expect((await limiter.allow("a")).ok).toBe(true);
    expect((await limiter.allow("a")).ok).toBe(false);
    expect((await limiter.allow("b")).ok).toBe(true);

    clock.advance(60_000);
    expect((await limiter.allow("a")).ok).toBe(true);
  });
});

describe("createBindingLimiter", () => {
  it("maps the binding result to allow()", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limiter = createBindingLimiter({ limit });

    expect(await limiter.allow("k")).toEqual({ ok: false, retryAfter: 60 });
    expect(limit).toHaveBeenCalledWith({ key: "k" });
  });
});

describe("pickLimiter / enforceRateLimit", () => {
  it("prefers the binding when present", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = makeEnv({ RATE_LIMITER: { limit } });

    await enforceRateLimit(env, "9.9.9.9", makeClock().now);

    expect(limit).toHaveBeenCalledWith({ key: "9.9.9.9" });
  });

  it("uses the KV counter otherwise and throws rate_limited when exceeded", async () => {
    const env = makeEnv();
    const clock = makeClock();
    const limiter = pickLimiter(env, clock.now);
    expect(typeof limiter.allow).toBe("function");

    for (let i = 0; i < 10; i++) await enforceRateLimit(env, "2.2.2.2", clock.now);

    const err = await enforceRateLimit(env, "2.2.2.2", clock.now).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("rate_limited");
    expect((err as AppError).retryAfter).toBeGreaterThan(0);
  });

  it("buckets a missing IP under 'unknown'", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = makeEnv({ RATE_LIMITER: { limit } });

    await enforceRateLimit(env, undefined, makeClock().now);

    expect(limit).toHaveBeenCalledWith({ key: "unknown" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/cache.test.ts src/ratelimit.test.ts`
Expected: FAIL — modules not found. (`test/helpers.ts` imports `../src/app`, which does not exist yet — if the import error is about `app`, temporarily create `apps/worker/src/app.ts` containing `export function createApp(): never { throw new Error("replaced in Task 7"); }`; Task 7 overwrites it.)

- [ ] **Step 3: Implement**

`apps/worker/src/cache.ts`:

```ts
import { logError } from "./log";

interface Entry<T> {
  fetchedAt: number;
  value: T;
}

// KV rejects expirationTtl below 60 s.
const MIN_KV_TTL_SECONDS = 60;

function isEntry<T>(value: unknown): value is Entry<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fetchedAt?: unknown }).fetchedAt === "number" &&
    "value" in value
  );
}

/**
 * Server-side cache of our own normalized output. Freshness is judged from the
 * stored `fetchedAt` (not KV expiry), so it is testable with a fake clock.
 * Failures from `produce` are never cached; KV outages degrade to no caching.
 */
export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  now: () => number,
  produce: () => Promise<T>,
): Promise<{ value: T; fetchedAt: number }> {
  try {
    const raw = await kv.get(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isEntry<T>(parsed) && now() - parsed.fetchedAt < ttlSeconds * 1000) {
        return { value: parsed.value, fetchedAt: parsed.fetchedAt };
      }
    }
  } catch {
    // Unreadable or corrupt entry: treat as a miss.
  }

  const value = await produce();
  const fetchedAt = now();

  try {
    await kv.put(key, JSON.stringify({ fetchedAt, value }), {
      expirationTtl: Math.max(MIN_KV_TTL_SECONDS, ttlSeconds),
    });
  } catch {
    logError("cache_write_failed");
  }

  return { value, fetchedAt };
}
```

`apps/worker/src/ratelimit.ts`:

```ts
import type { Env, RateLimiterBinding } from "./env";
import { AppError } from "./errors";

export interface Limiter {
  allow(key: string): Promise<{ ok: boolean; retryAfter: number }>;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Fixed-window KV counter. Approximate under concurrency (read-modify-write is
 * not atomic) — acceptable for abuse protection.
 */
export function createKvLimiter(
  kv: KVNamespace,
  now: () => number,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): Limiter {
  return {
    async allow(key) {
      const time = now();
      const window = Math.floor(time / windowMs);
      const kvKey = `rl:${key}:${window}`;

      const count = Number.parseInt((await kv.get(kvKey)) ?? "0", 10) || 0;
      if (count >= limit) {
        return {
          ok: false,
          retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - time) / 1000)),
        };
      }

      // expirationTtl must be >= 60 s; two windows is plenty for cleanup.
      await kv.put(kvKey, String(count + 1), {
        expirationTtl: Math.max(60, Math.ceil((windowMs * 2) / 1000)),
      });
      return { ok: true, retryAfter: 0 };
    },
  };
}

/** Wraps the Cloudflare rate-limit binding (configured for a 60 s period). */
export function createBindingLimiter(binding: RateLimiterBinding): Limiter {
  return {
    async allow(key) {
      const { success } = await binding.limit({ key });
      return { ok: success, retryAfter: success ? 0 : 60 };
    },
  };
}

export function pickLimiter(env: Env, now: () => number): Limiter {
  return env.RATE_LIMITER !== undefined
    ? createBindingLimiter(env.RATE_LIMITER)
    : createKvLimiter(env.CACHE, now);
}

export async function enforceRateLimit(
  env: Env,
  ip: string | undefined,
  now: () => number,
): Promise<void> {
  const result = await pickLimiter(env, now).allow(ip ?? "unknown");
  if (!result.ok) {
    throw new AppError(
      "rate_limited",
      "Too many requests — slow down and retry shortly",
      result.retryAfter,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/cache.test.ts src/ratelimit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add KV cache helper and per-IP rate limiter" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Worker — Hypixel client and Mojang lookup

**Files:**
- Create: `apps/worker/src/hypixel.ts`, `hypixel.test.ts`, `mojang.ts`, `mojang.test.ts`

**Interfaces:**
- Consumes: `AppError`, `logUpstream`, `toDashedUuid`, `routedFetch`/`json`/`makeClock`/`makeSleep`/`TEST_KEY` (`test/helpers.ts`), `Env`.
- Produces (`hypixel.ts`):
  - `RateLimitState { remaining: number; resetAt: number }`, `createRateLimitState(): RateLimitState`
  - `HypixelDeps { fetch: typeof fetch; apiKey: string | undefined; now: () => number; sleep: (ms: number) => Promise<void>; state: RateLimitState }`
  - `HypixelClient { profiles(uuid: string): Promise<unknown>; garden(profileId: string): Promise<unknown>; election(): Promise<unknown> }` — a `404` resolves to `null`.
  - `createHypixelClient(deps: HypixelDeps): HypixelClient`
  - `type ClientFactory = (env: Env) => HypixelClient`
- Produces (`mojang.ts`): `lookupUuid(fetchFn: typeof fetch, name: string): Promise<{ uuid: string /* dashed */; name: string }>`.

Behaviour contract for `hypixel.ts` (tests below pin each line):
`profiles`/`garden` need the key (`missing_api_key` before any fetch); `election` sends no key. Before the first attempt, if the last response said `RateLimit-Remaining` ≤ 0 and `RateLimit-Reset` hasn't elapsed → `rate_limited` without fetching. Up to 3 attempts. `429`: wait `Retry-After` seconds (else `250·2^attempt` ms); if the wait exceeds 5 000 ms or it is the last attempt → `rate_limited` with `retryAfter` seconds. `5xx` / network error: backoff `250·2^attempt` ms then retry; after the last attempt → `upstream_down`. `404` → `null`. Any other non-2xx (incl. `403`) → `upstream_down` with no retry. Invalid JSON → `upstream_down`. Error messages are constant strings; they never include upstream bodies, URLs or the key.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/hypixel.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEST_KEY,
  json,
  makeClock,
  makeSleep,
  routedFetch,
  type FakeHandler,
} from "../test/helpers";
import { AppError } from "./errors";
import { createHypixelClient, createRateLimitState } from "./hypixel";

afterEach(() => vi.restoreAllMocks());

const GARDEN = "api.hypixel.net/v2/skyblock/garden";

function setup(handler: FakeHandler, apiKey: string | undefined = TEST_KEY) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const clock = makeClock();
  const { sleep, sleeps } = makeSleep();
  const net = routedFetch({ [GARDEN]: handler });
  const client = createHypixelClient({
    fetch: net.fetch,
    apiKey,
    now: clock.now,
    sleep,
    state: createRateLimitState(),
  });
  return { client, net, clock, sleeps };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("createHypixelClient", () => {
  it("sends the key in the API-Key header and returns the parsed body", async () => {
    let seen: string | null = null;
    const { client } = setup(({ headers, url }) => {
      seen = headers.get("API-Key");
      expect(url.searchParams.get("profile")).toBe("p1");
      expect(url.toString()).not.toContain(TEST_KEY);
      return json({ success: true });
    });

    expect(await client.garden("p1")).toEqual({ success: true });
    expect(seen).toBe(TEST_KEY);
  });

  it("throws missing_api_key without fetching when there is no key", async () => {
    const { client, net } = setup(() => json({}), undefined);

    expect((await failure(client.garden("p1"))).code).toBe("missing_api_key");
    expect((await failure(client.profiles("u1"))).code).toBe("missing_api_key");
    expect(net.calls).toEqual([]);
  });

  it("calls election without any key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let seen: string | null = "unset";
    const net = routedFetch({
      "api.hypixel.net/v2/resources/skyblock/election": ({ headers }) => {
        seen = headers.get("API-Key");
        return json({ success: true });
      },
    });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: undefined,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    expect(await client.election()).toEqual({ success: true });
    expect(seen).toBeNull();
  });

  it("returns null on 404", async () => {
    const { client } = setup(() => new Response("nope", { status: 404 }));
    expect(await client.garden("p1")).toBeNull();
  });

  it("retries a 429 after Retry-After seconds, then succeeds", async () => {
    let n = 0;
    const { client, sleeps } = setup(() =>
      n++ === 0
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : json({ ok: true }),
    );

    expect(await client.garden("p1")).toEqual({ ok: true });
    expect(sleeps).toEqual([2000]);
  });

  it("gives up on a persistent 429 with rate_limited + retryAfter (3 attempts)", async () => {
    const { client, net, sleeps } = setup(
      () => new Response("", { status: 429, headers: { "Retry-After": "1" } }),
    );

    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(1);
    expect(net.calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("does not wait when Retry-After exceeds the 5 s cap", async () => {
    const { client, net, sleeps } = setup(
      () => new Response("", { status: 429, headers: { "Retry-After": "30" } }),
    );

    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(30);
    expect(net.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("backs off 250 ms then 500 ms on 5xx and recovers", async () => {
    let n = 0;
    const { client, sleeps } = setup(() =>
      n++ < 2 ? new Response("", { status: 503 }) : json({ ok: true }),
    );

    expect(await client.garden("p1")).toEqual({ ok: true });
    expect(sleeps).toEqual([250, 500]);
  });

  it("maps a persistent 5xx to upstream_down", async () => {
    const { client, net } = setup(() => new Response("", { status: 500 }));

    expect((await failure(client.garden("p1"))).code).toBe("upstream_down");
    expect(net.calls).toHaveLength(3);
  });

  it("maps 403 to upstream_down with no retry", async () => {
    const { client, net } = setup(() => new Response("", { status: 403 }));

    expect((await failure(client.garden("p1"))).code).toBe("upstream_down");
    expect(net.calls).toHaveLength(1);
  });

  it("maps invalid JSON to upstream_down", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));
    expect((await failure(client.garden("p1"))).code).toBe("upstream_down");
  });

  it("retries network errors and never leaks the key in the error", async () => {
    const { client, net } = setup(() => {
      throw new Error(`connect failed ${TEST_KEY}`);
    });

    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("upstream_down");
    expect(err.message).not.toContain(TEST_KEY);
    expect(net.calls).toHaveLength(3);
  });

  it("short-circuits when RateLimit-Remaining is 0 until RateLimit-Reset elapses", async () => {
    let n = 0;
    const { client, net, clock } = setup(() => {
      n++;
      return json(
        { ok: true },
        { headers: { "RateLimit-Remaining": "0", "RateLimit-Reset": "30" } },
      );
    });

    await client.garden("p1");
    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(30);
    expect(net.calls).toHaveLength(1);

    clock.advance(31_000);
    await client.garden("p1");
    expect(n).toBe(2);
  });

  it("logs host + path template + status only", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const net = routedFetch({ [GARDEN]: () => json({}) });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: TEST_KEY,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    await client.garden("p1");

    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "upstream",
      host: "api.hypixel.net",
      path: "/v2/skyblock/garden",
      status: 200,
    });
    expect(line).not.toContain(TEST_KEY);
    expect(line).not.toContain("p1");
  });
});
```

`apps/worker/src/mojang.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtures, json, routedFetch, type FakeHandler } from "../test/helpers";
import { AppError } from "./errors";
import { lookupUuid } from "./mojang";

afterEach(() => vi.restoreAllMocks());

const ROUTE = "api.mojang.com/users/profiles/minecraft/TestFarmer";

async function lookup(handler: FakeHandler) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return lookupUuid(routedFetch({ [ROUTE]: handler }).fetch, "TestFarmer");
}

async function code(handler: FakeHandler): Promise<string | undefined> {
  const err = await lookup(handler).then(
    () => undefined,
    (e: unknown) => e,
  );
  return err instanceof AppError ? err.code : undefined;
}

describe("lookupUuid", () => {
  it("returns the dashed UUID and canonical name", async () => {
    expect(await lookup(() => json(fixtures.mojangProfile))).toEqual({
      uuid: "11111111-1111-1111-1111-111111111111",
      name: "TestFarmer",
    });
  });

  it("maps 404 and 204 to unknown_player", async () => {
    expect(await code(() => new Response("", { status: 404 }))).toBe("unknown_player");
    expect(await code(() => new Response(null, { status: 204 }))).toBe("unknown_player");
  });

  it("maps 429 to rate_limited", async () => {
    expect(await code(() => new Response("", { status: 429 }))).toBe("rate_limited");
  });

  it("maps 5xx, network errors and malformed bodies to upstream_down", async () => {
    expect(await code(() => new Response("", { status: 500 }))).toBe("upstream_down");
    expect(
      await code(() => {
        throw new Error("boom");
      }),
    ).toBe("upstream_down");
    expect(await code(() => json({ id: "nope" }))).toBe("upstream_down");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/hypixel.test.ts src/mojang.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/worker/src/hypixel.ts`:

```ts
import type { Env } from "./env";
import { AppError } from "./errors";
import { logUpstream } from "./log";

const HOST = "api.hypixel.net";
const BASE = `https://${HOST}`;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 5000;
const BACKOFF_BASE_MS = 250;

/** Shared across requests in one isolate so RateLimit-* headers carry over. */
export interface RateLimitState {
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

export function createRateLimitState(): RateLimitState {
  return { remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
}

export interface HypixelDeps {
  fetch: typeof fetch;
  apiKey: string | undefined;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  state: RateLimitState;
}

export interface HypixelClient {
  profiles(uuid: string): Promise<unknown>;
  garden(profileId: string): Promise<unknown>;
  election(): Promise<unknown>;
}

export type ClientFactory = (env: Env) => HypixelClient;

const upstreamDown = () =>
  new AppError("upstream_down", "Hypixel is unavailable right now");

function backoffMs(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** attempt;
}

function headerNumber(res: Response, name: string): number | null {
  const header = res.headers.get(name);
  if (header === null) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// VERIFY: header names `RateLimit-Remaining` / `RateLimit-Reset` (seconds until
// reset) per CLAUDE.md §3; not yet checked against a live Hypixel response.
export function createHypixelClient(deps: HypixelDeps): HypixelClient {
  const { state } = deps;

  function readRateLimit(res: Response): void {
    const remaining = headerNumber(res, "RateLimit-Remaining");
    if (remaining !== null) state.remaining = remaining;

    const reset = headerNumber(res, "RateLimit-Reset");
    if (reset !== null) state.resetAt = deps.now() + reset * 1000;
  }

  /** `path` is a template with no secrets; `query` carries validated ids only. */
  async function request(path: string, query: string, auth: boolean): Promise<unknown> {
    const apiKey = deps.apiKey;
    if (auth && (apiKey === undefined || apiKey === "")) {
      throw new AppError("missing_api_key", "Server is missing its Hypixel API key");
    }

    if (state.remaining <= 0 && state.resetAt > deps.now()) {
      throw new AppError(
        "rate_limited",
        "Hypixel rate limit reached",
        Math.ceil((state.resetAt - deps.now()) / 1000),
      );
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const last = attempt === MAX_ATTEMPTS - 1;
      const started = deps.now();

      let res: Response;
      try {
        res = await deps.fetch(`${BASE}${path}${query}`, {
          headers: auth && apiKey !== undefined ? { "API-Key": apiKey } : {},
        });
      } catch {
        logUpstream({ host: HOST, path, status: "error", ms: deps.now() - started });
        if (last) throw upstreamDown();
        await deps.sleep(backoffMs(attempt));
        continue;
      }

      logUpstream({ host: HOST, path, status: res.status, ms: deps.now() - started });
      readRateLimit(res);

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw upstreamDown();
        }
      }

      if (res.status === 404) return null;

      if (res.status === 429) {
        const retryAfter = headerNumber(res, "Retry-After");
        const waitMs = retryAfter !== null ? retryAfter * 1000 : backoffMs(attempt);
        if (last || waitMs > MAX_WAIT_MS) {
          throw new AppError(
            "rate_limited",
            "Hypixel rate limit reached",
            Math.max(1, Math.ceil(waitMs / 1000)),
          );
        }
        await deps.sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        if (last) throw upstreamDown();
        await deps.sleep(backoffMs(attempt));
        continue;
      }

      throw upstreamDown();
    }

    throw upstreamDown();
  }

  return {
    profiles: (uuid) =>
      request("/v2/skyblock/profiles", `?uuid=${encodeURIComponent(uuid)}`, true),
    garden: (profileId) =>
      request("/v2/skyblock/garden", `?profile=${encodeURIComponent(profileId)}`, true),
    election: () => request("/v2/resources/skyblock/election", "", false),
  };
}
```

`apps/worker/src/mojang.ts`:

```ts
import { AppError } from "./errors";
import { logUpstream } from "./log";
import { toDashedUuid } from "./validate";

const HOST = "api.mojang.com";
const PATH = "/users/profiles/minecraft/:name";

const upstreamDown = () =>
  new AppError("upstream_down", "Mojang is unavailable right now");

/** `name` must already be validated (`parseName`). */
export async function lookupUuid(
  fetchFn: typeof fetch,
  name: string,
): Promise<{ uuid: string; name: string }> {
  const started = Date.now();

  let res: Response;
  try {
    res = await fetchFn(`https://${HOST}/users/profiles/minecraft/${encodeURIComponent(name)}`);
  } catch {
    logUpstream({ host: HOST, path: PATH, status: "error", ms: Date.now() - started });
    throw upstreamDown();
  }

  logUpstream({ host: HOST, path: PATH, status: res.status, ms: Date.now() - started });

  if (res.status === 204 || res.status === 404) {
    throw new AppError("unknown_player", "No Minecraft account with that name");
  }
  if (res.status === 429) {
    throw new AppError("rate_limited", "Mojang rate limit reached", 60);
  }
  if (!res.ok) throw upstreamDown();

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw upstreamDown();
  }

  const data = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const uuid = typeof data.id === "string" ? toDashedUuid(data.id) : null;
  if (uuid === null) throw upstreamDown();

  return { uuid, name: typeof data.name === "string" ? data.name : name };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/hypixel.test.ts src/mojang.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add Hypixel client (retry, rate-limit headers) and Mojang lookup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Worker — contests service (EliteBot → Strassburger fallback)

**Files:**
- Create: `apps/worker/src/contests.ts`, `contests.test.ts`

**Interfaces:**
- Consumes: `normalizeContests`, `Contest` (`@garden-hq/core`), `AppError`, `logUpstream`.
- Produces: `ContestsSource { name: string; url: string }`; `ContestsResult { contests: Contest[]; source: ContestsSource }`; `fetchContests(fetchFn: typeof fetch): Promise<ContestsResult>`.

Contract: try EliteBot, then Strassburger. A source "succeeds" if the HTTP status is 2xx and the body is JSON. The first source that yields **non-empty** contests wins. If a source succeeded but was empty and the other failed or was also empty, return `{ contests: [], source: <first empty-but-ok source> }`. If both fail → `upstream_down`.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/contests.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELITEBOT_ROUTE,
  STRASSBURGER_ROUTE,
  fixtures,
  json,
  routedFetch,
  type FakeHandler,
} from "../test/helpers";
import { fetchContests } from "./contests";
import { AppError } from "./errors";

afterEach(() => vi.restoreAllMocks());

const EXPECTED_FIRST = {
  startsAt: 1790812800000,
  crops: ["wheat", "cactus", "pumpkin"],
};

function run(routes: Record<string, FakeHandler>) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const net = routedFetch(routes);
  return { net, result: fetchContests(net.fetch) };
}

const down: FakeHandler = () => new Response("", { status: 500 });
const empty: FakeHandler = () => json({ contests: [] });

describe("fetchContests", () => {
  it("uses EliteBot when it works and does not call the fallback", async () => {
    const { net, result } = run({
      [ELITEBOT_ROUTE]: () => json(fixtures.contestsElitebot),
    });

    const { contests, source } = await result;

    expect(source.name).toBe("EliteBot");
    expect(contests[0]).toEqual(EXPECTED_FIRST);
    expect(net.calls).toEqual([ELITEBOT_ROUTE]);
  });

  it("falls back to Strassburger when EliteBot fails, and reports that source for the credit link", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: down,
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
    });

    const { contests, source } = await result;

    expect(source.url).toBe("https://jacobs.strassburger.dev");
    expect(contests[0]).toEqual(EXPECTED_FIRST);
  });

  it("falls back when EliteBot throws a network error", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: () => {
        throw new Error("boom");
      },
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
    });

    expect((await result).contests).toHaveLength(2);
  });

  it("prefers a non-empty fallback over an empty primary", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: empty,
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
    });

    expect((await result).source.name).not.toBe("EliteBot");
  });

  it("returns an empty list (primary source) when one source is empty and the other fails", async () => {
    const { result } = run({ [ELITEBOT_ROUTE]: empty, [STRASSBURGER_ROUTE]: down });

    expect(await result).toEqual({
      contests: [],
      source: { name: "EliteBot", url: "https://elitebot.dev" },
    });
  });

  it("throws upstream_down when both sources fail", async () => {
    const { result } = run({ [ELITEBOT_ROUTE]: down, [STRASSBURGER_ROUTE]: down });

    const err = await result.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("upstream_down");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/contests.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/worker/src/contests.ts`:

```ts
import { normalizeContests, type Contest } from "@garden-hq/core";
import { AppError } from "./errors";
import { logUpstream } from "./log";

export interface ContestsSource {
  name: string;
  url: string;
}

export interface ContestsResult {
  contests: Contest[];
  source: ContestsSource;
}

interface SourceConfig extends ContestsSource {
  host: string;
  path: string;
}

// VERIFY: endpoints per CLAUDE.md §2; response shapes are unconfirmed (see core/contests.ts).
// The Strassburger source requires a visible credit link — callers surface `source`.
const SOURCES: SourceConfig[] = [
  {
    name: "EliteBot",
    url: "https://elitebot.dev",
    host: "api.elitebot.dev",
    path: "/contests/at/now",
  },
  {
    name: "Jacob's Contests API (Strassburger)",
    url: "https://jacobs.strassburger.dev",
    host: "jacobs.strassburger.dev",
    path: "/api/jacobcontests",
  },
];

async function tryFetch(fetchFn: typeof fetch, source: SourceConfig): Promise<unknown> {
  const started = Date.now();

  let res: Response;
  try {
    res = await fetchFn(`https://${source.host}${source.path}`);
  } catch {
    logUpstream({ host: source.host, path: source.path, status: "error", ms: Date.now() - started });
    return undefined;
  }

  logUpstream({ host: source.host, path: source.path, status: res.status, ms: Date.now() - started });
  if (!res.ok) return undefined;

  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function fetchContests(fetchFn: typeof fetch): Promise<ContestsResult> {
  let firstEmpty: ContestsResult | undefined;

  for (const { name, url, host, path } of SOURCES) {
    const body = await tryFetch(fetchFn, { name, url, host, path });
    if (body === undefined) continue;

    const result: ContestsResult = { contests: normalizeContests(body), source: { name, url } };
    if (result.contests.length > 0) return result;
    firstEmpty ??= result;
  }

  if (firstEmpty !== undefined) return firstEmpty;
  throw new AppError("upstream_down", "No contest schedule source is available");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/contests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add contests service with EliteBot -> Strassburger fallback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Worker — `createApp`, CORS, error handling, `/health`

**Files:**
- Create/overwrite: `apps/worker/src/app.ts`, `apps/worker/src/cors.ts`, `apps/worker/src/app.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `Env`, `AppError`/`errorBody`, `logError`/`redact`, `createHypixelClient`/`createRateLimitState`/`ClientFactory`, `pingCore`.
- Produces (`cors.ts`): `DEV_ORIGIN = "http://localhost:5173"`; `allowedOriginFor(env: Pick<Env, "WEB_ORIGIN" | "ENVIRONMENT">): (origin: string) => string | null`.
- Produces (`app.ts`): `AppDeps { fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<void> }`; `createApp(overrides?: Partial<AppDeps>): Hono<{ Bindings: Env }>`. Routes are mounted in Tasks 8–9 via `app.route("/api", …)`; this task mounts none, so it ships `/health` + middleware only.
- Route-module convention for Tasks 8–9: `export function xRoute(deps: AppDeps, clientFor: ClientFactory): Hono<{ Bindings: Env }>` registering paths *relative to `/api`* (e.g. `route.get("/link", …)`).

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/app.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_KEY, makeEnv, makeHarness } from "../test/helpers";
import { createApp } from "./app";
import { DEV_ORIGIN } from "./cors";

afterEach(() => vi.restoreAllMocks());

describe("GET /health", () => {
  it("returns ok status and the core ping", async () => {
    const res = await createApp().request("/health", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      core: "garden-hq core is alive",
    });
  });
});

describe("CORS", () => {
  // /api/__cors-probe has no route, so these exercise middleware only.
  const probe = (origin: string, env = makeEnv()) =>
    createApp().request("/api/__cors-probe", { headers: { Origin: origin } }, env);

  it("allows the configured web origin", async () => {
    const res = await probe("https://app.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
  });

  it("does not allow other origins", async () => {
    const res = await probe("https://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows localhost only when ENVIRONMENT=dev", async () => {
    const prod = await probe(DEV_ORIGIN);
    expect(prod.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const dev = await probe(DEV_ORIGIN, makeEnv({ ENVIRONMENT: "dev" }));
    expect(dev.headers.get("Access-Control-Allow-Origin")).toBe(DEV_ORIGIN);
  });

  it("answers preflight with GET/OPTIONS only and no credentials", async () => {
    const res = await createApp().request(
      "/api/link",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      makeEnv(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET,OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not grant a disallowed origin on preflight", async () => {
    const res = await createApp().request(
      "/api/link",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      makeEnv(),
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("error handling", () => {
  it("never logs or returns the API key when an unexpected error occurs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingKv = {
      get: async () => {
        throw new Error(`kv down ${TEST_KEY}`);
      },
      put: async () => {},
    } as unknown as KVNamespace;

    const app = createApp();
    // Force an unexpected (non-AppError) throw through the app's onError.
    app.get("/api/boom", async (c) => {
      await c.env.CACHE.get("x");
      return c.text("unreachable");
    });
    const res = await app.request(
      "/api/boom",
      { headers: { Origin: "https://app.example" } },
      makeEnv({ CACHE: throwingKv }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Internal error" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");

    const everything = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
    expect(everything).toContain("[redacted]");
    expect(everything).not.toContain(TEST_KEY);
  });
});

describe("harness wiring", () => {
  it("makeHarness builds an app that serves /health", async () => {
    const { get } = makeHarness();
    expect((await get("/health")).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/app.test.ts src/index.test.ts`
Expected: FAIL — `./cors` not found / `createApp` not implemented.

- [ ] **Step 3: Implement**

`apps/worker/src/cors.ts`:

```ts
import type { Env } from "./env";

export const DEV_ORIGIN = "http://localhost:5173";

/** Origin allow-list: the web app, plus localhost only in dev. */
export function allowedOriginFor(
  env: Pick<Env, "WEB_ORIGIN" | "ENVIRONMENT">,
): (origin: string) => string | null {
  return (origin) => {
    if (env.WEB_ORIGIN !== undefined && origin === env.WEB_ORIGIN) return origin;
    if (env.ENVIRONMENT === "dev" && origin === DEV_ORIGIN) return origin;
    return null;
  };
}
```

`apps/worker/src/app.ts` (overwrites any stub from Task 4):

```ts
import { pingCore } from "@garden-hq/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { allowedOriginFor } from "./cors";
import type { Env } from "./env";
import { AppError, errorBody } from "./errors";
import { createHypixelClient, createRateLimitState, type ClientFactory } from "./hypixel";
import { logError, redact } from "./log";

export interface AppDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function createApp(overrides: Partial<AppDeps> = {}): Hono<{ Bindings: Env }> {
  const deps: AppDeps = {
    // Wrapped: a bare `fetch` reference loses its binding in Workers.
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };

  // One rate-limit state per app instance (per isolate) so RateLimit-* headers carry over.
  const hypixelState = createRateLimitState();
  const clientFor: ClientFactory = (env) =>
    createHypixelClient({
      fetch: deps.fetch,
      apiKey: env.HYPIXEL_API_KEY,
      now: deps.now,
      sleep: deps.sleep,
      state: hypixelState,
    });

  const app = new Hono<{ Bindings: Env }>();

  app.use("/api/*", (c, next) =>
    cors({
      origin: allowedOriginFor(c.env),
      allowMethods: ["GET", "OPTIONS"],
      maxAge: 600,
    })(c, next),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      core: pingCore(),
    }),
  );

  // Routes are mounted here as they are added (Tasks 8-9):
  void clientFor;

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.retryAfter !== undefined) c.header("Retry-After", String(err.retryAfter));
      c.header("Cache-Control", "no-store");
      return c.json(errorBody(err), err.status);
    }

    logError("unhandled", {
      name: err.name,
      message: redact(err.message, c.env.HYPIXEL_API_KEY),
    });
    c.header("Cache-Control", "no-store");
    return c.json(errorBody(new AppError("internal", "Internal error")), 500);
  });

  return app;
}
```

Replace `apps/worker/src/index.ts`:

```ts
import { createApp } from "./app";

export default createApp();
```

- [ ] **Step 4: Run the full Worker suite and typecheck**

Run: `pnpm --filter @garden-hq/worker exec vitest run && pnpm --filter @garden-hq/worker typecheck`
Expected: all PASS (this also turns `test/helpers.ts` green). If the `error handling` test shows the error response *lacks* `Access-Control-Allow-Origin`, the CORS middleware's header is not surviving `onError`: fix in `app.onError` by re-applying CORS headers there (compute `allowedOriginFor(c.env)(c.req.header("Origin") ?? "")` and set `Access-Control-Allow-Origin` when non-null) — do not weaken the test.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add createApp factory with CORS allow-list and error handler" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Worker — `/api/link` and `/api/garden`

**Files:**
- Create: `apps/worker/src/routes/link.ts`, `routes/link.test.ts`, `routes/garden.ts`, `routes/garden.test.ts`
- Modify: `apps/worker/src/app.ts` (mount both routes; drop the `void clientFor;` line)

**Interfaces:**
- Consumes: `AppDeps` (`app.ts`), `ClientFactory` (`hypixel.ts`), `parseName`/`parseUuid`, `enforceRateLimit`, `cached`, `lookupUuid`, `AppError`, core `normalizeProfiles`/`normalizeGarden`/`unwrapGardenResponse`, test helpers.
- Produces: `linkRoute(deps: AppDeps, clientFor: ClientFactory)`, `gardenRoute(deps: AppDeps, clientFor: ClientFactory)` — each returns `Hono<{ Bindings: Env }>`.
- Order inside each handler is fixed: **validate → rate limit → cache → upstream.** Cache keys: `link:<lowercased name>` (the uuid is unknown until Mojang answers, so `/api/link` is keyed by name — a deliberate refinement of the spec's "per-uuid"), `garden:<canonical dashed profile uuid>`; TTL 60 s.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/routes/link.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOJANG_ROUTE,
  PROFILES_ROUTE,
  START_ISO,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

function harness(routes = happyRoutes(), env = {}) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes, env);
}

describe("GET /api/link", () => {
  it("links a name to the selected profile", async () => {
    const { get } = harness();

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      uuid: "11111111-1111-1111-1111-111111111111",
      name: "TestFarmer",
      profileId: "33333333-3333-3333-3333-333333333333",
      profiles: [
        { profileId: "22222222-2222-2222-2222-222222222222", name: "Apple", selected: false },
        { profileId: "33333333-3333-3333-3333-333333333333", name: "Banana", selected: true },
      ],
      fetchedAt: START_ISO,
    });
  });

  it.each(["", "a%20b", "bad-name", "a".repeat(17)])(
    "rejects invalid name %j with bad_request and makes no upstream calls",
    async (name) => {
      const { get, net } = harness();

      const res = await get(`/api/link?name=${name}`);

      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
      expect(net.calls).toEqual([]);
    },
  );

  it("rejects a missing name parameter", async () => {
    const { get } = harness();
    expect((await get("/api/link")).status).toBe(400);
  });

  it("returns 404 unknown_player for an unknown name", async () => {
    const { get } = harness(
      happyRoutes({ [MOJANG_ROUTE]: () => new Response("", { status: 404 }) }),
    );

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unknown_player");
  });

  it("returns 404 no_garden when the player has no SkyBlock profiles", async () => {
    const { get } = harness(
      happyRoutes({ [PROFILES_ROUTE]: () => json({ success: true, profiles: null }) }),
    );

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_garden");
  });

  it("returns 500 missing_api_key when the Worker has no key", async () => {
    const { get } = harness(happyRoutes(), { HYPIXEL_API_KEY: undefined });

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("missing_api_key");
  });

  it("serves repeats within 60 s from cache (case-insensitive), then refetches", async () => {
    const { get, net, clock } = harness();

    await get("/api/link?name=TestFarmer");
    clock.advance(59_000);
    const hit = await get("/api/link?name=TestFarmer");
    expect(net.calls.filter((c) => c === MOJANG_ROUTE)).toHaveLength(1);
    expect(((await hit.json()) as { fetchedAt: string }).fetchedAt).toBe(START_ISO);

    clock.advance(2_000);
    await get("/api/link?name=TestFarmer");
    expect(net.calls.filter((c) => c === MOJANG_ROUTE)).toHaveLength(2);
  });

  it("rate-limits per IP: 10 requests ok, the 11th is 429 with Retry-After; other IPs unaffected", async () => {
    const { get } = harness();
    const ip = { "CF-Connecting-IP": "1.2.3.4" };

    for (let i = 0; i < 10; i++) {
      expect((await get("/api/link?name=TestFarmer", ip)).status).toBe(200);
    }
    const limited = await get("/api/link?name=TestFarmer", ip);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");

    expect(
      (await get("/api/link?name=TestFarmer", { "CF-Connecting-IP": "5.6.7.8" })).status,
    ).toBe(200);
  });

  it("does not spend the limiter on invalid input", async () => {
    const { get } = harness();
    const ip = { "CF-Connecting-IP": "9.9.9.9" };

    for (let i = 0; i < 15; i++) await get("/api/link?name=bad-name", ip);

    expect((await get("/api/link?name=TestFarmer", ip)).status).toBe(200);
  });
});
```

`apps/worker/src/routes/garden.test.ts`:

```ts
import { normalizeGarden } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GARDEN_ROUTE,
  START_ISO,
  fixtures,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

const PROFILE = "33333333-3333-3333-3333-333333333333";

function harness(routes = happyRoutes()) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes);
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("GET /api/garden", () => {
  it("returns the normalized GardenState with fetchedAt", async () => {
    const { get } = harness();

    const res = await get(`/api/garden?profile=${PROFILE}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      garden: normalizeGarden(fixtures.gardenResponse),
      fetchedAt: START_ISO,
    });
  });

  it("also accepts a flat (un-nested) upstream response", async () => {
    const { get } = harness(happyRoutes({ [GARDEN_ROUTE]: () => json(fixtures.gardenResponse) }));

    const res = await get(`/api/garden?profile=${PROFILE}`);

    expect(((await res.json()) as { garden: { level: number } }).garden.level).toBe(15);
  });

  it.each(["", "not-a-uuid", "3333333-3333-3333-3333-333333333333"])(
    "rejects invalid profile %j with bad_request and no upstream calls",
    async (profile) => {
      const { get, net } = harness();

      const res = await get(`/api/garden?profile=${profile}`);

      expect(res.status).toBe(400);
      expect(await code(res)).toBe("bad_request");
      expect(net.calls).toEqual([]);
    },
  );

  it("returns 404 no_garden for garden:null, a 404 upstream, and success:false", async () => {
    for (const handler of [
      () => json({ success: true, garden: null }),
      () => new Response("", { status: 404 }),
      () => json({ success: false, cause: "No garden" }),
    ]) {
      const { get } = harness(happyRoutes({ [GARDEN_ROUTE]: handler }));
      const res = await get(`/api/garden?profile=${PROFILE}`);
      expect(res.status).toBe(404);
      expect(await code(res)).toBe("no_garden");
    }
  });

  it("returns 502 upstream_down when Hypixel keeps failing", async () => {
    const { get } = harness(
      happyRoutes({ [GARDEN_ROUTE]: () => new Response("", { status: 500 }) }),
    );

    const res = await get(`/api/garden?profile=${PROFILE}`);

    expect(res.status).toBe(502);
    expect(await code(res)).toBe("upstream_down");
  });

  it("caches 60 s per profile; dashed and undashed forms share one entry", async () => {
    const { get, net, clock } = harness();

    await get(`/api/garden?profile=${PROFILE}`);
    clock.advance(30_000);
    await get(`/api/garden?profile=${PROFILE.replaceAll("-", "").toUpperCase()}`);
    expect(net.calls.filter((c) => c === GARDEN_ROUTE)).toHaveLength(1);

    clock.advance(31_000);
    await get(`/api/garden?profile=${PROFILE}`);
    expect(net.calls.filter((c) => c === GARDEN_ROUTE)).toHaveLength(2);
  });

  it("shares the per-IP bucket with /api/link", async () => {
    const { get } = harness();
    const ip = { "CF-Connecting-IP": "4.4.4.4" };

    for (let i = 0; i < 5; i++) await get("/api/link?name=TestFarmer", ip);
    for (let i = 0; i < 5; i++) await get(`/api/garden?profile=${PROFILE}`, ip);

    const limited = await get(`/api/garden?profile=${PROFILE}`, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/routes`
Expected: FAIL — all requests 404 (routes not mounted).

- [ ] **Step 3: Implement**

`apps/worker/src/routes/link.ts`:

```ts
import { normalizeProfiles } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";
import { lookupUuid } from "../mojang";
import { enforceRateLimit } from "../ratelimit";
import { parseName } from "../validate";

const CACHE_TTL_SECONDS = 60;

export function linkRoute(deps: AppDeps, clientFor: ClientFactory): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/link", async (c) => {
    const name = parseName(c.req.query("name"));
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);

    // Keyed by name: the uuid is unknown until Mojang answers.
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `link:${name.toLowerCase()}`,
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        const player = await lookupUuid(deps.fetch, name);
        const { profiles, selectedProfileId } = normalizeProfiles(
          await clientFor(c.env).profiles(player.uuid),
        );

        if (selectedProfileId === null) {
          throw new AppError("no_garden", "That player has no SkyBlock profiles");
        }

        return {
          uuid: player.uuid,
          name: player.name,
          profileId: selectedProfileId,
          profiles,
        };
      },
    );

    c.header("Cache-Control", "no-store");
    return c.json({ ...value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
```

`apps/worker/src/routes/garden.ts`:

```ts
import { normalizeGarden, unwrapGardenResponse } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";
import { enforceRateLimit } from "../ratelimit";
import { parseUuid } from "../validate";

const CACHE_TTL_SECONDS = 60;

export function gardenRoute(deps: AppDeps, clientFor: ClientFactory): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/garden", async (c) => {
    const profileId = parseUuid(c.req.query("profile"));
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);

    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `garden:${profileId}`,
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        const raw = unwrapGardenResponse(await clientFor(c.env).garden(profileId));
        if (raw === null) {
          throw new AppError("no_garden", "No Garden found for that profile");
        }
        return normalizeGarden(raw);
      },
    );

    c.header("Cache-Control", "no-store");
    return c.json({ garden: value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
```

Edit `apps/worker/src/app.ts`: add imports

```ts
import { gardenRoute } from "./routes/garden";
import { linkRoute } from "./routes/link";
```

and replace the `// Routes are mounted here …` comment + `void clientFor;` with:

```ts
  app.route("/api", linkRoute(deps, clientFor));
  app.route("/api", gardenRoute(deps, clientFor));
```

- [ ] **Step 4: Run the Worker suite and typecheck**

Run: `pnpm --filter @garden-hq/worker exec vitest run && pnpm --filter @garden-hq/worker typecheck`
Expected: all PASS. (`app.test.ts` CORS probes use an unrouted path and still pass.)

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add /api/link and /api/garden with validation, rate limit and cache" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Worker — `/api/contests` and `/api/mayor`

**Files:**
- Create: `apps/worker/src/routes/contests.ts`, `routes/contests.test.ts`, `routes/mayor.ts`, `routes/mayor.test.ts`
- Modify: `apps/worker/src/app.ts` (mount both)

**Interfaces:**
- Consumes: `fetchContests` (`contests.ts`), `cached`, `normalizeMayor`, `ClientFactory`, `AppDeps`.
- Produces: `contestsRoute(deps: AppDeps)`, `mayorRoute(deps: AppDeps, clientFor: ClientFactory)`.
- Public data: no per-IP limiter, KV-cached (contests 15 min, mayor 1 h). Responses may be edge-cached, so no `no-store` header is set; the browser Cache-Control is `public, max-age=60`.

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/routes/contests.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELITEBOT_ROUTE,
  START_ISO,
  STRASSBURGER_ROUTE,
  fixtures,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

function harness(routes = happyRoutes()) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes);
}

const down = () => new Response("", { status: 500 });

describe("GET /api/contests", () => {
  it("returns normalized contests, the credited source and fetchedAt", async () => {
    const { get } = harness();

    const res = await get("/api/contests");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      contests: [
        { startsAt: 1790812800000, crops: ["wheat", "cactus", "pumpkin"] },
        { startsAt: 1790819300000, crops: ["cocoa_beans", "sugar_cane", "nether_wart"] },
      ],
      source: { name: "EliteBot", url: "https://elitebot.dev" },
      fetchedAt: START_ISO,
    });
  });

  it("is public: works without a Hypixel key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app, env } = makeHarness(happyRoutes(), { HYPIXEL_API_KEY: undefined });
    expect((await app.request("/api/contests", {}, env)).status).toBe(200);
  });

  it("falls back to Strassburger and exposes it as the source", async () => {
    const { get } = harness(
      happyRoutes({
        [ELITEBOT_ROUTE]: down,
        [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
      }),
    );

    const body = (await (await get("/api/contests")).json()) as {
      source: { url: string };
    };

    expect(body.source.url).toBe("https://jacobs.strassburger.dev");
  });

  it("returns 502 upstream_down when every source fails", async () => {
    const { get } = harness(
      happyRoutes({ [ELITEBOT_ROUTE]: down, [STRASSBURGER_ROUTE]: down }),
    );

    const res = await get("/api/contests");

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("upstream_down");
  });

  it("caches for 15 minutes", async () => {
    const { get, net, clock } = harness();

    await get("/api/contests");
    clock.advance(14 * 60_000);
    await get("/api/contests");
    expect(net.calls.filter((c) => c === ELITEBOT_ROUTE)).toHaveLength(1);

    clock.advance(2 * 60_000);
    await get("/api/contests");
    expect(net.calls.filter((c) => c === ELITEBOT_ROUTE)).toHaveLength(2);
  });
});
```

`apps/worker/src/routes/mayor.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELECTION_ROUTE,
  START_ISO,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

function harness(routes = happyRoutes(), env = {}) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes, env);
}

describe("GET /api/mayor", () => {
  it("returns the current mayor and perks", async () => {
    const { get } = harness();

    const res = await get("/api/mayor");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mayor: { name: string; perks: unknown[]; minister: { name: string } };
      fetchedAt: string;
    };
    expect(body.mayor.name).toBe("Finnegan");
    expect(body.mayor.perks).toHaveLength(2);
    expect(body.mayor.minister.name).toBe("Jerry");
    expect(body.fetchedAt).toBe(START_ISO);
  });

  it("works without a Hypixel key (election is public)", async () => {
    const { get } = harness(happyRoutes(), { HYPIXEL_API_KEY: undefined });
    expect((await get("/api/mayor")).status).toBe(200);
  });

  it("returns mayor:null when the election payload has no mayor", async () => {
    const { get } = harness(happyRoutes({ [ELECTION_ROUTE]: () => json({ success: true }) }));

    expect(await (await get("/api/mayor")).json()).toEqual({
      mayor: null,
      fetchedAt: START_ISO,
    });
  });

  it("returns 502 upstream_down when Hypixel fails", async () => {
    const { get } = harness(
      happyRoutes({ [ELECTION_ROUTE]: () => new Response("", { status: 500 }) }),
    );

    expect((await get("/api/mayor")).status).toBe(502);
  });

  it("caches for 1 hour", async () => {
    const { get, net, clock } = harness();

    await get("/api/mayor");
    clock.advance(59 * 60_000);
    await get("/api/mayor");
    expect(net.calls.filter((c) => c === ELECTION_ROUTE)).toHaveLength(1);

    clock.advance(2 * 60_000);
    await get("/api/mayor");
    expect(net.calls.filter((c) => c === ELECTION_ROUTE)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @garden-hq/worker exec vitest run src/routes/contests.test.ts src/routes/mayor.test.ts`
Expected: FAIL — requests 404 (routes not mounted).

- [ ] **Step 3: Implement**

`apps/worker/src/routes/contests.ts`:

```ts
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import { fetchContests } from "../contests";
import type { Env } from "../env";

const CACHE_TTL_SECONDS = 15 * 60;

export function contestsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/contests", async (c) => {
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      "contests",
      CACHE_TTL_SECONDS,
      deps.now,
      () => fetchContests(deps.fetch),
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({ ...value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
```

`apps/worker/src/routes/mayor.ts`:

```ts
import { normalizeMayor } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import type { ClientFactory } from "../hypixel";

const CACHE_TTL_SECONDS = 60 * 60;

export function mayorRoute(deps: AppDeps, clientFor: ClientFactory): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/mayor", async (c) => {
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      "mayor",
      CACHE_TTL_SECONDS,
      deps.now,
      async () => normalizeMayor(await clientFor(c.env).election()),
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({ mayor: value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
```

Edit `apps/worker/src/app.ts`: add imports and mounts

```ts
import { contestsRoute } from "./routes/contests";
import { mayorRoute } from "./routes/mayor";
```
```ts
  app.route("/api", contestsRoute(deps));
  app.route("/api", mayorRoute(deps, clientFor));
```

- [ ] **Step 4: Run the full repo checks**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm format`
Expected: all green. If `pnpm format` flags files, run `pnpm format:write` and re-check.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/worker
git add apps/worker
git commit -m "feat(worker): add /api/contests and /api/mayor with KV caching" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Deploy config, secrets docs, VERIFY.md, spec touch-up, final verification

**Files:**
- Modify: `apps/worker/wrangler.toml`, `.gitignore`, `data/VERIFY.md`, `docs/superpowers/specs/2026-10-01-phase-2a-worker-api-design.md`
- Create: `apps/worker/.dev.vars.example`, `apps/worker/README.md`

**Interfaces:** none — config and docs only. Consumes the `Env` names from Task 3 (`CACHE`, `RATE_LIMITER`, `WEB_ORIGIN`, `ENVIRONMENT`, `HYPIXEL_API_KEY`).

- [ ] **Step 1: Update `apps/worker/wrangler.toml`**

```toml
name = "garden-hq-worker"
main = "src/index.ts"
compatibility_date = "2026-09-30"
compatibility_flags = ["nodejs_compat"]

[vars]
# Origin of the deployed web app (Cloudflare Pages). Change if you add a custom domain.
WEB_ORIGIN = "https://garden-hq-web.pages.dev"

# KV cache for election/contests/per-player short caches and the fallback rate limiter.
# No id: wrangler auto-provisions the namespace on first deploy.
[[kv_namespaces]]
binding = "CACHE"

# Per-IP limiter (10 requests / 60 s). If the account/plan rejects this binding,
# delete this block — the KV counter in src/ratelimit.ts is used automatically.
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"
simple = { limit = 10, period = 60 }
```

- [ ] **Step 2: Verify the config parses**

Run: `pnpm --filter @garden-hq/worker exec wrangler deploy --dry-run --outdir .wrangler/dry-run`
Expected: bundles successfully and lists the `CACHE` and `RATE_LIMITER` bindings. If wrangler rejects the `[[ratelimits]]` block or the id-less KV binding, **fix the config to what this wrangler version accepts** (consult `pnpm --filter @garden-hq/worker exec wrangler --help` / its docs): drop `[[ratelimits]]` entirely if unsupported (the KV limiter covers it), and for KV create a namespace with `wrangler kv namespace create CACHE` and use the returned id. Report which variant shipped.

- [ ] **Step 3: Local-dev secrets**

Append to `.gitignore`:

```
.dev.vars
!.dev.vars.example
```

`apps/worker/.dev.vars.example`:

```
# Copy to .dev.vars (gitignored) for `wrangler dev`.
HYPIXEL_API_KEY=your-dev-key-from-developer.hypixel.net
ENVIRONMENT=dev
```

`apps/worker/README.md`:

````markdown
# @garden-hq/worker

Hono API on Cloudflare Workers. Routes: `GET /api/link?name=`, `/api/garden?profile=`, `/api/contests`, `/api/mayor`, `/health`.

## Secrets & vars

- `HYPIXEL_API_KEY` — **secret**, never in `wrangler.toml` or the browser:
  `pnpm --filter @garden-hq/worker exec wrangler secret put HYPIXEL_API_KEY`
- `WEB_ORIGIN` (var) — the only origin allowed by CORS.
- `ENVIRONMENT=dev` (local `.dev.vars` only) — additionally allows `http://localhost:5173`.

## Local dev

`cp .dev.vars.example .dev.vars`, fill in a key, then `pnpm --filter @garden-hq/worker dev`.
Without a key `/api/contests` and `/api/mayor` still work; `/api/link` and `/api/garden` return `missing_api_key`.

## Limits

Per-IP 10 req/min (shared by link + garden); 60 s per-player cache; contests 15 min; mayor 1 h.
````

- [ ] **Step 4: Update `data/VERIFY.md`**

Append a new section:

```markdown
## Phase 2a Worker API (fixtures reconstructed, not captured)

- `packages/core/fixtures/{profiles-response,election-response,contests-elitebot,contests-strassburger,mojang-profile}.sample.json` are reconstructed from public docs/memory, not captured responses — same caveat as the garden fixture. Swap for real captures once a Hypixel key + linked account exists, and re-run the core + worker suites.
- `/v2/skyblock/garden` response nesting: live responses are believed to be `{ success, garden: {...} }`; the Phase 1 fixture is flat. `unwrapGardenResponse` accepts both.
- Profiles fields (`profiles[].profile_id`, `cute_name`, `selected`) and election fields (`mayor.key|name|perks[]`, `mayor.minister.perk`) — unconfirmed field names.
- EliteBot `/contests/at/now` and Strassburger `/api/jacobcontests`: response shapes (array vs map keyed by timestamp) and timestamp units (assumed epoch seconds) are unconfirmed; `normalizeContests` tolerates both shapes and both units. Contest *duration* is not modelled.
- Hypixel `RateLimit-Remaining` / `RateLimit-Reset` (seconds until reset) header semantics — per CLAUDE.md §3, unverified against live responses.
- Cloudflare `[[ratelimits]]` binding availability on this account/plan; the KV fixed-window counter is the (approximate under concurrency) fallback.
- Hypixel status codes for "player/profile not found" and "no garden" (assumed `404` or `success:false` / `garden:null`) are unconfirmed.
```

- [ ] **Step 5: Touch up the spec**

In `docs/superpowers/specs/2026-10-01-phase-2a-worker-api-design.md`, change "KV, 60 s per uuid" in the `/api/link` row and the "Per-uuid/profile cache" bullet so `/api/link` is described as **keyed by lowercased name** (the uuid is unknown until Mojang responds), keeping `/api/garden` keyed by profile id. Add `internal` 500 to the error list. Add one line under "Response shapes": `/api/garden` returns `{ garden, fetchedAt }`.

- [ ] **Step 6: Final verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format && pnpm build`
Expected: everything green. Also run a leak check: `git grep -n "test-hypixel-key-123"` should match only `apps/worker/test/helpers.ts`, `*.test.ts`, and this plan.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/worker data docs .gitignore
git add -A
git commit -m "chore(worker): add wrangler bindings, dev-vars docs and VERIFY entries for phase 2a" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- Routes `/api/link`, `/api/garden`, `/api/contests`, `/api/mayor`, `/health` → Tasks 8, 9, 7. ✅
- `hypixel.ts` (API-Key header, `RateLimit-*`, retry/backoff, Retry-After) → Task 5. ✅
- `mojang.ts` (204/404 → unknown_player) → Task 5. ✅
- `contests.ts` EliteBot → Strassburger fallback + credit `source` → Task 6, surfaced in Task 9. ✅
- Core normalizers `normalizeProfiles`/`normalizeContests`/`normalizeMayor` + fixtures → Tasks 1–2 (plus `unwrapGardenResponse`, needed because the live garden nesting is unconfirmed). ✅
- Abuse protection: per-IP 10/min shared bucket (binding preferred, KV fallback), 60 s per-uuid/profile cache, cache hits still counted → Tasks 4, 8 (tests assert the 11th request → 429, shared bucket, cache-hit counting via the loop of cached requests). ✅
- Input validation (`name` regex, UUID) before limiter/upstream; invalid input doesn't spend the limiter → Tasks 3, 8. ✅
- CORS (web origin + dev localhost, GET/OPTIONS, no credentials, preflight) → Task 7. ✅
- TTLs: contests 15 min, mayor 1 h → Task 9. ✅
- Logging: no key / no full URLs; test asserts no leak → Tasks 3, 5, 7. ✅
- Error model (incl. `internal`, `Retry-After`) → Tasks 3, 7. ✅
- `wrangler.toml` KV + rate-limit binding + `WEB_ORIGIN`, secret docs → Task 10. ✅
- `VERIFY.md` entries for reconstructed fixtures/unconfirmed shapes → Task 10. ✅

**Placeholder scan:** no TBD/TODO; every code step has literal code. The only conditional instructions are the explicit "if wrangler rejects X, do Y" branches in Task 10 Step 2 and the CORS-header-through-`onError` fallback in Task 7 Step 4 — both are real contingencies on external tool behaviour with a defined remedy.

**Type consistency:** `AppDeps { fetch, now, sleep }` (Task 7) is what routes consume in Tasks 8–9 and what `makeHarness` passes. `ClientFactory = (env: Env) => HypixelClient` (Task 5) matches `clientFor` in Task 7. `cached(kv, key, ttlSeconds, now, produce)` argument order is identical in Tasks 4, 8, 9. `enforceRateLimit(env, ip, now)` matches Task 4's definition in Task 8. `AppError(code, message, retryAfter?)` is used consistently. `Contest.startsAt` is ms and `crops` are crop ids in Tasks 2, 6, 9. `fetchContests(fetchFn)` returns `{ contests, source }` (Task 6) and the route spreads it into the response (Task 9).

**Known deviations from the spec (intentional):** `/api/link` cache key is the lowercased name rather than uuid; `/api/garden` response is `{ garden, fetchedAt }`; an `internal` error code was added. All three are folded back into the spec in Task 10.

**Heads-up for the user before merging to `main`:** CI's deploy job runs `wrangler deploy` on push to `main`. Until the `CACHE` KV binding provisions (auto-provision, or a manually created namespace id) and `HYPIXEL_API_KEY` is set with `wrangler secret put`, a deploy will either fail or serve `missing_api_key` from `/api/link` and `/api/garden`.
