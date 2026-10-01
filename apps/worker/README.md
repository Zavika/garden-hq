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
