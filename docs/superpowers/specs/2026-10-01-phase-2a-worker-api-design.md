# Phase 2a — Worker API (read-only) Design

**Date:** 2026-10-01 · **Status:** approved in chat, pending written-spec review
**Parent:** CLAUDE.md §8 "Phase 2 — read-only dashboard". Phase 2 is split into 2a (this, Worker API) and 2b (web dashboard, separate spec).

## Goal

A Hono Worker exposing read-only JSON routes the web app consumes: link a Minecraft username, fetch the normalized Garden, contests, and mayor. Fixture-driven: built and tested with no Hypixel key; the key is added later as a Worker secret.

## Non-goals

D1, cron, alerts, auth, push (Phase 3+); any web UI (2b); plot grid x/y (still null in `data/plots.json`, flagged as a 2b blocker); bazaar (Phase 5).

## Routes

| Route | Behaviour | Caching |
|---|---|---|
| `GET /api/link?name=` | Mojang name → UUID, Hypixel `/v2/skyblock/profiles?uuid=`, pick selected profile. Returns `{ uuid, name, profileId, profiles[] }` | `no-store` |
| `GET /api/garden?profile=` | Hypixel `/v2/skyblock/garden?profile=`, `normalizeGarden()`, returns `GardenState` + `fetchedAt` | `no-store` (per-player) |
| `GET /api/contests` | EliteBot `/contests/at/now`, fallback strassburger. Returns normalized list + `source` (for the required credit link) | KV, short TTL |
| `GET /api/mayor` | Hypixel `/v2/resources/skyblock/election` → current mayor + perks | KV, short TTL |
| `GET /health` | existing | none |

Every success body includes `fetchedAt` (ISO) so the UI can show "last synced X min ago".

## Structure (`apps/worker/src/`)

- `hypixel.ts` — client; takes `{ fetch, apiKey }`. Sends `API-Key` header, reads `RateLimit-*` headers, retries 429/5xx with capped backoff (honouring `Retry-After`).
- `mojang.ts` — username → UUID (204/404 → `unknown_player`).
- `contests.ts` — EliteBot primary, strassburger fallback, normalized to one shape.
- `routes/{link,garden,contests,mayor}.ts` — Hono sub-apps; thin: call client → core normalizer → JSON.
- `errors.ts` — typed error → HTTP mapping.
- `env.ts` — `Env` type: `HYPIXEL_API_KEY` (secret), `CACHE` (KV).
- `packages/core`: add pure `normalizeProfiles(raw)` (selected profile + list; all fields optional) and `normalizeContests`/`normalizeMayor`, each with fixture tests. No fetch in core.

All upstream calls go through an injected `fetch`, so tests never touch the network.

## Errors

Uniform body `{ error: { code, message } }`:
`unknown_player` 404 · `no_garden` 404 · `bad_request` 400 · `rate_limited` 429 (with `retryAfter`) · `upstream_down` 502 · `missing_api_key` 500 (misconfiguration). Missing optional upstream fields never throw; they normalize to defaults.

## Data / fixtures

New fixtures in `packages/core/fixtures/`: Mojang profile, Hypixel profiles response, EliteBot contests, election response. Like the existing garden fixture they are reconstructed from public docs, not captured; `data/VERIFY.md` gets an entry to swap them for real captures once a key exists. Unconfirmed upstream paths (e.g. farming skill XP path in profiles) are `// VERIFY:`-marked and listed there.

## Testing

Vitest, fake `fetch` driven by fixtures. Per route: happy path + at least one error path. Client: retry/backoff (fake timers), rate-limit header handling, missing-key. Contests: primary-fails-fallback-used. Core normalizers: fixtures plus empty/malformed input. `pnpm typecheck`, `test`, `lint`, `format` must pass.

## Deploy

`wrangler.toml` gains the `CACHE` KV binding; `HYPIXEL_API_KEY` documented as `wrangler secret put`. CI already typechecks/tests; deploy step unchanged.

## Open questions (carried into the plan, not blocking)

- KV TTLs (proposed: contests 60 s, mayor 1 h).
- strassburger fallback needs a visible credit link — surfaced via `source` and rendered in 2b/credits page.
