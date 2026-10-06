# @garden-hq/worker

Hono API on Cloudflare Workers. Routes: `GET /api/link?name=`, `/api/garden?profile=`, `/api/member?profile=&uuid=`, `/api/contests`, `/api/mayor`, `/health`.

## Deployed URL

Production API: `https://garden-hq-worker.zavika.workers.dev` (workers.dev). Set as the GitHub repo variable `VITE_API_URL`.

## Secrets & vars

- `HYPIXEL_API_KEY` — **secret**, never in `wrangler.toml` or the browser:
  `pnpm --filter @garden-hq/worker exec wrangler secret put HYPIXEL_API_KEY`
- `WEB_ORIGIN` (var) — the only origin allowed by CORS.
- `VITE_API_URL` (**GitHub repo variable**, not a Worker var) — the Worker URL above, without a trailing slash. The CI web builds read it as `vars.VITE_API_URL` and bake it into the web app; if unset, a production build calls its own origin and the API requests fail. Set with:
  `gh variable set VITE_API_URL --body "https://garden-hq-worker.zavika.workers.dev"`
- `ENVIRONMENT=dev` (local `.dev.vars` only) — additionally allows `http://localhost:5173`.

## Local dev

`cp .dev.vars.example .dev.vars`, fill in a key, then `pnpm --filter @garden-hq/worker dev`.
Without a key `/api/contests` and `/api/mayor` still work; `/api/link` and `/api/garden` return `missing_api_key`. If Hypixel rejects the key (403) they return `bad_api_key` and the Worker logs Hypixel's `cause` as a `hypixel_forbidden` event.

## Limits

Per-IP 10 req/min (shared by link + garden + member); 60 s per-player cache; contests 15 min; mayor 1 h.
