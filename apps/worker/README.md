# @garden-hq/worker

Hono API on Cloudflare Workers. Routes: `GET /api/link?name=`, `/api/garden?profile=`, `/api/member?profile=&uuid=`, `/api/contests`, `/api/mayor`, `/health`, plus the cloud-save routes `POST /api/account`, `DELETE /api/account`, `GET /api/sync` and `POST /api/sync` (see Cloud save), plus the alerts routes `GET /api/alerts`, `PUT/DELETE /api/alerts/webhook`, `POST /api/alerts/test` and `PUT /api/alerts/rules`.

## Deployed URL

Production API: `https://garden-hq-worker.zavika.workers.dev` (workers.dev). Set as the GitHub repo variable `VITE_API_URL`.

## Secrets & vars

- `HYPIXEL_API_KEY` — **secret**, never in `wrangler.toml` or the browser:
  `pnpm --filter @garden-hq/worker exec wrangler secret put HYPIXEL_API_KEY`
- `WEB_ORIGIN` (var) — the only origin allowed by CORS.
- `VITE_API_URL` (**GitHub repo variable**, not a Worker var) — the Worker URL above, without a trailing slash. The CI web builds read it as `vars.VITE_API_URL` and bake it into the web app; if unset, a production build calls its own origin and the API requests fail. Set with:
  `gh variable set VITE_API_URL --body "https://garden-hq-worker.zavika.workers.dev"`
- `ENVIRONMENT=dev` (local `.dev.vars` only) — additionally allows `http://localhost:5173`.

## Bindings

- `CACHE` (KV) — public data cache (election, contests) and the dev-only fallback limiter.
- `RATE_LIMITER` — 10 req/min per IP for link, garden, member and account creation.
- `CODE_LIMITER` — 30 req/min per IP for every request that presents a sync code.
- `DB` (D1 database `garden-hq`, id in `wrangler.toml`) — cloud-save accounts and data.

## D1 migrations

```
pnpm --filter @garden-hq/worker exec wrangler d1 migrations apply DB --local
pnpm --filter @garden-hq/worker exec wrangler d1 migrations apply DB --remote
```

Migrations: `0001_init.sql` (accounts, plot_assignments, greenhouses) and `0002_ops_budget.sql` (per-account daily write counters `ops_day` / `ops_count`, and the `account_creations` log with an index on `created_at`). `0003_alerts.sql` adds `alert_settings`, `garden_snapshot` and `alert_log`. `0004_progress.sql` adds `quest_log` and `achievements` (gamification progress). They are applied to the LOCAL database only. The remote database gets them from the "Apply D1 migrations" step in CI (deploy job, before "Deploy worker") on the first deploy from `main`.

**OWNER ACTION: the `CLOUDFLARE_API_TOKEN` GitHub secret must include the `D1 -> Edit` permission, otherwise the migration step fails and the deploy stops.**

## Cloud save

- `POST /api/account` creates an account (requires a linked profile) and returns a sync code once. `DELETE /api/account` deletes it and all its data.
- `GET /api/sync` returns the stored state (ETag / 304). `POST /api/sync` applies a batch of ops (idempotent, last write wins by server time).
- Auth is `Authorization: Bearer <sync code>`; no cookies.
- Sync codes are stored **only as SHA-256**. There is **no recovery**: a lost code means the cloud data is unreachable. The player can start a new account.
- `POST /api/sync` applies the ops and the revision bump in ONE atomic `db.batch` (at most 41 statements). Max 40 ops per request (`MAX_OPS_PER_REQUEST` in core), body limit 64 KB.

## First deploy checklist (owner)

Not yet done; the Worker with cloud save has not been deployed. After the first deploy from `main`:

1. `wrangler tail`: no `unhandled` events and CPU time under 10 ms (free plan) on `POST /api/sync`, including a 40-op request.
2. Confirm D1 accepts the batch of 41 statements (no query-limit error).
3. `wrangler d1 info garden-hq`: check row count and size.

## Discord alerts (cron)

- `wrangler.toml` `[triggers] crons = ["*/5 * * * *"]`. `scheduled()` calls `scheduledSync` -> `runSync` in `src/cron.ts`.
- Each run: up to `CRON_BATCH` (10) due accounts, at most `MAX_HYPIXEL_CALLS_PER_RUN` (8) Hypixel calls, a counted subrequest budget of `SUBREQUEST_BUDGET` (40 of the free plan's 50), and a stored garden under 5 minutes old is reused instead of refetched. Constants live in `src/limits.ts`.
- Alerts are **claimed** in `alert_log` (`INSERT OR IGNORE`) before they are sent, so overlapping runs cannot double send. A Discord 5xx/429/network failure releases the claim and retries next run; a 404/401 marks the webhook dead (the player must add a new one in Settings -> Alerts).
- Free-plan capacity is about 8 alerting players: `MAX_ALERTING_ACCOUNTS` (8) accounts may hold a webhook (during the hourly contest surge every account needs a fresh snapshot and a run makes at most 8 Hypixel calls), and accounts with no authenticated request (pull or push) for 60 days are skipped. `authenticate` bumps `last_seen_at` at most once per day per account.
- The webhook URL is a secret: stored in D1 only, never returned, never logged. Log lines are `cron_run` (counts only), `hypixel_key_rejected`, `webhook_dead`, `cron_account_failed` (error name only), `cron_contests_unavailable`, `discord_rejected`, `cron_reschedule_failed` and `cron_failed`. The cron trigger is only confirmed by a real deploy (`wrangler deploy --dry-run` doesn't print the schedule), the dashboard's Triggers tab, or the first `cron_run` log line.

## Rotating the Hypixel API key

Alerts depend on `HYPIXEL_API_KEY`. **Development keys are temporary**; when one expires, the cron's Hypixel calls fail with 403 and alerts stop. Hypixel's 401 and 403 are both treated as "key rejected". The cron logs `hypixel_key_rejected` and stops the run instead of burning calls.

1. Create a new key at developer.hypixel.net.
2. `pnpm --filter @garden-hq/worker exec wrangler secret put HYPIXEL_API_KEY` and paste it. No redeploy needed.
3. Check that `GET /api/garden?profile=...` works for a linked profile and that `wrangler tail` shows `cron_run` without `hypixel_key_rejected`.

A **production (application) key** from Hypixel is required before anyone but the owner uses alerts.

## First cron deploy checklist (owner)

After the first deploy that contains the Cron Trigger:

1. `wrangler tail`: at the next `*/5` tick, a `cron_run` line appears, with no `unhandled`/`cron_failed`.
2. **CPU time under 10 ms** per cron invocation (free plan). If it is over, lower `CRON_BATCH` / `MAX_HYPIXEL_CALLS_PER_RUN` in `src/limits.ts`. This is the biggest unmeasured risk.
3. `subrequests` in `cron_run` stays <= 40 and no "Too many subrequests" error appears.
4. Settings -> Alerts -> paste a webhook -> "Send test message" arrives in Discord; then trigger a real alert (e.g. lower the visitor threshold with visitors in the queue) and confirm exactly one message.
5. `wrangler d1 info garden-hq`: row counts and size look sane.

## Local dev

`cp .dev.vars.example .dev.vars`, fill in a key, then `pnpm --filter @garden-hq/worker dev`.
Without a key `/api/contests` and `/api/mayor` still work; `/api/link` and `/api/garden` return `missing_api_key`. If Hypixel rejects the key (403) they return `bad_api_key` and the Worker logs Hypixel's `cause` as a `hypixel_forbidden` event.

## Limits

Per-IP 10 req/min (shared by link + garden + member + account creation); 60 s per-player cache; contests 15 min; mayor 1 h. Requests that present a sync code: 30 req/min per IP (`CODE_LIMITER`), where a failed lookup costs 5 in total. `POST /api/sync`: max 40 ops, body limit 64 KB, one atomic batch of at most 41 statements. An invalid op is skipped, not fatal: the valid ones are applied and the response carries `rejected: N` (only structural errors, such as a non-array `ops`, more than 40 ops or an oversized body, return 400). Write budgets (`src/limits.ts`, tunable guesses against the free plan's 100k rows/day): each account may apply `MAX_OPS_PER_ACCOUNT_PER_DAY` = 1000 ops per UTC day, and at most `MAX_ACCOUNTS_CREATED_PER_DAY` = 50 accounts are created per rolling 24 h; both answer 429 `rate_limited`. The creation cap counts rows in `account_creations` (no account id, no PII), so it survives account deletion: create, spend, delete, create cannot evade it. Account creation costs rate-limit + count + one 2-statement batch (account row + creation row). The cap bounds creations, not live accounts, so the real daily ceiling is live accounts x 1,000 ops. Alerts: see 'Discord alerts (cron)'.
