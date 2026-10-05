# Phase 2b — Web Dashboard (read-only) Design

**Date:** 2026-10-05 · **Status:** design approved in conversation; awaiting spec review
**Parent:** CLAUDE.md §8 "Phase 2 — read-only dashboard". 2a (Worker API) is merged to `main`; this is 2b.

## Goal

A mobile-first React app that links a Minecraft username through the 2a Worker API and shows the player's Garden: a PixiJS 5x5 plot map with the Barn and visitor queue, a composter panel, and a HUD with the SkyBlock date, season, day/night, next contest and current Mayor. It is read-only with respect to the game; the only things the player writes are local (linked account, per-plot crop assignments, time zone).

## Non-goals

D1, accounts, cron, notifications, planner, Greenhouse, quests/XP, bazaar hints, real sprites, sound, a full Credits or Privacy page (a footer credit link only), visitor requirements / copper (`data/visitors.json` does not exist), compost-bin-full prediction (bin cap unknown, see `data/VERIFY.md`).

## Starting point (verified 2026-10-05)

- `apps/web` is the stock Vite + React 19 template. Deps: react, react-dom, `@garden-hq/core`. No router, query, state or Pixi libraries yet.
- Worker routes: `GET /api/link?name=`, `/api/garden?profile=`, `/api/contests`, `/api/mayor`. Per-IP limit 10 req/min shared by link + garden; cache hits count. Errors use stable codes (`bad_request`, `rate_limited` with `Retry-After`, `missing_api_key`, not found, upstream failures). The implementer must read `apps/worker/src/errors.ts` and the route tests for the exact code names and response shapes and mirror them in the client.
- Core already has: `skyblockDate()`, `isDaytime()` (calendar.ts), `forecastComposter()` (composter.ts), `ALL_PLOTS` / `getPlot()` / `cheapestNextPlot()` (plots.ts), `normalizeContests()`, mayor and profile normalizers, `Contest`, `Mayor`, `GardenState`, `ProfilesResult` types.
- Gaps this spec closes in core: no season on `SkyblockDate`; `GardenState` has no visitor list (only `visitorsServedTotal`); `data/plots.json` x/y are all `null`.
- CI (`.github/workflows/ci.yml`) already runs typecheck/lint/test/build and deploys the Worker and the web `dist` to Cloudflare Pages project `garden-hq-web` on push to `main`. The build does not set `VITE_API_URL` today (see Delivery).

## Architecture

Data flows one way: API client → queries → view-models → screens/map.

### 1. API client — `apps/web/src/api/`

Typed `fetch` wrappers for the four routes. Base URL from `VITE_API_URL` (dev default `http://localhost:8787`). Non-2xx responses and network failures become one `ApiError { code, status, retryAfter? }`. Response types are imported from core, never redeclared in web. No credentials, GET only (matches the Worker's CORS).

### 2. Queries — `apps/web/src/state/queries.ts`

TanStack Query hooks: `useLink`, `useGarden`, `useContests`, `useMayor`.

| Hook | Refetch | Notes |
|---|---|---|
| `useGarden` | 60 s | matches the server cache; disabled until a profile is linked; keeps last good data on error (stale badge) |
| `useContests` | 15 min | |
| `useMayor` | 1 h | |
| `useLink` | on demand (mutation) | |

A "last synced X min ago" label reads the response `fetchedAt` (CLAUDE.md §3). `retry` is off for `rate_limited` and 4xx; one retry otherwise.

### 3. Local state — `apps/web/src/state/`

- `storage.ts` defines a `GardenStorage` interface: `getLink/setLink/clearLink`, `getAssignments/setAssignment`, `getTimeZone/setTimeZone`. The localStorage implementation uses one versioned key (`garden-hq:v1`), wraps every read/write in try/catch, and falls back to in-memory when storage is unavailable. Screens depend on the interface only, so Phase 3 can swap in a D1-backed implementation.
- A small Zustand store holds UI-only state (selected plot, open sheet). Server data lives in Query; persisted data lives in storage; nothing is duplicated between them.
- `useNow()` ticks every second and is the only caller of `Date.now()` in the UI. View-models take `now` as a parameter so tests are deterministic.

### 4. View-models (pure, vitest)

- **Core (`packages/core`)** — pure game logic reused by Worker later:
  - `seasonOf(date: SkyblockDate)` (and `season` exposed on the HUD data) derived from the month; map documented in the function and `// VERIFY:`-flagged if the month→season table isn't confirmed against the wiki.
  - `placeholderPlotGrid()` → `{ cells: Record<plotId, {x, y}>, barn: {x, y} }` for the 5x5 grid.
  - `normalizeGarden()` gains `visitors: { id: string; name: string }[]`.
- **Web (`apps/web/src/viewmodels/`)** — depends on UI/local state:
  - `buildMapViewModel(garden, assignments, now)` → 25 tiles (24 plots + Barn). Plot tile: `{ plotId, x, y, state: 'locked' | 'unlocked' | 'assigned', cropId?, lockedCost: number | null }` (`null` cost renders "cost unknown" for the plots flagged in VERIFY.md). Barn: up to 5 visitor markers + overflow count.
  - `buildHudViewModel(now, contests, mayor, assignedCropIds)` → date, season, day/night, next contest (start, 3 crops, whether it matches an assigned crop), mayor name + perks.
  - `buildComposterViewModel(composter, now)` → fuel and organic-matter fill ratios from `forecastComposter()`, and "fuel runs out at…" / "organic matter runs out at…". No bin-full figure.

### 5. Rendering

React renders HUD and panels as DOM. The Pixi map receives only a `MapViewModel`; it contains no game logic.

## Screens and navigation

React Router, four routes, bottom tab bar on mobile. A footer on every screen: "Not affiliated with Hypixel or Mojang." plus an inline credits line in the footer (plain text with external links: EliteBot and the wiki, and the Strassburger credit link when the contest `source` is the fallback). There is no separate Credits route in 2b. Redirect to `/link` when no link is stored.

- **`/link`** — username input → `useLink`. If the player has several profiles, show a picker with the selected profile preselected. Inline errors for invalid name, not found, `rate_limited` (countdown from `retryAfter`) and `missing_api_key` (developer hint in dev builds only). Success stores the link and navigates to `/`.
- **`/` (Home)** — HUD strip, map, composter panel, visitors panel; one column at 380 px. Shows the sync label and a manual refresh button (disabled while rate-limited).
- **`/contests`** — upcoming contests in the user's time zone (default Europe/Warsaw), filtered to assigned crops; if none assigned yet, shows all contests with a hint. Renders the source credit link.
- **`/settings`** — time zone, switch profile/username, clear local data.

## The map — `apps/web/src/map/`

- `MapScene` class: `mount(canvas)`, `update(viewModel)`, `destroy()`. Pixi v8 `Application` on a `<canvas>`. A thin React component owns the lifecycle and is safe under React 19 strict-mode double mount (mount/destroy are idempotent).
- **Scaling:** a resize observer picks an **integer** scale with nearest-neighbour filtering (CLAUDE.md pixel-art rule); the 5x5 grid must fit and be usable at 380 px width.
- **Art:** generated programmatically — flat-colour pixel tiles, a crop-coloured glyph per crop, a grey lock overlay, a Barn tile, small visitor markers. Original, no ripped textures; replaced by real sprites in Phase 5.
- **Interaction:** tap an unlocked plot → DOM bottom sheet (accessible, testable) to pick a crop → `setAssignment` → map updates. Hover/long-press a locked plot shows its compost cost (or "cost unknown").
- **Placeholder layout:** the real x/y are unknown (`data/plots.json` x/y `null`; see VERIFY.md). `placeholderPlotGrid()` assigns tiles by tier rings around the Barn — tier 1 closest, tier 4 outermost, ordered by plot number within a ring — with a `// VERIFY:` comment and a `VERIFY.md` entry stating it is a stand-in to be replaced when real coordinates exist. Screens and the scene never read `x/y` from `plots.json` directly, only from the view-model, so swapping the source changes one function.
- **No WebGL:** fall back to a DOM list of plots (also the accessible alternative).

## Error handling

Each panel degrades independently: contests or mayor failing shows "unavailable" in that HUD slot while the map still works. A garden failure shows a retry card with the last good data and a stale badge. `rate_limited` disables refresh until `retryAfter` elapses. Storage failures fall back to in-memory with no crash.

## Testing

- **Vitest, fixtures only (no live API):** core additions (`seasonOf`, `placeholderPlotGrid` — all 24 IDs unique and in 5x5 range, Barn centred — and visitor normalization using an extended `garden-response.sample.json`); view-models; `GardenStorage` with a fake `Storage` including throwing implementations; API client with mocked `fetch`, covering each error code.
- **React Testing Library:** link flow (single profile, multiple profiles, each error) and the crop-assignment sheet.
- **`MapScene`:** no pixel tests. Its inputs are covered via the view-model; the scene is smoke-checked in a real browser (run skill) at 380 px and desktop before the phase is called done.
- The web package gets a `test` script so root `pnpm test` includes it (vitest + jsdom).
- Every new core function gets a vitest test (CLAUDE.md §9). No `any` in core.

## Delivery and exit criteria

- `pnpm typecheck`, `pnpm lint`, `pnpm test` green; app usable at 380 px; footer present; `VERIFY.md` updated (placeholder plot layout, visitor commission key format, month→season table if unconfirmed).
- **Deploy gap to resolve in the plan:** CI deploys web to Pages but never sets `VITE_API_URL`, and the Worker's deployed URL is not recorded in the repo. The plan must add `VITE_API_URL` to the CI web build (repo variable or secret) and document the Worker URL/`WEB_ORIGIN` pairing. Until that is set, the deployed site cannot reach the API; local dev works against `wrangler dev`.
- Real-account verification is still blocked on a Hypixel key (2a README). 2b is built and tested on fixtures; the fixtures in `packages/core/fixtures/` are reconstructed, not captured, so real-data issues are expected to surface once a key exists.

## Open items (not blocking the plan)

- Exact Worker error code names and response shapes — read from `apps/worker/src/errors.ts` and route tests during implementation.
- Whether `active_commissions` entries carry a usable visitor name or only an internal id; if only an id, the marker shows a prettified id and the format is `// VERIFY:`-flagged.
- Month→season mapping — confirm against the wiki or flag.
