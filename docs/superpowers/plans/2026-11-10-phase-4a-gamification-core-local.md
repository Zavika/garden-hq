# Phase 4A — Gamification core + local UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily quests, Player XP/levels, streaks and achievements, computed by pure `packages/core` functions, stored in localStorage, with a quest card on Home, a level/XP bar + streak flame in the HUD and an Achievements page.

**Architecture:** All rules live in `packages/core` as pure functions driven by `data/*.json` (`stepProgress` is the single entry point: expire/compact, generate, verify, unlock). The web app keeps the result in its existing `GardenStorage` under a new `progress` field that is **local-only in this milestone** (no sync ops; the cloud-save sync must merely preserve it). A `useProgressEngine` hook feeds `stepProgress` with the garden, member data, contests and stored data and writes back only when something changed.

**Tech Stack:** TypeScript strict, vitest, React 19 + react-router, zustand, TanStack Query, pnpm workspaces. Core imports JSON from `/data` (see `packages/core/src/planner.ts` for the pattern).

**Spec:** `docs/superpowers/specs/2026-11-10-phase-4-gamification-design.md` (milestone A only; milestones B cloud and C streak alert are separate plans).

## Global Constraints

- TypeScript strict everywhere; **no `any` in `packages/core`**; no non-null assertions needed (restructure instead).
- Game numbers (XP, targets, thresholds, level curve, reset hour) come from `/data`, never magic numbers in code.
- Every `core` function gets a vitest test; fixtures only, never live API calls. Fixed `now` in tests (no real clock).
- Every API field is optional: normalizers handle missing data (`asRecord`/`asNumber`/`asArray` from `packages/core/src/coerce.ts`).
- Completion only from verifiable data (API snapshot) or the one user-logged action (`water_greenhouse` → existing `markGreenhouseWatered`). **Mounting or opening the app must never complete a quest or grant XP.**
- Mobile-first: HUD and cards must work at 380 px width. Same pixel style as the rest; **all numbers use the existing `.num` class (body font)**; headings/titles keep the pixel font.
- No copied Hypixel/Minecraft textures; the flame is an original sprite built with `PixelArt`.
- Uncertain mechanics: add a `// VERIFY:` comment and an entry in `data/VERIFY.md`.
- Commit messages: conventional (`feat:`/`test:`/`docs:`), ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Before each commit: `pnpm exec prettier --write <touched files>`; at the end of each task the touched packages must pass `pnpm -r typecheck`, `pnpm lint` and `pnpm test`.
- Plan-level naming (use exactly): `QuestKind`, `QuestRecord`, `QuestContext`, `dayKey`, `nextResetMs`, `addDays`, `generateQuests`, `eligibleKinds`, `questTitle`, `questProgress`, `isFreshSnapshot`, `evaluateQuests`, `ProgressData`, `EMPTY_PROGRESS`, `sanitizeProgress`, `addQuests`, `completeQuest`, `unlockAchievement`, `compactProgress`, `summarizeProgress`, `ProgressSummary`, `newlyUnlocked`, `achievementProgress`, `getAchievement`, `stepProgress`, `ProgressEvent`, `contestStartMs`, `ContestEntry`.

## File Structure

| File | Responsibility |
|---|---|
| `data/quests.json` (new) | quest XP, targets, reset hour, freshness window, retention |
| `data/player-levels.json` (new) | Player level curve |
| `data/achievements.json` (new) | achievement ids, checks, thresholds, XP |
| `data/crops.json` (modify) | `apiId` for contest crops |
| `packages/core/src/calendar.ts` (modify) | `contestStartMs` |
| `packages/core/src/crops.ts`, `types.ts`, `member.ts` (modify) | `apiId`, `ContestEntry`, `contestEntries` |
| `packages/core/src/quests.ts` (new) | day keys, reset time, eligibility, generation, titles, progress text |
| `packages/core/src/quest-eval.ts` (new) | `evaluateQuests` (verification) |
| `packages/core/src/progress.ts` (new) | `ProgressData`, reducers, compaction, XP/level/streak summary |
| `packages/core/src/achievements.ts` (new) | metrics, unlock detection |
| `packages/core/src/progress-step.ts` (new) | `stepProgress` orchestrator + events |
| `packages/core/src/quest-fixtures.ts` (new, test helper) | `makeGarden`, `makeMember`, `makeContext` |
| `packages/core/fixtures/member-contests.real.sample.json` (new) | trimmed anonymized `jacobs_contest` capture |
| `apps/web/src/state/storage.ts`, `sync.ts` (modify) | `progress` in stored data; preserved across sync |
| `apps/web/src/state/progress.ts`, `progressEvents.ts` (new) | `useProgressEngine`, toast store |
| `apps/web/src/components/QuestCard.tsx`, `PlayerBadge.tsx` (new), `Hud.tsx`, `PixelArt.tsx` (modify) | UI |
| `apps/web/src/screens/AchievementsScreen.tsx` (new), `App.tsx` (modify) | Achievements page |
| `apps/web/src/index.css` (modify) | styles |
| `data/VERIFY.md` (modify) | new VERIFY entries |

Tasks are strictly sequential (each uses the previous tasks' exports).

---

### Task 1: Contest entries from the profile member

**Files:**
- Modify: `packages/core/src/calendar.ts`, `packages/core/src/crops.ts`, `packages/core/src/types.ts`, `packages/core/src/member.ts`, `data/crops.json`, `data/VERIFY.md`
- Create: `packages/core/fixtures/member-contests.real.sample.json`
- Test: `packages/core/src/calendar.test.ts`, `packages/core/src/member.test.ts` (existing files: append)
- Fix-ups found by typecheck/tests: any test fixture or expectation of `GardenMemberState` in `apps/worker` and `apps/web` (add `contestEntries: []`)

**Interfaces:**
- Produces: `contestStartMs(year: number, month: number, day: number): number`; `CropDefinition.apiId: string | null`; `interface ContestEntry { startsAt: number; apiCropId: string; cropId: string | null; collected: number }`; `GardenMemberState.contestEntries: ContestEntry[]` (sorted by `startsAt` ascending).

Background (owner-confirmed on a real profile): `member.jacobs_contest.contests` is keyed `"<sbYear>:<month>_<day>:<CROP_ID>"` → `{ collected, claimed_rewards?, ... }`, e.g. `"516:3_3:MELON": { collected: 8000 }`. A contest lasts exactly one SkyBlock day, so the key gives its start time. Observed ids on that profile: `WHEAT, CARROT_ITEM, POTATO_ITEM, PUMPKIN, SUGAR_CANE, MELON, MUSHROOM_COLLECTION, NETHER_STALK`.

- [ ] **Step 1: Failing tests.** Append to `packages/core/src/calendar.test.ts`:

```ts
import { contestStartMs, skyblockDate } from "./calendar";

describe("contestStartMs", () => {
  it("is the inverse of skyblockDate at the start of a SkyBlock day", () => {
    const ms = contestStartMs(516, 3, 3);
    expect(skyblockDate(new Date(ms))).toMatchObject({
      year: 516,
      month: 3,
      day: 3,
    });
    expect(skyblockDate(new Date(ms - 1))).toMatchObject({ year: 516, month: 3, day: 2 });
  });
  it("year 1, month 1, day 1 is the epoch", () => {
    expect(contestStartMs(1, 1, 1)).toBe(SKYBLOCK_EPOCH_MS);
  });
});
```
(merge imports with the file's existing ones; import `SKYBLOCK_EPOCH_MS` too). Append to `packages/core/src/member.test.ts`:

```ts
import contestFixture from "../fixtures/member-contests.real.sample.json";
import { contestStartMs } from "./calendar";

describe("contestEntries", () => {
  it("parses keys, maps crop ids and skips malformed keys", () => {
    const { contestEntries } = normalizeGardenMember({
      jacobs_contest: {
        contests: {
          "516:3_6:CACTUS": { collected: 5 },
          "516:3_3:MELON": { collected: 8000 },
          "516:3_9:WEIRD_ID": { collected: 1 },
          "not-a-key": { collected: 1 },
          "516:13_1:MELON": { collected: 1 },
        },
      },
    });
    expect(contestEntries).toEqual([
      { startsAt: contestStartMs(516, 3, 3), apiCropId: "MELON", cropId: "melon", collected: 8000 },
      { startsAt: contestStartMs(516, 3, 6), apiCropId: "CACTUS", cropId: "cactus", collected: 5 },
      { startsAt: contestStartMs(516, 3, 9), apiCropId: "WEIRD_ID", cropId: null, collected: 1 },
    ]);
  });
  it("is empty when the data is missing", () => {
    expect(normalizeGardenMember({}).contestEntries).toEqual([]);
  });
  it("maps every crop id seen on the real profile", () => {
    const { contestEntries } = normalizeGardenMember(contestFixture);
    expect(contestEntries.length).toBeGreaterThanOrEqual(8);
    expect(contestEntries.every((e) => e.cropId !== null)).toBe(true);
  });
});
```
Also update the two existing `toEqual` expectations in this file to include `contestEntries: []` (the existing fixture has no `jacobs_contest`).

- [ ] **Step 2: Run** `pnpm --filter ./packages/core test` → FAIL (missing exports).

- [ ] **Step 3: Implement.**
  - `calendar.ts`:
    ```ts
    /** Start of the SkyBlock day (year/month/day are 1-based). A Jacob's Contest occupies exactly one SkyBlock day. */
    export function contestStartMs(year: number, month: number, day: number): number {
      const elapsedDays = (year - 1) * DAYS_PER_YEAR + (month - 1) * DAYS_PER_MONTH + (day - 1);
      return SKYBLOCK_EPOCH_MS + elapsedDays * MS_PER_SKYBLOCK_DAY;
    }
    ```
  - `data/crops.json`: set `apiId` (currently all `null`): wheat `"WHEAT"`, carrot `"CARROT_ITEM"`, potato `"POTATO_ITEM"`, pumpkin `"PUMPKIN"`, sugar_cane `"SUGAR_CANE"`, melon `"MELON"`, cactus `"CACTUS"`, cocoa_beans `"INK_SACK:3"`, mushroom `"MUSHROOM_COLLECTION"`, nether_wart `"NETHER_STALK"`; sunflower/moonflower/wild_rose stay `null`.
  - `crops.ts`: add `apiId: string | null` to `CropDefinition` and copy it in the `ALL_CROPS` map.
  - `types.ts`: add `ContestEntry` (above) and `contestEntries: ContestEntry[]` to `GardenMemberState`.
  - `member.ts`: add
    ```ts
    const CROP_ID_BY_API_ID = new Map(
      ALL_CROPS.flatMap((crop) => (crop.apiId === null ? [] : [[crop.apiId, crop.id] as const])),
    );
    const CONTEST_KEY_RE = /^(\d+):(\d+)_(\d+):(.+)$/;

    // VERIFY: Hypixel ids for cactus (CACTUS) and cocoa (INK_SACK:3) are the expected
    // ones but were not seen on the one real profile (data/VERIFY.md).
    function normalizeContestEntries(raw: unknown): ContestEntry[] {
      const entries: ContestEntry[] = [];
      for (const [key, value] of Object.entries(asRecord(asRecord(raw).contests))) {
        const match = CONTEST_KEY_RE.exec(key);
        if (match === null) continue;
        const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        const apiCropId = match[4] ?? "";
        entries.push({
          startsAt: contestStartMs(year, month, day),
          apiCropId,
          cropId: CROP_ID_BY_API_ID.get(apiCropId) ?? null,
          collected: asNumber(asRecord(value).collected, 0),
        });
      }
      return entries.sort((a, b) => a.startsAt - b.startsAt);
    }
    ```
    and in `normalizeGardenMember` add `contestEntries: normalizeContestEntries(member.jacobs_contest)`.
  - Fixture: generate once with a throwaway script (`apps/worker/profiles.json` is gitignored and must stay untracked). Run from the repo root:
    ```bash
    node -e '
    const p=require("./apps/worker/profiles.json");
    const prof=p.profiles||p;
    let contests={};
    for(const pr of prof){for(const m of Object.values(pr.members||{})){const c=(m.jacobs_contest||{}).contests;if(c&&Object.keys(c).length>Object.keys(contests).length)contests=c;}}
    const per={};const out={};
    for(const k of Object.keys(contests).sort()){const crop=k.split(":")[2];per[crop]=(per[crop]||0)+1;if(per[crop]<=2)out[k]={collected:contests[k].collected};}
    require("fs").writeFileSync("packages/core/fixtures/member-contests.real.sample.json",JSON.stringify({jacobs_contest:{contests:out}},null,2)+"\n");
    console.log(Object.keys(out).length,"entries");'
    ```
    Only `collected` is kept (no `claimed_*`, no uuid or profile id): the file must contain nothing but contest keys and counts. Open it and confirm.
  - `data/VERIFY.md`: (a) replace the `apiId` bullet under "Crops" with: contest crops are mapped (8 observed on a real profile: WHEAT, CARROT_ITEM, POTATO_ITEM, PUMPKIN, SUGAR_CANE, MELON, MUSHROOM_COLLECTION, NETHER_STALK); **CACTUS and INK_SACK:3 (cocoa) are expected but unobserved**; flowers have none; unmapped ids are ignored by quests. (b) add a "Contest entries (Phase 4)" section: `jacobs_contest.contests` key format, one-SkyBlock-day assumption, and "unverified whether an entry appears while the contest is running or only after it ends".

- [ ] **Step 4: Fix fall-out.** `pnpm -r typecheck && pnpm test` and add `contestEntries: []` wherever a `GardenMemberState` literal or `toEqual` expectation breaks (expected in `apps/worker/src/routes/member.test.ts` and `apps/web/src/test/greenhouseFixtures.ts` / web tests).

- [ ] **Step 5: Run** `pnpm -r typecheck && pnpm lint && pnpm test` → PASS.

- [ ] **Step 6: Commit** `feat(core): read Jacob's contest entries from the profile member`.

---

### Task 2: Quest data, day keys, eligibility, generation

**Files:**
- Create: `data/quests.json`, `packages/core/src/quests.ts`, `packages/core/src/quest-fixtures.ts`, `packages/core/src/quests.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./quests";`)

**Interfaces:**
- Consumes: `cheapestNextPlot`, `getPlot` (`plots.ts`); `ALL_MUTATIONS` (`greenhouse-data.ts`); `DEFAULT_TIME_ZONE` (`sync.ts`); `Contest`, `GardenMemberState`, `GardenState` (`types.ts`); `data/garden-levels.json` (`[{level, xpRequired, cumulativeXp}]`).
- Produces (all exported from `quests.ts`):
  ```ts
  export const QUEST_KINDS: readonly [
    "serve_visitors","gain_garden_xp","unlock_plot","discover_mutation",
    "analyze_mutation","water_greenhouse","contest_crop"];
  export type QuestKind = (typeof QUEST_KINDS)[number];
  export const QUESTS_PER_DAY: number;     // 3
  export const QUEST_KEEP_DAYS: number;    // 14
  export function questXp(kind: QuestKind): number;
  export interface QuestRecord {
    day: string; slot: number; kind: QuestKind;
    params: Record<string, string | number>;
    baseline: number | null;
    createdAt: number; expiresAt: number; doneAt: number | null; xp: number;
  }
  export interface QuestContext {
    now: number; timeZone: string; seed: string;
    garden: GardenState; gardenFetchedAt: number;
    member: GardenMemberState | null; memberFetchedAt: number | null;
    greenhouses: Record<string, { lastWateredAt: number | null }>;
    contests: Contest[];
  }
  export function dayKey(now: number, timeZone: string): string;      // "YYYY-MM-DD"
  export function nextResetMs(now: number, timeZone: string): number; // first instant of the next quest day
  export function addDays(day: string, delta: number): string;
  export function isFreshSnapshot(fetchedAt: number | null, now: number): boolean;
  export function eligibleKinds(ctx: QuestContext, expiresAt: number): QuestKind[];
  export function generateQuests(ctx: QuestContext): QuestRecord[];
  export function questTitle(record: QuestRecord): (string | number)[];   // numbers are separate parts so the UI can use the body font
  export function questProgress(record: QuestRecord, garden: GardenState): { current: number; target: number } | null;
  ```
  `quest-fixtures.ts` produces: `makeGarden(overrides?: Partial<GardenState>): GardenState`, `makeMember(overrides?: Partial<GardenMemberState>): GardenMemberState`, `makeContext(overrides?: Partial<QuestContext>): QuestContext` plus constants `NOW = Date.UTC(2026, 10, 10, 12, 0, 0)` and `EXPIRES = Date.UTC(2026, 10, 11, 0, 0, 0)` (time zone `"UTC"`, so the day is `"2026-11-10"`).

- [ ] **Step 1: Data.** Create `data/quests.json`:

```json
{
  "version": 1,
  "lastVerified": "2026-11-10",
  "questsPerDay": 3,
  "resetHour": 0,
  "freshMinutes": 10,
  "keepDays": 14,
  "unlockMaxShortfall": 16,
  "kinds": {
    "serve_visitors": { "xp": 25, "min": 3, "max": 5 },
    "gain_garden_xp": { "xp": 25, "percentOfNextLevel": 5, "min": 50, "max": 1000 },
    "unlock_plot": { "xp": 40 },
    "discover_mutation": { "xp": 40 },
    "analyze_mutation": { "xp": 25 },
    "water_greenhouse": { "xp": 10 },
    "contest_crop": { "xp": 25 }
  }
}
```
(XP/targets are balance proposals, not game facts.)

- [ ] **Step 2: Test helpers.** Create `packages/core/src/quest-fixtures.ts`:

```ts
import { ALL_PLOTS } from "./plots";
import type { QuestContext } from "./quests";
import type { GardenMemberState, GardenState } from "./types";

export const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
export const EXPIRES = Date.UTC(2026, 10, 11, 0, 0, 0);
export const ALL_PLOT_IDS = ALL_PLOTS.map((plot) => plot.id);

export function makeGarden(overrides: Partial<GardenState> = {}): GardenState {
  return {
    level: 3,
    experience: 300,
    unlockedPlotIds: ["beginner_1", "beginner_2"],
    composter: {
      organicMatter: 0, fuel: 0, compostUnits: 10, lastSave: 0,
      upgrades: { speed: 0, multiDrop: 0, fuelCap: 0, organicMatterCap: 0, costReduction: 0 },
    },
    visitorsServedTotal: 100,
    visitors: [],
    greenhouse: { lockedCells: [] },
    ...overrides,
  };
}

export function makeMember(overrides: Partial<GardenMemberState> = {}): GardenMemberState {
  return {
    discoveredMutations: ["ashwreath", "shadevine"],
    analyzedMutations: ["ashwreath"],
    chips: {},
    hasGreenhouse: true,
    contestEntries: [],
    ...overrides,
  };
}

export function makeContext(overrides: Partial<QuestContext> = {}): QuestContext {
  return {
    now: NOW,
    timeZone: "UTC",
    seed: "uuid-1",
    garden: makeGarden(),
    gardenFetchedAt: NOW - 60_000,
    member: makeMember(),
    memberFetchedAt: NOW - 60_000,
    greenhouses: { beginner_1: { lastWateredAt: null } },
    contests: [{ startsAt: NOW + 3_600_000, crops: ["wheat", "carrot", "potato"] }],
    ...overrides,
  };
}
```
(Check that `beginner_1` is a real id in `data/plots.json`; if not, use the first two ids of `ALL_PLOTS`.)

- [ ] **Step 3: Failing tests.** Create `packages/core/src/quests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_PLOT_IDS, EXPIRES, NOW, makeContext, makeGarden, makeMember } from "./quest-fixtures";
import {
  QUESTS_PER_DAY, addDays, dayKey, eligibleKinds, generateQuests, isFreshSnapshot,
  nextResetMs, questProgress, questTitle, type QuestRecord,
} from "./quests";

describe("dayKey / nextResetMs / addDays", () => {
  it("uses the player's time zone", () => {
    const t = Date.UTC(2026, 10, 10, 23, 30);
    expect(dayKey(t, "UTC")).toBe("2026-11-10");
    expect(dayKey(t, "Europe/Warsaw")).toBe("2026-11-11");
  });
  it("falls back to the default zone for an invalid zone", () => {
    expect(dayKey(NOW, "Nope/Zone")).toBe(dayKey(NOW, "Europe/Warsaw"));
  });
  it("resets at local midnight", () => {
    expect(nextResetMs(NOW, "UTC")).toBe(EXPIRES);
    expect(nextResetMs(NOW, "Europe/Warsaw")).toBe(Date.UTC(2026, 10, 10, 23, 0));
  });
  it("handles the spring-forward day", () => {
    expect(nextResetMs(Date.UTC(2026, 2, 29, 0, 30), "Europe/Warsaw")).toBe(Date.UTC(2026, 2, 29, 22, 0));
  });
  it("adds calendar days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("isFreshSnapshot", () => {
  it("accepts recent, rejects old, future and null", () => {
    expect(isFreshSnapshot(NOW - 60_000, NOW)).toBe(true);
    expect(isFreshSnapshot(NOW - 11 * 60_000, NOW)).toBe(false);
    expect(isFreshSnapshot(NOW + 1, NOW)).toBe(false);
    expect(isFreshSnapshot(null, NOW)).toBe(false);
    expect(isFreshSnapshot(Number.NaN, NOW)).toBe(false);
  });
});

describe("eligibleKinds", () => {
  it("offers everything for a fully populated context", () => {
    expect(eligibleKinds(makeContext(), EXPIRES).sort()).toEqual(
      ["analyze_mutation","contest_crop","discover_mutation","gain_garden_xp","serve_visitors","unlock_plot","water_greenhouse"].sort(),
    );
  });
  it("drops member kinds when member data is missing or stale", () => {
    const missing = eligibleKinds(makeContext({ member: null, memberFetchedAt: null }), EXPIRES);
    const stale = eligibleKinds(makeContext({ memberFetchedAt: NOW - 3_600_000 }), EXPIRES);
    for (const kinds of [missing, stale]) {
      expect(kinds).not.toContain("discover_mutation");
      expect(kinds).not.toContain("analyze_mutation");
      expect(kinds).not.toContain("contest_crop");
    }
  });
  it("needs a marked Greenhouse to water", () => {
    expect(eligibleKinds(makeContext({ greenhouses: {} }), EXPIRES)).not.toContain("water_greenhouse");
  });
  it("needs a contest later today", () => {
    const tomorrow = [{ startsAt: EXPIRES + 1, crops: ["wheat"] }];
    const past = [{ startsAt: NOW - 1, crops: ["wheat"] }];
    expect(eligibleKinds(makeContext({ contests: tomorrow }), EXPIRES)).not.toContain("contest_crop");
    expect(eligibleKinds(makeContext({ contests: past }), EXPIRES)).not.toContain("contest_crop");
  });
  it("drops garden XP at max level and plot unlock when every plot is owned", () => {
    const kinds = eligibleKinds(
      makeContext({ garden: makeGarden({ level: 15, unlockedPlotIds: ALL_PLOT_IDS }) }),
      EXPIRES,
    );
    expect(kinds).not.toContain("gain_garden_xp");
    expect(kinds).not.toContain("unlock_plot");
  });
  it("drops mutation kinds when there is nothing left to discover or analyze", () => {
    const kinds = eligibleKinds(
      makeContext({ member: makeMember({ hasGreenhouse: false, analyzedMutations: ["ashwreath", "shadevine"] }) }),
      EXPIRES,
    );
    expect(kinds).not.toContain("discover_mutation");
    expect(kinds).not.toContain("analyze_mutation");
  });
});

describe("generateQuests", () => {
  it("makes up to QUESTS_PER_DAY distinct quests with frozen fields", () => {
    const quests = generateQuests(makeContext());
    expect(quests).toHaveLength(QUESTS_PER_DAY);
    expect(new Set(quests.map((q) => q.kind)).size).toBe(QUESTS_PER_DAY);
    quests.forEach((q, slot) => {
      expect(q).toMatchObject({ day: "2026-11-10", slot, createdAt: NOW, expiresAt: EXPIRES, doneAt: null });
      expect(q.xp).toBeGreaterThan(0);
    });
  });
  it("is deterministic for the same input and varies with the seed", () => {
    expect(generateQuests(makeContext())).toEqual(generateQuests(makeContext()));
    const kindsFor = (seed: string) => generateQuests(makeContext({ seed })).map((q) => q.kind).join();
    const variants = new Set(Array.from({ length: 30 }, (_, i) => kindsFor(`seed-${i}`)));
    expect(variants.size).toBeGreaterThan(1);
  });
  it("returns fewer quests rather than filler when little is eligible", () => {
    const quests = generateQuests(
      makeContext({
        member: null, memberFetchedAt: null, greenhouses: {}, contests: [],
        garden: makeGarden({ level: 15, unlockedPlotIds: ALL_PLOT_IDS }),
      }),
    );
    expect(quests.map((q) => q.kind)).toEqual(["serve_visitors"]);
  });
  it("freezes the baseline from the supplied snapshot", () => {
    const ctx = makeContext({
      garden: makeGarden({ visitorsServedTotal: 777, experience: 4321 }),
      member: makeMember({ discoveredMutations: ["a", "b", "c"], analyzedMutations: ["a"] }),
    });
    const byKind = new Map<string, QuestRecord>();
    for (let i = 0; i < 40; i++) {
      for (const q of generateQuests({ ...ctx, seed: `s${i}` })) byKind.set(q.kind, q);
    }
    expect(byKind.get("serve_visitors")?.baseline).toBe(777);
    expect(byKind.get("gain_garden_xp")?.baseline).toBe(4321);
    expect(byKind.get("discover_mutation")?.baseline).toBe(3);
    expect(byKind.get("analyze_mutation")?.baseline).toBe(1);
    expect(byKind.get("unlock_plot")?.params.plotId).toEqual(expect.any(String));
    const target = byKind.get("serve_visitors")?.params.target;
    expect(target).toBeGreaterThanOrEqual(3);
    expect(target).toBeLessThanOrEqual(5);
  });
});

describe("questTitle / questProgress", () => {
  const rec = (over: Partial<QuestRecord>): QuestRecord => ({
    day: "2026-11-10", slot: 0, kind: "serve_visitors", params: { target: 4 },
    baseline: 100, createdAt: NOW, expiresAt: EXPIRES, doneAt: null, xp: 25, ...over,
  });
  it("keeps numbers as separate title parts", () => {
    expect(questTitle(rec({}))).toEqual(["Serve ", 4, " visitors"]);
    expect(questTitle(rec({ kind: "water_greenhouse", params: {} })).join("")).toBe("Water the Greenhouse");
  });
  it("shows clamped progress for counting kinds and null for the rest", () => {
    expect(questProgress(rec({}), makeGarden({ visitorsServedTotal: 102 }))).toEqual({ current: 2, target: 4 });
    expect(questProgress(rec({}), makeGarden({ visitorsServedTotal: 150 }))).toEqual({ current: 4, target: 4 });
    expect(questProgress(rec({}), makeGarden({ visitorsServedTotal: 90 }))).toEqual({ current: 0, target: 4 });
    expect(questProgress(rec({ kind: "water_greenhouse", params: {}, baseline: null }), makeGarden())).toBeNull();
  });
});
```
Also add a data-integrity test in the same file: every `QUEST_KINDS` entry has `questXp(kind) > 0`.

- [ ] **Step 4: Run** `pnpm --filter ./packages/core test quests` → FAIL.

- [ ] **Step 5: Implement `packages/core/src/quests.ts`.**

```ts
import gardenLevels from "../../../data/garden-levels.json";
import questData from "../../../data/quests.json";
import { ALL_MUTATIONS } from "./greenhouse-data";
import { cheapestNextPlot, getPlot } from "./plots";
import { DEFAULT_TIME_ZONE } from "./sync";
import type { Contest, GardenMemberState, GardenState } from "./types";

export const QUEST_KINDS = [
  "serve_visitors", "gain_garden_xp", "unlock_plot", "discover_mutation",
  "analyze_mutation", "water_greenhouse", "contest_crop",
] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

interface KindData { xp: number; min?: number; max?: number; percentOfNextLevel?: number }
interface QuestData {
  questsPerDay: number; resetHour: number; freshMinutes: number; keepDays: number;
  unlockMaxShortfall: number; kinds: Record<QuestKind, KindData>;
}
const DATA = questData as QuestData;
const LEVELS = gardenLevels as { level: number; xpRequired: number }[];

export const QUESTS_PER_DAY: number = DATA.questsPerDay;
export const QUEST_KEEP_DAYS: number = DATA.keepDays;
const FRESH_MS = DATA.freshMinutes * 60_000;
const HOUR_MS = 3_600_000;

export function questXp(kind: QuestKind): number {
  return DATA.kinds[kind].xp;
}

export interface QuestRecord { /* fields exactly as in the Interfaces block above */ }
export interface QuestContext { /* fields exactly as in the Interfaces block above */ }

function formatDay(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
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

export function isFreshSnapshot(fetchedAt: number | null, now: number): boolean {
  return fetchedAt !== null && Number.isFinite(fetchedAt) && fetchedAt <= now && now - fetchedAt <= FRESH_MS;
}

function xpToNextGardenLevel(level: number): number | null {
  return LEVELS.find((entry) => entry.level === level + 1)?.xpRequired ?? null;
}

export function eligibleKinds(ctx: QuestContext, expiresAt: number): QuestKind[] {
  const { garden, member } = ctx;
  const out: QuestKind[] = ["serve_visitors"];
  if (xpToNextGardenLevel(garden.level) !== null) out.push("gain_garden_xp");
  const plot = cheapestNextPlot(garden.unlockedPlotIds, garden.level);
  if (plot !== undefined && plot.cost <= garden.composter.compostUnits + DATA.unlockMaxShortfall) {
    out.push("unlock_plot");
  }
  const memberOk = member !== null && isFreshSnapshot(ctx.memberFetchedAt, ctx.now);
  if (member !== null && memberOk) {
    if (member.hasGreenhouse && member.discoveredMutations.length < ALL_MUTATIONS.length) {
      out.push("discover_mutation");
    }
    if (member.analyzedMutations.length < member.discoveredMutations.length) {
      out.push("analyze_mutation");
    }
  }
  if (Object.keys(ctx.greenhouses).length > 0) out.push("water_greenhouse");
  if (memberOk && ctx.contests.some((c) => c.startsAt > ctx.now && c.startsAt < expiresAt)) {
    out.push("contest_crop");
  }
  return out;
}
```
then the seeded RNG and generation:

```ts
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

function buildRecord(kind: QuestKind, slot: number, day: string, expiresAt: number, ctx: QuestContext, rand: () => number): QuestRecord {
  const base = { day, slot, kind, createdAt: ctx.now, expiresAt, doneAt: null, xp: questXp(kind) };
  const { garden, member } = ctx;
  const data = DATA.kinds[kind];
  switch (kind) {
    case "serve_visitors": {
      const min = data.min ?? 3;
      const max = data.max ?? 5;
      return { ...base, params: { target: min + Math.floor(rand() * (max - min + 1)) }, baseline: garden.visitorsServedTotal };
    }
    case "gain_garden_xp": {
      const next = xpToNextGardenLevel(garden.level) ?? 0;
      const raw = Math.round((next * (data.percentOfNextLevel ?? 5)) / 100 / 10) * 10;
      const target = Math.min(data.max ?? 1000, Math.max(data.min ?? 50, raw));
      return { ...base, params: { target }, baseline: garden.experience };
    }
    case "unlock_plot": {
      const plot = cheapestNextPlot(garden.unlockedPlotIds, garden.level);
      return { ...base, params: { plotId: plot?.id ?? "" }, baseline: null };
    }
    case "discover_mutation":
      return { ...base, params: {}, baseline: member?.discoveredMutations.length ?? 0 };
    case "analyze_mutation":
      return { ...base, params: {}, baseline: member?.analyzedMutations.length ?? 0 };
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
    .map((kind, slot) => buildRecord(kind, slot, day, expiresAt, ctx, rand));
}

export function questTitle(record: QuestRecord): (string | number)[] {
  const target = Number(record.params.target ?? 0);
  switch (record.kind) {
    case "serve_visitors": return ["Serve ", target, " visitors"];
    case "gain_garden_xp": return ["Earn ", target, " Garden XP"];
    case "unlock_plot": {
      const plot = getPlot(String(record.params.plotId ?? ""));
      return plot === undefined ? ["Unlock a new plot"] : ["Unlock plot ", plot.plotNumber];
    }
    case "discover_mutation": return ["Discover a new Greenhouse mutation"];
    case "analyze_mutation": return ["Analyze a Greenhouse mutation"];
    case "water_greenhouse": return ["Water the Greenhouse"];
    case "contest_crop": return ["Farm in a Jacob's Contest"];
  }
}

export function questProgress(record: QuestRecord, garden: GardenState): { current: number; target: number } | null {
  const target = Number(record.params.target ?? 0);
  if (record.baseline === null || target <= 0) return null;
  let value: number;
  if (record.kind === "serve_visitors") value = garden.visitorsServedTotal;
  else if (record.kind === "gain_garden_xp") value = garden.experience;
  else return null;
  return { current: Math.min(target, Math.max(0, value - record.baseline)), target };
}
```
Replace the two `/* … */` placeholders with the real interface bodies from the Interfaces block. Export from `index.ts`.

- [ ] **Step 6: Run** `pnpm --filter ./packages/core test && pnpm -r typecheck && pnpm lint` → PASS. (If `Intl` splits the DST test differently on the CI ICU build, report; do not weaken the assertion.)

- [ ] **Step 7: Commit** `feat(core): daily quest data, day keys, eligibility and generation`.

---

### Task 3: Quest verification (`evaluateQuests`)

**Files:**
- Create: `packages/core/src/quest-eval.ts`, `packages/core/src/quest-eval.test.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./quest-eval";`)

**Interfaces:**
- Consumes: `QuestRecord`, `QuestContext` (Task 2); `makeContext`, `makeGarden`, `makeMember`, `NOW`, `EXPIRES` (fixtures); `contestStartMs` (Task 1).
- Produces:
  ```ts
  export interface QuestCompletion { day: string; slot: number; at: number }
  export function evaluateQuests(
    records: readonly QuestRecord[],
    ctx: Pick<QuestContext, "now" | "garden" | "gardenFetchedAt" | "member" | "memberFetchedAt" | "greenhouses">,
  ): QuestCompletion[];
  ```

Rules (spec §2 "Verification"): only records with `doneAt === null` and `createdAt <= now < expiresAt` are evaluated (**expired quests are never credited**); API kinds complete from the snapshot and `at` is the snapshot's fetch time clamped to `>= createdAt` and rejected if the snapshot is in the future or fetched at/after `expiresAt`; counters use `>=` (monotonic); missing `baseline`/member means "not done"; `water_greenhouse` completes from `greenhouses[*].lastWateredAt` with `createdAt <= at < expiresAt` and `at <= now` (earliest qualifying value is `at`); `contest_crop` completes when `member.contestEntries` has an entry with `cropId !== null`, `collected > 0` and `createdAt <= startsAt < expiresAt` (unmapped crop ids never complete).

- [ ] **Step 1: Failing tests** in `quest-eval.test.ts` (helper `rec(over)` builds a record: `day "2026-11-10"`, `slot 0`, `createdAt NOW - 3_600_000`, `expiresAt EXPIRES`, `doneAt null`, `xp 25`, default kind `serve_visitors`, `params {target: 4}`, `baseline 100`). Cases, each asserting the exact returned array:
  - serve visitors: total 103 → `[]`; total 104 → `[{day, slot: 0, at: NOW - 60_000}]` (snapshot time); total 99 (lower) → `[]`.
  - `at` clamps to `createdAt` when the snapshot is older than the quest (`gardenFetchedAt = createdAt - 1000` → `at === createdAt`).
  - snapshot in the future (`gardenFetchedAt = NOW + 1`) → `[]`; snapshot at/after `expiresAt` → `[]`.
  - already done (`doneAt: 5`) → `[]`; expired (`now = EXPIRES`) → `[]`; not yet created (`createdAt = NOW + 1`) → `[]`.
  - `gain_garden_xp` (`params {target: 300}`, `baseline 1000`): experience 1299 → `[]`, 1300 → done.
  - `unlock_plot` (`params {plotId: "beginner_3"}`, `baseline null`): unlocked ids without it → `[]`, with it → done.
  - `discover_mutation` (`baseline 2`): member with 2 → `[]`, 3 → done at `memberFetchedAt`; `member: null` → `[]`; `memberFetchedAt: null` → `[]`.
  - `analyze_mutation` same shape with `analyzedMutations`.
  - `water_greenhouse`: `lastWateredAt` before `createdAt` → `[]`; after `now` → `[]`; at `createdAt + 10` → `[{…, at: createdAt + 10}]`; two greenhouses → earliest qualifying.
  - `contest_crop`: entry with `startsAt` before `createdAt` → `[]`; `collected: 0` → `[]`; `cropId: null` → `[]`; `startsAt >= EXPIRES` → `[]`; valid entry (`startsAt = createdAt + 1_000`, `collected: 8000`, `cropId: "melon"`) → done at `memberFetchedAt`.
  - several records → completions for only the qualifying ones, in record order.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { QuestContext, QuestRecord } from "./quests";

export interface QuestCompletion { day: string; slot: number; at: number }

type EvalContext = Pick<QuestContext, "now" | "garden" | "gardenFetchedAt" | "member" | "memberFetchedAt" | "greenhouses">;

function snapshotAt(fetchedAt: number | null, record: QuestRecord, now: number): number | null {
  if (fetchedAt === null || !Number.isFinite(fetchedAt)) return null;
  if (fetchedAt > now || fetchedAt >= record.expiresAt) return null;
  return Math.max(fetchedAt, record.createdAt);
}

function completionTime(record: QuestRecord, ctx: EvalContext): number | null {
  const { garden, member } = ctx;
  const target = Number(record.params.target ?? 0);
  switch (record.kind) {
    case "serve_visitors":
      return record.baseline !== null && garden.visitorsServedTotal >= record.baseline + target
        ? snapshotAt(ctx.gardenFetchedAt, record, ctx.now) : null;
    case "gain_garden_xp":
      return record.baseline !== null && garden.experience >= record.baseline + target
        ? snapshotAt(ctx.gardenFetchedAt, record, ctx.now) : null;
    case "unlock_plot":
      return garden.unlockedPlotIds.includes(String(record.params.plotId ?? ""))
        ? snapshotAt(ctx.gardenFetchedAt, record, ctx.now) : null;
    case "discover_mutation":
      return member !== null && record.baseline !== null && member.discoveredMutations.length > record.baseline
        ? snapshotAt(ctx.memberFetchedAt, record, ctx.now) : null;
    case "analyze_mutation":
      return member !== null && record.baseline !== null && member.analyzedMutations.length > record.baseline
        ? snapshotAt(ctx.memberFetchedAt, record, ctx.now) : null;
    case "water_greenhouse": {
      const times = Object.values(ctx.greenhouses)
        .map((g) => g.lastWateredAt)
        .filter((t): t is number => t !== null && t >= record.createdAt && t < record.expiresAt && t <= ctx.now);
      return times.length === 0 ? null : Math.min(...times);
    }
    case "contest_crop":
      return member !== null && member.contestEntries.some(
        (e) => e.cropId !== null && e.collected > 0 && e.startsAt >= record.createdAt && e.startsAt < record.expiresAt,
      ) ? snapshotAt(ctx.memberFetchedAt, record, ctx.now) : null;
  }
}

export function evaluateQuests(records: readonly QuestRecord[], ctx: EvalContext): QuestCompletion[] {
  const out: QuestCompletion[] = [];
  for (const record of records) {
    if (record.doneAt !== null || ctx.now < record.createdAt || ctx.now >= record.expiresAt) continue;
    const at = completionTime(record, ctx);
    if (at !== null) out.push({ day: record.day, slot: record.slot, at });
  }
  return out;
}
```
(`// VERIFY:` comment above the contest case: entries may only appear after a contest ends; see `data/VERIFY.md`.)

- [ ] **Step 4: Run** `pnpm --filter ./packages/core test && pnpm -r typecheck && pnpm lint` → PASS.
- [ ] **Step 5: Commit** `feat(core): verify daily quests against API snapshots`.

---

### Task 4: Progress data, XP/level, streak

**Files:**
- Create: `data/player-levels.json`, `packages/core/src/progress.ts`, `packages/core/src/progress.test.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./progress";`)

**Interfaces:**
- Consumes: `QuestRecord`, `QUEST_KINDS`, `QUESTS_PER_DAY`, `QUEST_KEEP_DAYS`, `questXp`, `addDays` (Task 2).
- Produces:
  ```ts
  export interface ProgressArchive { xp: number; doneQuests: number; doneDays: string[] }
  export interface UnlockedAchievement { at: number; xp: number }
  export interface ProgressData {
    quests: QuestRecord[];                              // today + last QUEST_KEEP_DAYS days
    achievements: Record<string, UnlockedAchievement>;
    archive: ProgressArchive;                           // folded-in older history
  }
  export const EMPTY_PROGRESS: ProgressData;
  export function sanitizeProgress(raw: unknown): ProgressData;
  export function addQuests(p: ProgressData, records: readonly QuestRecord[]): ProgressData;     // first write wins per (day, slot); same reference if nothing added
  export function completeQuest(p: ProgressData, day: string, slot: number, at: number): ProgressData; // sets doneAt if null; same reference if no change
  export function unlockAchievement(p: ProgressData, id: string, at: number, xp: number): ProgressData; // insert if absent; same reference otherwise
  export function compactProgress(p: ProgressData, today: string): ProgressData;                 // same reference if nothing is older than the window
  export interface ProgressSummary {
    xp: number; level: number; xpIntoLevel: number; xpForNext: number | null;
    streak: number; bestStreak: number; atRisk: boolean; doneToday: boolean; doneQuests: number;
  }
  export function summarizeProgress(p: ProgressData, today: string): ProgressSummary;
  export const MAX_PLAYER_LEVEL: number;
  ```
- Spec note: `archive.doneQuests` is an implementation addition (needed for the "quests done" achievement after compaction); `QuestRecord.expiresAt` likewise.

- [ ] **Step 1: Data.** `data/player-levels.json`:
```json
{ "version": 1, "lastVerified": "2026-11-10", "maxLevel": 30, "xpToNext": { "base": 60, "perLevel": 20 } }
```
(XP to go from level L to L+1 is `base + perLevel * L`; a balance proposal.)

- [ ] **Step 2: Failing tests** (`progress.test.ts`; helper `rec(day, slot, done)` builds a `QuestRecord` with `xp 25`, `doneAt` `done ? 1 : null`; `p(over)` merges into `EMPTY_PROGRESS`):
  - `sanitizeProgress`: `null`/garbage → `EMPTY_PROGRESS`-equal; drops records with unknown kind, bad day format, slot ≥ `QUESTS_PER_DAY`, non-finite numbers; de-duplicates `(day, slot)` keeping the first; **forces `xp` to `questXp(kind)`** (a stored `xp: 9999` becomes the data value); keeps valid achievements; archive `doneDays` filtered/sorted/capped at 400 newest.
  - `addQuests`: adds new slots, ignores an existing `(day, slot)` (first write wins), returns the same reference when nothing is added.
  - `completeQuest`: sets `doneAt` once, does not change a done record, same reference when unchanged or when the record does not exist.
  - `unlockAchievement`: inserts, keeps the first unlock, same reference on repeat.
  - `compactProgress`: with `today = "2026-11-30"` and `QUEST_KEEP_DAYS = 14`, a done record on `2026-11-01` is folded (`archive.xp += 25`, `doneQuests += 1`, day added to `doneDays`) and removed; an undone old record is dropped without XP; recent records stay; same reference when nothing is old; XP total and streak from `summarizeProgress` are identical before and after compaction.
  - `summarizeProgress`: XP = archive + done quests + achievements; level boundaries from the curve (0 XP → level 1, `xpIntoLevel 0`, `xpForNext 80`; exactly 80 XP → level 2; enormous XP → `MAX_PLAYER_LEVEL` with `xpForNext === null`); streak: done today and the 2 previous days → 3; nothing today but yesterday and the day before → streak 2 and `atRisk: true`; gap of one day → streak resets; nothing done in 2 days → 0 and `atRisk: false`; `bestStreak` keeps the longest historic run; `doneQuests` includes the archive count; a streak spanning archive days and record days counts correctly.

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement `progress.ts`.**

```ts
import levelData from "../../../data/player-levels.json";
import { asArray, asNumber, asRecord } from "./coerce";
import { QUEST_KEEP_DAYS, QUEST_KINDS, QUESTS_PER_DAY, addDays, questXp, type QuestKind, type QuestRecord } from "./quests";

const LEVELS = levelData as { maxLevel: number; xpToNext: { base: number; perLevel: number } };
export const MAX_PLAYER_LEVEL: number = LEVELS.maxLevel;
const MAX_DONE_DAYS = 400;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const EMPTY_PROGRESS: ProgressData = {
  quests: [], achievements: {}, archive: { xp: 0, doneQuests: 0, doneDays: [] },
};
```
Write the interfaces from the Interfaces block, then:
  - `parseRecord(raw: unknown): QuestRecord | null` using `asRecord/asNumber`: require `kind` in `QUEST_KINDS` (type guard), `DAY_RE.test(day)`, integer `slot` in `[0, QUESTS_PER_DAY)`, finite `createdAt`/`expiresAt`, `doneAt` finite or null, `baseline` finite or null, `params` an object whose values are strings or finite numbers; set `xp: questXp(kind)`.
  - `sanitizeDoneDays(days: unknown): string[]`: valid, unique, ascending, newest `MAX_DONE_DAYS`.
  - `sanitizeProgress`: assemble; de-duplicate `(day, slot)` first-wins; achievements: key string, `at` and `xp` finite numbers (`xp >= 0`); archive: `xp`, `doneQuests` finite `>= 0` (floor `doneQuests`).
  - reducers and `compactProgress` as specified (always spread; return the **input reference** when unchanged). Fold: `cutoff = addDays(today, -QUEST_KEEP_DAYS)`; old = `quests.filter((q) => q.day < cutoff)` (ISO strings compare chronologically).
  - `summarizeProgress`: build `days = new Set([...archive.doneDays, ...done.map((q) => q.day)])`; `xp`; level loop:
    ```ts
    let level = 1; let rest = xp;
    while (level < MAX_PLAYER_LEVEL) {
      const need = LEVELS.xpToNext.base + LEVELS.xpToNext.perLevel * level;
      if (rest < need) break;
      rest -= need; level++;
    }
    const xpForNext = level >= MAX_PLAYER_LEVEL ? null : LEVELS.xpToNext.base + LEVELS.xpToNext.perLevel * level;
    ```
    streak: start at `today` if in `days`, else at `yesterday` if in `days`, else 0, then walk back one day at a time while present; `bestStreak`: sort days ascending, longest run of consecutive keys (`addDays(prev, 1) === next`), `Math.max` with the live `streak`; `atRisk = streak > 0 && !doneToday`.

- [ ] **Step 5: Run** `pnpm --filter ./packages/core test && pnpm -r typecheck && pnpm lint` → PASS.
- [ ] **Step 6: Commit** `feat(core): progress data, Player XP/level and streak summary`.

---

### Task 5: Achievements

**Files:**
- Create: `data/achievements.json`, `packages/core/src/achievements.ts`, `packages/core/src/achievements.test.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./achievements";`)

**Interfaces:**
- Consumes: `ProgressSummary`, `ProgressData['achievements']` shape (`Record<string, UnlockedAchievement>`) (Task 4); `GardenState`, `GardenMemberState`; `ALL_MUTATIONS`; `ALL_CROPS`; `ALL_PLOTS`.
- Produces:
  ```ts
  export type AchievementCheck =
    | "first_greenhouse" | "plots_unlocked" | "crops_assigned" | "mutations_discovered"
    | "garden_level" | "visitors_served" | "streak" | "quests_done";
  export interface AchievementDef { id: string; check: AchievementCheck; threshold: number; title: string; description: string; xp: number }
  export const ACHIEVEMENTS: readonly AchievementDef[];
  export function getAchievement(id: string): AchievementDef | undefined;
  export interface AchievementContext {
    garden: GardenState; member: GardenMemberState | null;
    assignments: Record<string, string>; greenhouses: Record<string, unknown>;
    summary: ProgressSummary;
  }
  export function achievementMetrics(ctx: AchievementContext): Record<AchievementCheck, number>;
  export function newlyUnlocked(ctx: AchievementContext, unlocked: Record<string, UnlockedAchievement>): AchievementDef[];
  export interface AchievementStatus { def: AchievementDef; value: number; unlocked: UnlockedAchievement | null }
  export function achievementProgress(ctx: AchievementContext, unlocked: Record<string, UnlockedAchievement>): AchievementStatus[];
  ```
  Metrics: `first_greenhouse` = 1 if `member?.hasGreenhouse` or any marked Greenhouse else 0; `plots_unlocked` = `garden.unlockedPlotIds.length`; `crops_assigned` = distinct crop ids among assignments whose plot is in `garden.unlockedPlotIds`; `mutations_discovered` = `member?.discoveredMutations.length ?? 0`; `garden_level` = `garden.level`; `visitors_served` = `garden.visitorsServedTotal`; `streak` = `summary.bestStreak`; `quests_done` = `summary.doneQuests`.

- [ ] **Step 1: Data.** `data/achievements.json` (`{ "version": 1, "lastVerified": "2026-11-10", "achievements": [ … ] }`) with exactly these 23 entries (`id`, `check`, `threshold`, `title`, `description`, `xp`):

| id | check | threshold | title | description | xp |
|---|---|---|---|---|---|
| first_greenhouse | first_greenhouse | 1 | Green thumb | Build your first Greenhouse. | 50 |
| plots_6 | plots_unlocked | 6 | Growing plot | Unlock 6 plots. | 30 |
| plots_12 | plots_unlocked | 12 | Half a garden | Unlock 12 plots. | 60 |
| plots_18 | plots_unlocked | 18 | Sprawling estate | Unlock 18 plots. | 100 |
| plots_24 | plots_unlocked | 24 | Every plot | Unlock all 24 plots. | 200 |
| crops_5 | crops_assigned | 5 | Crop sampler | Assign 5 different crops to plots. | 30 |
| crops_13 | crops_assigned | 13 | Full harvest | Assign all 13 crops to plots. | 100 |
| mutations_1 | mutations_discovered | 1 | First mutation | Discover a Greenhouse mutation. | 30 |
| mutations_10 | mutations_discovered | 10 | Mutation hobbyist | Discover 10 mutations. | 60 |
| mutations_20 | mutations_discovered | 20 | Mutation expert | Discover 20 mutations. | 100 |
| mutations_40 | mutations_discovered | 40 | Mutation master | Discover all 40 mutations. | 200 |
| garden_level_5 | garden_level | 5 | Garden level 5 | Reach Garden level 5. | 40 |
| garden_level_10 | garden_level | 10 | Garden level 10 | Reach Garden level 10. | 80 |
| garden_level_15 | garden_level | 15 | Garden level 15 | Reach the maximum Garden level. | 200 |
| visitors_50 | visitors_served | 50 | Good host | Serve 50 visitors. | 30 |
| visitors_250 | visitors_served | 250 | Open door | Serve 250 visitors. | 80 |
| visitors_1000 | visitors_served | 1000 | Barn legend | Serve 1,000 visitors. | 200 |
| streak_3 | streak | 3 | Three in a row | Reach a 3-day quest streak. | 30 |
| streak_7 | streak | 7 | Week streak | Reach a 7-day quest streak. | 60 |
| streak_30 | streak | 30 | Month streak | Reach a 30-day quest streak. | 200 |
| quests_10 | quests_done | 10 | Getting started | Complete 10 quests. | 30 |
| quests_50 | quests_done | 50 | Regular | Complete 50 quests. | 80 |
| quests_250 | quests_done | 250 | Dedicated farmer | Complete 250 quests. | 200 |


- [ ] **Step 2: Failing tests** (`achievements.test.ts`; build contexts with `makeGarden`/`makeMember` and a `summary` from `summarizeProgress(EMPTY_PROGRESS, "2026-11-10")` spread with overrides):
  - data integrity: ids unique; every `check` is a known `AchievementCheck`; `xp > 0`; thresholds within what the game allows (`plots_unlocked` ≤ `ALL_PLOTS.length`, `crops_assigned` ≤ `ALL_CROPS.length`, `mutations_discovered` ≤ `ALL_MUTATIONS.length`, `garden_level` ≤ 15); `lastVerified` present.
  - metrics: `first_greenhouse` from the member flag, from a marked Greenhouse, and 0 for neither; `crops_assigned` ignores assignments on locked plots and counts distinct crops; null member → mutation metric 0.
  - `newlyUnlocked`: tier boundary (value exactly at threshold unlocks, one below does not); already-unlocked ids are excluded; a veteran context (24 plots, level 15, 40 mutations…) unlocks every satisfied tier at once.
  - `achievementProgress`: returns every definition with the current value and unlock info.

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** `achievements.ts` (import the JSON, type it, build `ACHIEVEMENTS`, `getAchievement` via a `Map`, the metrics switch, `newlyUnlocked` = `ACHIEVEMENTS.filter((a) => !(a.id in unlocked) && metrics[a.check] >= a.threshold)`, `achievementProgress`).
- [ ] **Step 5: Run** `pnpm --filter ./packages/core test && pnpm -r typecheck && pnpm lint` → PASS. **Step 6: Commit** `feat(core): achievements`.

---

### Task 6: `stepProgress` orchestrator

**Files:**
- Create: `packages/core/src/progress-step.ts`, `packages/core/src/progress-step.test.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./progress-step";`)

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  ```ts
  export interface StepInput extends QuestContext {
    progress: ProgressData;
    assignments: Record<string, string>;
  }
  export type ProgressEvent =
    | { type: "quest_done"; day: string; slot: number; xp: number }
    | { type: "achievement"; id: string; xp: number }
    | { type: "backfill"; count: number; xp: number };
  export interface StepResult { progress: ProgressData; events: ProgressEvent[] }
  export function stepProgress(input: StepInput): StepResult;
  ```
  Contract: pure and **idempotent** — calling it again with `result.progress` and the same input returns `progress === result.progress` (same reference) and `events: []`. Returns `input.progress` (same reference) when nothing changed.

Algorithm: (1) `today = dayKey(now, timeZone)`; (2) `p = compactProgress(progress, today)`; (3) if `p.quests` has no record for `today` **and** `isFreshSnapshot(gardenFetchedAt, now)`, `p = addQuests(p, generateQuests(input))`; (4) `evaluateQuests(p.quests, input)` → for each completion `completeQuest` and a `quest_done` event with the record's `xp`; (5) `summary = summarizeProgress(p, today)`; `newlyUnlocked({ garden, member, assignments, greenhouses, summary }, p.achievements)` → `unlockAchievement(p, id, now, xp)` for each; (6) events: if the **input** progress was completely empty (no quests, no achievements, `archive.doneQuests === 0`) and anything unlocked, emit one `backfill` event `{count, xp: sum}`; otherwise one `achievement` event per unlock. Backfilled achievements award their **full XP** (owner decision).

- [ ] **Step 1: Failing tests** (`progress-step.test.ts`, `makeContext()` plus `progress: EMPTY_PROGRESS`, `assignments: {}`):
  - first call on a new day with a fresh garden creates `QUESTS_PER_DAY` quests, none done, **no `quest_done` events** (opening the app never rewards).
  - stale garden (`gardenFetchedAt = NOW - 3_600_000`) creates no quests.
  - second call with the previous result is a no-op: `result2.progress === result1.progress`, `events` empty (idempotent).
  - after generation, bumping `garden.visitorsServedTotal` past the target of a `serve_visitors` quest (find it, or loop seeds until one is generated) completes exactly that quest: `doneAt === gardenFetchedAt` (clamped), one `quest_done` event, and `summarizeProgress` XP includes the quest XP.
  - a quest from yesterday that is undone is not completed after the reset even if the counters now qualify.
  - veteran first run (24 plots, level 15, 40 discovered mutations via a generated id list, big visitors count) emits a single `backfill` event with `count > 1` and `xp` equal to the sum of the unlocked achievements' XP, and those XP appear in `summarizeProgress(...).xp` (full XP).
  - non-first run unlocks emit individual `achievement` events.
  - `water_greenhouse`: a record exists; setting `greenhouses.beginner_1.lastWateredAt = NOW - 1000` (after `createdAt`) completes it.
  - compaction: a done record 20 days old is folded into the archive and XP is preserved.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per the algorithm (`changed` is implicit: return `{ progress: p, events }` where `p === input.progress` when untouched; make sure each reducer returns its input reference when it changes nothing so the identity check holds; keep `quest_done` xp by looking the record up before completing it).
- [ ] **Step 4: Run** `pnpm --filter ./packages/core test && pnpm -r typecheck && pnpm lint` → PASS. **Step 5: Commit** `feat(core): stepProgress orchestrator`.

---

### Task 7: Store progress locally and keep it through cloud sync

**Files:**
- Modify: `packages/core/src/sync.ts` (make `applyOp`/`applyOps` generic), `apps/web/src/state/storage.ts`, `apps/web/src/state/sync.ts`, `apps/web/src/test/renderWithProviders.tsx` only if its types break
- Test: `apps/web/src/state/storage.test.ts`, `apps/web/src/state/sync.test.ts` (append), `packages/core/src/sync.test.ts` (append one generic-preservation test)

**Interfaces:**
- Produces (web): `StoredData` in `storage.ts` becomes `interface StoredData extends SyncedData { progress: ProgressData }` where `SyncedData` is the core `StoredData` imported under an alias; `GardenStorage.setProgress(next: ProgressData): void`. Core: `applyOp<T extends StoredData>(data: T, op: SyncOp): T` and `applyOps<T extends StoredData>(data: T, ops: readonly SyncOp[]): T` (extra properties are preserved).
- The server and the sync wire format are **unchanged** (milestone B adds progress to them).

- [ ] **Step 1: Failing tests.**
  - core `sync.test.ts`: `applyOp({ ...EMPTY_STORED_DATA, extra: 1 }, { t: "setTimeZone", timeZone: "UTC" })` keeps `extra === 1` (compile-time + runtime).
  - `storage.test.ts`: a new storage starts with `progress` equal to `EMPTY_PROGRESS`; `setProgress` persists to the backing and notifies subscribers; `setProgress` with the same reference does not notify; loading a save without a `progress` key gives empty progress; garbage `progress` in storage is sanitized (via `sanitizeProgress`); `clearAll` resets progress.
  - `sync.test.ts`: after a pull whose server state lacks progress, `storage.getSnapshot().progress` is unchanged (progress survives `applyServer`), and the same after `joinWithCode`.
- [ ] **Step 2: Run** `pnpm -r test` → FAIL.
- [ ] **Step 3: Implement.**
  - `core/sync.ts`: generic signatures; in `applyOps` use `ops.reduce((acc, op) => applyOp(acc, op), data)`.
  - `storage.ts`: import core `StoredData as SyncedData`, `EMPTY_PROGRESS`, `sanitizeProgress`, `type ProgressData`; export the extended `StoredData`; `const EMPTY: StoredData = { ...EMPTY_STORED_DATA, progress: EMPTY_PROGRESS }`; use `EMPTY` for the unavailable/`null`/garbage load paths and in `clearAll`; `sanitize` adds `progress: sanitizeProgress(d.progress)`; add `setProgress: (next) => { if (next !== data.progress) commit({ ...data, progress: next }); }` (the `GardenStorage` interface gets the method; no sync op).
  - `sync.ts`: `withoutRevision` returns the core type; in `applyServer` build `merged` as `{ ...server, link: server.link ?? local.link, progress: local.progress }`; make the same change wherever the join path replaces local state (`planJoin` result), always carrying `local.progress`. `setProgress` is not wrapped (no op); it stays reachable via `...base`. Fix any type errors the compiler reports in `SyncSection`, `SettingsScreen` and tests by passing `progress` through.
- [ ] **Step 4: Run** `pnpm -r typecheck && pnpm lint && pnpm test` → PASS. **Step 5: Commit** `feat(web): keep gamification progress in local storage, preserved across sync`.

---

### Task 8: Progress engine hook and the quest card on Home

**Files:**
- Create: `apps/web/src/state/progressEvents.ts`, `apps/web/src/state/progress.ts`, `apps/web/src/components/QuestCard.tsx`
- Modify: `apps/web/src/screens/HomeScreen.tsx`, `apps/web/src/index.css`, `apps/web/src/screens/HomeScreen.test.tsx` (mocks gain `useMember`)
- Test: `apps/web/src/state/progress.test.tsx`, `apps/web/src/components/QuestCard.test.tsx`

**Interfaces:**
- Consumes: `stepProgress`, `ProgressEvent`, `summarizeProgress`-free pieces: `questTitle`, `questProgress`, `dayKey`, `nextResetMs`, `getAchievement`; `useGarden`, `useMember`, `useContests` (`state/queries.ts`); `useStorage`, `useStoredData`; `useNow`; `Countdown`.
- Produces: `useProgressEvents` (zustand store: `events: ProgressEvent[]`, `push(events)` capped at 20, `clear()`); `useProgressEngine(): void` (call once per screen that needs fresh progress); `<QuestCard garden={GardenState} />`.

- [ ] **Step 1: Failing tests.**
  - `progress.test.tsx`: mock `../state/queries` (like `Hud.test.tsx`: `vi.mock` returning `useGarden`, `useMember`, `useContests` stubs; garden data `{ garden: makeGarden-like, fetchedAt: ISO }`, member data `{ member, fetchedAt }`). Render a tiny component that calls `useProgressEngine()` inside `renderWithProviders` with a storage holding a link. Fake timers (`Date`, intervals) at a fixed time. Assert: after mount `storage.getSnapshot().progress.quests` has 3 records and none is done; re-rendering/advancing 30 s adds nothing (idempotent); with no garden data nothing is written; when the garden later reports a higher `visitorsServedTotal` than a generated `serve_visitors` target (use a fixed seed = link uuid that yields one; otherwise assert on whichever counting quest exists) the quest becomes done and `useProgressEvents.getState().events` has a `quest_done`.
  - `QuestCard.test.tsx`: renders quest rows from stored progress (set up with `storage.setProgress`): title with the number inside an element having class `num`, progress `2/4` in `.num`, `+25` XP; done row shows a "done" screen-reader text; `water_greenhouse` row has an "I watered it" button which calls `markGreenhouseWatered` on the first marked Greenhouse with the current time (assert storage `greenhouses[plot].lastWateredAt` is set) and the button disappears once done; empty state text; footer shows "Resets in"; an `achievement`/`backfill` event in the store renders a message with a dismiss button that clears it; **mounting the card never calls `setProgress`**.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - `progressEvents.ts`:
    ```ts
    import type { ProgressEvent } from "@garden-hq/core";
    import { create } from "zustand";

    interface ProgressEventsState {
      events: ProgressEvent[];
      push: (events: ProgressEvent[]) => void;
      clear: () => void;
    }
    export const useProgressEvents = create<ProgressEventsState>((set) => ({
      events: [],
      push: (events) => set((s) => ({ events: [...s.events, ...events].slice(-20) })),
      clear: () => set({ events: [] }),
    }));
    ```
  - `progress.ts`:
    ```ts
    import { stepProgress } from "@garden-hq/core";
    import { useEffect } from "react";
    import { useContests, useGarden, useMember } from "./queries";
    import { useProgressEvents } from "./progressEvents";
    import { useStorage, useStoredData } from "./StorageProvider";
    import { useNow } from "./useNow";

    /** Feeds the latest snapshots to stepProgress; writes only when something changed. */
    export function useProgressEngine(): void {
      const storage = useStorage();
      const { link, assignments, greenhouses, timeZone, progress } = useStoredData();
      const garden = useGarden(link?.profileId ?? null);
      const member = useMember(link?.profileId ?? null, link?.uuid ?? null);
      const contests = useContests();
      const now = useNow(30_000);
      const gardenData = garden.data;
      const memberData = member.data;
      const contestList = contests.data?.contests;

      useEffect(() => {
        if (link === null || gardenData === undefined) return;
        const result = stepProgress({
          now, timeZone, seed: link.uuid, progress, assignments, greenhouses,
          garden: gardenData.garden,
          gardenFetchedAt: Date.parse(gardenData.fetchedAt),
          member: memberData?.member ?? null,
          memberFetchedAt: memberData === undefined ? null : Date.parse(memberData.fetchedAt),
          contests: contestList ?? [],
        });
        if (result.progress !== progress) storage.setProgress(result.progress);
        if (result.events.length > 0) useProgressEvents.getState().push(result.events);
      }, [storage, link, gardenData, memberData, contestList, now, timeZone, progress, assignments, greenhouses]);
    }
    ```
    (Confirm the garden response type has `garden` and `fetchedAt`; adjust field names to the real `useGarden` data shape.)
  - `QuestCard.tsx`: `useStoredData` for `progress`, `timeZone`, `greenhouses`; `useStorage`; `useNow(30_000)`; `const today = dayKey(now, timeZone)`; quests = today's records sorted by slot. Row markup: `<li className={done ? "quest done" : "quest"}>` with a decorative `<span className="quest-box" aria-hidden="true" />`, title parts mapped (`typeof part === "number" ? <span className="num">{part}</span> : part`, with keys), progress `<span className="num muted">{current}/{target}</span>` when `questProgress` is non-null and the quest is not done, reward `<span className="quest-xp">+<span className="num">{xp}</span> XP</span>`, `<span className="sr-only">done</span>` when done, and for `water_greenhouse` not done a `<button onClick={() => storage.markGreenhouseWatered(firstPlotId, Date.now())}>I watered it</button>` where `firstPlotId = Object.keys(greenhouses)[0]`. Footer: `<p className="muted">Resets in <Countdown target={nextResetMs(now, timeZone)} />. Quests count from when they appear today.</p>` and `<Link to="/achievements">All achievements</Link>`. Events: render each event from `useProgressEvents` (quest_done → "Quest done: +N XP"; achievement → `Achievement unlocked: {getAchievement(id)?.title} (+N XP)`; backfill → "N achievements already earned (+X XP)") as a `role="status"` list with a Dismiss button calling `clear()`. Empty state when there are no records for today: "No quests yet today. They appear when your Garden syncs."
  - `HomeScreen.tsx`: call `useProgressEngine()` at the top (before the `link === null` early return), and render `<QuestCard garden={state} />` directly after `<DoNextCard garden={state} />`. Update `HomeScreen.test.tsx` mocks to include `useMember`.
  - `index.css`: `.quest-list { list-style: none; padding: 0; margin: 8px 0; }`, `.quest { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: center; padding: 6px 0; }`, `.quest-box` 12x12 px box with the existing border color and no radius; `.quest.done .quest-box` filled with the accent color; `.quest.done .quest-title { text-decoration: line-through; opacity: .7 }`; buttons keep the global `button` style. Use existing CSS variables (read `index.css` top for the names). Must not overflow at 380 px (let the XP wrap under the title if needed).
- [ ] **Step 4: Run** `pnpm -r typecheck && pnpm lint && pnpm test` → PASS. **Step 5: Commit** `feat(web): quest card and progress engine on Home`.

---

### Task 9: HUD level/XP bar and streak flame

**Files:**
- Create: `apps/web/src/components/PlayerBadge.tsx`, `apps/web/src/components/PlayerBadge.test.tsx`
- Modify: `apps/web/src/components/Hud.tsx`, `apps/web/src/components/PixelArt.tsx`, `apps/web/src/index.css`, `apps/web/src/components/Hud.test.tsx` (still passes; add one assertion)

**Interfaces:**
- Consumes: `summarizeProgress`, `dayKey` (core); `useStoredData`; `useNow`; `Link` (react-router).
- Produces: `<PlayerBadge />` (no props); `FlameIcon({ atRisk }: { atRisk: boolean })` in `PixelArt.tsx`.

- [ ] **Step 1: Failing tests** (`PlayerBadge.test.tsx`, `renderWithProviders` with a storage whose progress is built from `EMPTY_PROGRESS` with done quest records or `achievements` XP): shows `Lv` and the level number inside `.num`; the bar has `role="progressbar"` with `aria-valuenow`/`aria-valuemax` equal to `xpIntoLevel`/`xpForNext` and an accessible label "Player XP"; streak number shown; at risk (streak alive, nothing done today) the flame wrapper has class `at-risk` and an `sr-only` "streak at risk" text; no progress → level 1, streak 0 and no at-risk text; the badge links to `/achievements`; at max level the bar is full and shows no `/`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  - `PixelArt.tsx`: add an original 7x9 flame sprite:
    ```tsx
    const FLAME = [
      "...o...",
      "..oo...",
      "..ooo..",
      ".oooyo.",
      ".ooyyo.",
      "ooyyyoo",
      "ooyyyoo",
      ".oyyyo.",
      "..ooo..",
    ];
    export function FlameIcon({ atRisk }: { atRisk: boolean }) {
      return (
        <PixelArt
          rows={FLAME}
          palette={atRisk ? { o: "#868e96", y: "#ced4da" } : { o: "#e8590c", y: "#ffd43b" }}
          size={2}
        />
      );
    }
    ```
  - `PlayerBadge.tsx`: `const s = summarizeProgress(progress, dayKey(now, timeZone))`; 10 bar segments (`filled = s.xpForNext === null ? 10 : Math.floor((10 * s.xpIntoLevel) / s.xpForNext)`); markup `<Link to="/achievements" className="hud-item player-badge" aria-label="Player level and streak">` containing `Lv <span className="num">{level}</span>`, the segmented `<span role="progressbar" ...>`, `<span className="num">{xpIntoLevel}/{xpForNext}</span>` (omit the `/…` at max), and the streak group `<span className={s.atRisk ? "streak at-risk" : "streak"}><FlameIcon atRisk={s.atRisk} /><span className="num">{s.streak}</span>{s.atRisk ? <span className="sr-only">streak at risk, complete a quest today</span> : null}</span>`.
  - `Hud.tsx`: render `<PlayerBadge />` as the last child of the section.
  - `index.css`: `.player-badge { display: inline-flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; }`, `.xp-bar { display: inline-flex; gap: 1px; }`, `.xp-bar i { width: 5px; height: 8px; background: <empty color var>; }`, `.xp-bar i.on { background: <accent var>; }`, `.streak { display: inline-flex; align-items: center; gap: 2px; }`, `.streak.at-risk { opacity: .8; }`. The HUD already wraps; verify at 380 px that the badge wraps onto its own line rather than overflowing (`flex-wrap` on `.hud`).
- [ ] **Step 4: Run** `pnpm -r typecheck && pnpm lint && pnpm test` → PASS. **Step 5: Commit** `feat(web): HUD player level, XP bar and streak flame`.

---

### Task 10: Achievements page

**Files:**
- Create: `apps/web/src/screens/AchievementsScreen.tsx`, `apps/web/src/screens/AchievementsScreen.test.tsx`
- Modify: `apps/web/src/App.tsx` (route `achievements`), `apps/web/src/index.css`

**Interfaces:**
- Consumes: `achievementProgress`, `summarizeProgress`, `dayKey` (core); `useProgressEngine`; `useGarden`, `useMember` (mocked in tests as in Task 8); `useStoredData`; `useNow`.
- Produces: `<AchievementsScreen />` at route `/achievements` (not added to `TabBar`).

- [ ] **Step 1: Failing tests:** with mocked queries and a storage holding a link: header shows Player level, XP into level, best streak (numbers inside `.num`); every achievement renders as a list item; an unlocked one shows its title and "Unlocked" with a date, a locked one shows `value/threshold` (e.g. `7/13`) and is marked locked (`aria-disabled`/class `locked`); while the garden has not loaded locked ones show no progress numbers but unlocked ones still show; the page calls `useProgressEngine` (rendering it triggers quest generation like Home) and a "Back to Home" link exists.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Screen: `useProgressEngine()`; read stored `progress`, `assignments`, `greenhouses`, `timeZone`; `garden = useGarden(...)`, `member = useMember(...)`; `summary = summarizeProgress(progress, dayKey(now, timeZone))`; when `garden.data` is defined compute `achievementProgress({ garden: garden.data.garden, member: member.data?.member ?? null, assignments, greenhouses, summary }, progress.achievements)`, otherwise build the list from `ACHIEVEMENTS` with `value: null`. Render a `card` with `<h2>Achievements</h2>`, the level/XP/best-streak line, then `<ul className="achievements">` of `<li className={unlocked ? "ach" : "ach locked"}>` showing title, description, `+{xp} XP` (`.num`), and either the unlock date (`new Date(at).toLocaleDateString()`) or `value/threshold`. Add `<Route path="achievements" element={<AchievementsScreen />} />` in `App.tsx`. CSS: single-column list on mobile, two columns from 600 px, locked entries dimmed.
- [ ] **Step 4: Run** `pnpm -r typecheck && pnpm lint && pnpm test` → PASS. **Step 5: Commit** `feat(web): Achievements page`.

---

### Task 11: Docs and final verification (controller task)

- [ ] Update the spec: add `expiresAt` to the quest record and `doneQuests` to the archive (implementation additions noted in Task 4); `data/VERIFY.md` entries: Garden snapshot freshness (10-min rule), XP/level numbers are balance guesses, `discovered_greenhouse_crops` may include non-mutation ids (affects the 40-mutation tier), progress is local-only until milestone B.
- [ ] `pnpm -r typecheck && pnpm lint && pnpm format && pnpm test` all green; manual check in the dev server at 380 px (Home quest card, HUD wrap, Achievements) using the `run` skill.
- [ ] Final whole-branch review by an Opus reviewer, then squash-merge to `main`, push, watch CI.

---

## Self-review (spec coverage)

- §1 day keys / records / derived progress → Tasks 2, 4. §2 all seven kinds, generation, verification, expiry → Tasks 2, 3 (contest data from Task 1). §3 XP, levels, streak, achievements, full-XP backfill → Tasks 4, 5, 6. §4 `StoredData.progress` without a version bump → Task 7; ops and D1 are milestone B. §6 UI → Tasks 8–10. §7 streak alert → milestone C. §8 gaps → baseline-at-creation, freshness gate and VERIFY entries in Tasks 1, 2, 11. §9 tests → in every task. Spec items intentionally deferred to B: sync ops, `quest_log`/`achievements` tables, archive from SQL.
- Placeholder scan: Task 2's `QuestRecord`/`QuestContext` bodies refer to the Interfaces block in the same task (copy them verbatim); Task 5's table has 23 rows.
- Type consistency: names in "Plan-level naming" are the only ones used across tasks (`stepProgress` consumes `QuestContext` + `progress` + `assignments`; the web hook passes `seed: link.uuid`).
