# Phase 5B Privacy and Credits Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/privacy` and `/credits` pages, linked from the footer and Settings, reachable without a linked account, with privacy content kept honest by a drift test against the D1 migrations.

**Architecture:** Page content lives in typed data modules (`apps/web/src/pages/privacy.ts`, `data/credits.json`) rendered by two small screens. A node-environment test parses `apps/worker/migrations/*.sql` for `CREATE TABLE` names and fails if a table is neither described in the privacy data nor on an explicit "no personal data" list, so future migrations (push subscriptions in 5E) force a privacy update.

**Tech Stack:** React 19, react-router-dom, Vitest (+ Testing Library), JSON data.

**Spec:** `docs/superpowers/specs/2026-11-10-phase-5-polish-design.md` (section 3, 5B).

## Global Constraints

- Privacy contact is exactly `https://github.com/Zavika/garden-hq/issues` (a constant `PRIVACY_CONTACT_URL`; an empty or invalid value must fail a test).
- Keep the footer line "Not affiliated with Hypixel or Mojang." and the dynamic contest-source credit from `/api/contests`.
- The pages are plain-language notices, not legal advice; say nothing that the code does not do (facts below were audited 2026-11-10 against `apps/worker/migrations`, `apps/web/src/state/storage.ts`, `sync.ts`).
- `/privacy` and `/credits` must render for users with no linked account (Layout currently redirects unlinked users to `/link` except `/settings`).
- Public repo: no personal data, no secrets. Mobile-first (works at 380 px). TS strict, no `any`, Prettier, typecheck/lint/test pass.

## Audited facts (use as content; do not add claims)

Stored in the browser (localStorage): `garden-hq:v1` = linked Minecraft username and UUID, selected SkyBlock profile, plot crop assignments, Greenhouse layout and timers, quest/XP progress, time zone; `garden-hq:sync:v1` = your sync code and changes waiting to upload. No cookies. No analytics. No advertising.

Stored on the server (Cloudflare D1), only after you turn on Cloud save (and Alerts): `accounts` (Minecraft UUID and name, selected profile and profile list, time zone, last-seen date, daily change counter, sync code stored only as a hash), `plot_assignments`, `greenhouses`, `quest_log`, `achievements`, `garden_snapshot` (latest copy of your Hypixel Garden data, replaced on each sync), `alert_settings` (Discord webhook URL, which alerts are on), `alert_log` (which alerts were already sent, so none repeats), `account_creations` (timestamps only, used to rate-limit account creation; holds no identifiers). The webhook URL is stored in the database, is never shown again and is never logged. IP addresses are used by Cloudflare to deliver the site and by the rate limiter; the app does not store them in the database.

Retention: data is kept until you delete it. There is no automatic deletion yet; accounts with no activity for 60 days are only skipped by the alert checker. Deleting: Settings -> Cloud save -> delete the cloud copy removes every row listed above for your account. Clearing your browser data removes the local copy.

Who receives data: Hypixel API (your profile id/UUID is sent from our server to fetch your Garden), Mojang API (username lookup when you link), EliteBot (contest schedule; no personal data sent), Discord (alert text, to the webhook you provide), Cloudflare (hosting, Workers, D1, KV, logs).

Public facts: Minecraft usernames and UUIDs are public information; the app only reads what the public Hypixel API returns for the name you enter.

Credits list (`data/credits.json`): EliteBot contest API (https://api.elitebot.dev) - Jacob's Contest schedule; SkyBlock wiki (https://hypixelskyblock.minecraft.wiki) - game facts; SkyHanni - plot layout reference (https://github.com/hannibal002/SkyHanni); Hypixel Public API (https://developer.hypixel.net); Mojang API (https://minecraft.wiki/w/Mojang_API); libraries: React, Vite, PixiJS, Hono, Cloudflare Workers. Plus an optional `spriteArtist` string, empty by default (the owner fills it in), rendered as "Sprites by <name>" only when non-empty. The Jacob's Contest fallback source (strassburger) is credited only if the app uses it: check `apps/worker/src/contests.ts`; if it is a live fallback include "Jacob's Contest fallback: https://jacobs.strassburger.dev" in the sources, otherwise omit it.

---

### Task 1: Credits page, routes, layout and links

**Files:**
- Create: `data/credits.json`, `apps/web/src/pages/CreditsScreen.tsx`, `apps/web/src/pages/CreditsScreen.test.tsx`, `apps/web/src/components/PublicPageLinks.tsx`
- Modify: `apps/web/src/App.tsx` (route `credits`), `apps/web/src/components/Layout.tsx`, `apps/web/src/components/Layout.test.tsx`, `apps/web/src/components/Footer.tsx`, `apps/web/src/screens/SettingsScreen.tsx`, `apps/web/src/index.css` (only if needed)

**Interfaces:**
- Produces: `data/credits.json` shape `{ "spriteArtist": "", "sources": [{ "name": string, "url": string, "use": string }], "libraries": [{ "name": string, "url": string }] }`; route `/credits`; `PublicPageLinks` rendering `<nav aria-label="About">` with links "Privacy" (`/privacy`) and "Credits" (`/credits`), used by Footer and Settings.

- [ ] **Step 1: Failing tests.** CreditsScreen: heading "Credits"; every source in `data/credits.json` as a link with `target="_blank" rel="noreferrer"`; the libraries list; the line "Not affiliated with Hypixel or Mojang."; with `spriteArtist` empty no "Sprites by" text; with an injected non-empty value (optional prop `data` defaulting to the JSON) "Sprites by Alice" appears; the dynamic contest source (`useContests`, mocked the way the existing Footer/Layout tests do it) shows its name when present. Layout test: an unlinked user at `/privacy` and `/credits` is NOT redirected to `/link` (follow the existing Layout.test patterns).
- [ ] **Step 2: Implement** `data/credits.json`, `CreditsScreen` (import the JSON the same way other `data/*.json` files are imported in `apps/web`; check and follow existing usage), `PublicPageLinks`, the Layout exception (`/privacy` and `/credits` alongside the `/settings` exception), Footer (the disclaimer exactly as before, the existing dynamic contest-source credit, and `<PublicPageLinks />`; remove the now-duplicated static wiki/SkyHanni sentence since the credits page carries it), Settings (render `<PublicPageLinks />` at the bottom of the card), route `credits`.
- [ ] **Step 3:** run web tests, typecheck, lint. Commit `feat: credits page, public-page links, layout exception`.

---

### Task 2: Privacy page with drift test

**Files:**
- Create: `apps/web/src/pages/privacy.ts`, `apps/web/src/pages/PrivacyScreen.tsx`, `apps/web/src/pages/PrivacyScreen.test.tsx`, `apps/web/src/pages/privacy.drift.test.ts`
- Modify: `apps/web/src/App.tsx` (route `privacy`), `data/VERIFY.md` (a "Privacy page (Phase 5B)" note: text audited 2026-11-10, update when storage changes), `apps/worker/README.md` (one line: adding a D1 table requires updating `apps/web/src/pages/privacy.ts`; a test enforces it)

**Interfaces:**
- Consumes: `PublicPageLinks` from Task 1.
- Produces (`privacy.ts`):
  ```ts
  export const PRIVACY_CONTACT_URL = "https://github.com/Zavika/garden-hq/issues";
  export interface StoredTable { table: string; what: string }
  export const SERVER_TABLES: readonly StoredTable[];        // accounts, plot_assignments, greenhouses, quest_log, achievements, garden_snapshot, alert_settings, alert_log
  export const NO_PERSONAL_DATA_TABLES: readonly string[];   // ["account_creations"] (timestamps only)
  export const BROWSER_KEYS: readonly { key: string; what: string }[]; // garden-hq:v1, garden-hq:sync:v1
  export const RECIPIENTS: readonly { name: string; what: string }[]; // Hypixel, Mojang, EliteBot, Discord, Cloudflare
  ```

- [ ] **Step 1: Failing tests.**
  (a) `privacy.drift.test.ts` with `// @vitest-environment node`: read every `apps/worker/migrations/*.sql` (resolve relative to the test file with `fileURLToPath(new URL(..., import.meta.url))`), extract table names with `/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/gi`, remove names from `DROP TABLE` statements, and assert every remaining table is in `SERVER_TABLES` or `NO_PERSONAL_DATA_TABLES`, and every name listed in those two exports exists in the migrations (no stale entries). Also assert the keys in `BROWSER_KEYS` equal the `STORAGE_KEY` constant in `apps/web/src/state/storage.ts` and the `KEY` constant in `apps/web/src/state/sync.ts` (read both files as text and regex `const STORAGE_KEY = "..."` / `const KEY = "..."`). Needs `/// <reference types="node" />` like the existing sprite tests.
  (b) `PrivacyScreen.test.tsx`: heading "Privacy"; every table's description rendered; the contact link `href` equals the constant with `target="_blank" rel="noreferrer"`; the statements "No cookies", "No analytics", "No advertising" present; the deletion instructions mention "Settings" and "Cloud save"; `PRIVACY_CONTACT_URL` parses with `new URL`, protocol `https:`, non-empty pathname.
- [ ] **Step 2: Implement** `privacy.ts` (plain English, second person, short sentences, from the audited facts), `PrivacyScreen.tsx` (headings: What we store in your browser; What we store on our server (only if you turn on Cloud save); Retention and deleting your data; Who else receives data; What we do not do; Contact; plus a "Last updated 2026-11-10" line and `<PublicPageLinks />`), route `privacy`, VERIFY.md and README lines.
- [ ] **Step 3:** run web tests, typecheck, lint, `pnpm --filter @garden-hq/web build`. Commit `feat: privacy page with migration drift test`.
