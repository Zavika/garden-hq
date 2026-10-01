# Phase 2a — Worker API (read-only) Design

**Date:** 2026-10-01 · **Status:** approved with changes (2026-10-01); changes folded in below
**Parent:** CLAUDE.md §8 "Phase 2 — read-only dashboard". Phase 2 is split into 2a (this, Worker API) and 2b (web dashboard, separate spec).

## Goal

A Hono Worker exposing read-only JSON routes the web app consumes: link a Minecraft username, fetch the normalized Garden, contests, and mayor. Fixture-driven: built and tested with no Hypixel key; the key is added later as a Worker secret.

## Non-goals

D1, cron, alerts, auth, push (Phase 3+); any web UI (2b); plot grid x/y (still null in `data/plots.json`, flagged as a 2b blocker); bazaar (Phase 5).

## Routes

| Route | Behaviour | Caching |
|---|---|---|
| `GET /api/link?name=` | Validate name, Mojang name → UUID, Hypixel `/v2/skyblock/profiles?uuid=`, pick selected profile. Returns `{ uuid, name, profileId, profiles[] }` | browser `no-store`; server KV 60 s per lowercased name |
| `GET /api/garden?profile=` | Validate UUID, Hypixel `/v2/skyblock/garden?profile=`, `normalizeGarden()`, returns `GardenState` + `fetchedAt` | browser/edge `no-store`; server KV 60 s per profile |
| `GET /api/contests` | EliteBot `/contests/at/now`, fallback strassburger. Returns normalized list + `source` (for the required credit link) | KV, 15 min |
| `GET /api/mayor` | Hypixel `/v2/resources/skyblock/election` → current mayor + perks | KV, 1 h |
| `GET /health` | existing | none |

Every success body includes `fetchedAt` (ISO) so the UI can show "last synced X min ago". On a KV cache hit, `fetchedAt` is the time of the original upstream fetch, not the request time. `/api/garden` returns `{ garden, fetchedAt }`.

## Abuse protection

`/api/link` and `/api/garden` spend our Hypixel key, so:

- **Per-IP rate limit:** 10 req/min on `/api/link` and `/api/garden` (combined bucket), keyed on `CF-Connecting-IP`. Implemented with the Cloudflare rate-limit binding if available, else a KV counter (fixed window). Exceeded → `rate_limited` 429 with `Retry-After`. The limiter runs before any upstream call; cache hits still count, so refresh spam is throttled too.
- **Per-name/profile cache (60 s):** KV, keyed by lowercased name (`/api/link`, since the uuid is unknown until Mojang responds) or profile id (`/api/garden`). Repeated refreshes inside the window never reach Hypixel.
- **Note on CLAUDE.md §3** ("never edge-cache per-player endpoints"): this is a short server-side KV cache of our own normalized output, chosen explicitly to protect the key. Responses to clients and the Cloudflare edge stay `Cache-Control: no-store`, so no per-player data is shared via the HTTP edge cache. Cache keys contain only public identifiers (lowercased name / profile id), never the API key.

## Input validation

Checked in the route before any limiter-expensive or upstream work; failure → `bad_request` 400.

- `name` must match `^[A-Za-z0-9_]{1,16}$`.
- `profile` must be a valid UUID (dashed or undashed hex, 32 hex digits; normalized to one form for cache keys).

## CORS

Allow only the web app origin (`WEB_ORIGIN` var in `wrangler.toml`) plus `http://localhost:5173` in dev (enabled only when `ENVIRONMENT=dev`). Hono `cors()` middleware, `GET`/`OPTIONS` only, no credentials. Other origins get no `Access-Control-Allow-Origin` header.

## Logging

Never log the API key, request headers, or full upstream URLs. Log only route, upstream host + path template (e.g. `hypixel /v2/skyblock/garden`), status, and latency. The key travels in the `API-Key` header (never in a URL); `hypixel.ts` additionally redacts it from any error message it surfaces. A test asserts no log line or error body contains the key.

## Structure (`apps/worker/src/`)

- `hypixel.ts` — client; takes `{ fetch, apiKey }`. Sends `API-Key` header, reads `RateLimit-*` headers, retries 429/5xx with capped backoff (honouring `Retry-After`).
- `mojang.ts` — username → UUID (204/404 → `unknown_player`).
- `contests.ts` — EliteBot primary, strassburger fallback, normalized to one shape.
- `routes/{link,garden,contests,mayor}.ts` — Hono sub-apps; thin: call client → core normalizer → JSON.
- `errors.ts` — typed error → HTTP mapping.
- `env.ts` — `Env` type: `HYPIXEL_API_KEY` (secret), `CACHE` (KV), `WEB_ORIGIN`, `ENVIRONMENT`.
- `middleware/{cors,ratelimit}.ts`, `validate.ts`, `log.ts`.
- `packages/core`: add pure `normalizeProfiles(raw)` (selected profile + list; all fields optional) and `normalizeContests`/`normalizeMayor`, each with fixture tests. No fetch in core.

All upstream calls go through an injected `fetch`, so tests never touch the network.

## Errors

Uniform body `{ error: { code, message } }`:
`unknown_player` 404 · `no_garden` 404 · `bad_request` 400 · `rate_limited` 429 (with `retryAfter`; covers both our per-IP limit and upstream 429) · `upstream_down` 502 · `missing_api_key` 500 (misconfiguration) · `internal` 500 (unexpected error). Missing optional upstream fields never throw; they normalize to defaults.

## Data / fixtures

New fixtures in `packages/core/fixtures/`: Mojang profile, Hypixel profiles response, EliteBot contests, election response. Like the existing garden fixture they are reconstructed from public docs, not captured; `data/VERIFY.md` gets an entry to swap them for real captures once a key exists. Unconfirmed upstream paths (e.g. farming skill XP path in profiles) are `// VERIFY:`-marked and listed there.

## Testing

Vitest, fake `fetch` driven by fixtures. Per route: happy path + at least one error path. Client: retry/backoff (fake timers), rate-limit header handling, missing-key. Contests: primary-fails-fallback-used. Validation (good/bad names and UUIDs), rate limiter (11th request in a window → 429, window reset), cache (second call within 60 s makes no upstream request), CORS (allowed vs disallowed origin, dev-only localhost), key never appears in logs/errors. Core normalizers: fixtures plus empty/malformed input. `pnpm typecheck`, `test`, `lint`, `format` must pass.

## Deploy

`wrangler.toml` gains the `CACHE` KV binding, `WEB_ORIGIN`, and the rate-limit binding (if used); `HYPIXEL_API_KEY` documented as `wrangler secret put`. CI already typechecks/tests; deploy step unchanged.

## Resolved decisions

- KV TTLs: contests 15 min, mayor 1 h, uuid/profile 60 s.
- strassburger fallback needs a visible credit link — surfaced via `source` and rendered in 2b/credits page.

## Open (non-blocking, decide in plan)

- Rate-limit binding vs KV counter: binding preferred if available on the account's plan; KV counter is the fallback and is approximate under concurrency (acceptable for abuse protection).
