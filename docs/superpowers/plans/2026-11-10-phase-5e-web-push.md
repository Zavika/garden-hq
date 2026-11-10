# Phase 5E Web Push Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the existing alerts through Web Push (to up to 3 devices per account) in addition to, or instead of, Discord, with no Discord account required. The owner uses an iPhone: push only works there after "Add to Home Screen" (iOS 16.4+).

**Architecture:** D1 migration `0005_push.sql` adds `push_subscriptions` and `alert_settings.push_ok`. A WebCrypto-only module `apps/worker/src/notify/webpush.ts` implements RFC 8291 (aes128gcm payload encryption) and RFC 8292 (VAPID ES256 JWT), tested against the RFC 8291 Appendix A vectors. The cron's claim-first dedupe is unchanged; after a claim is won the alert goes to every usable channel (Discord webhook and/or push subscriptions). Web: the service worker (Phase 5D) gains `push` and `notificationclick` handlers; Settings gets a Push section that respects iOS install-first.

**Tech Stack:** Cloudflare Workers (WebCrypto, D1, Hono), React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-phase-5-polish-design.md` (section 6 and decisions 6, 7, 8).

## Global Constraints

- **Public repo: never commit secrets.** VAPID keys come from `wrangler secret` (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`); `VAPID_SUBJECT` is a plain var (an `https:` URL; default to `WEB_ORIGIN`). `.dev.vars.example` carries placeholders only. The key-pair script prints to the terminal and writes nothing to disk. Tests use freshly generated throwaway keys or the public RFC vectors only. Push endpoints and keys are never logged and never returned by any route.
- Until the owner sets the secrets, push is **unavailable but harmless**: `GET /api/alerts` reports `push.available: false`, push routes answer a clear `bad_request`/`unavailable` error, the UI shows "Push alerts aren't set up on this server yet", the cron skips push entirely. Everything must deploy and run green without keys.
- Max **3 devices** per account (oldest dropped when a 4th is added). `deleteAccount` removes all of an account's subscriptions. Subscriptions are deleted when the push service answers 404/410.
- Endpoint allowlist (SSRF), enforced at subscribe time AND at send time: `https:` only, no credentials/port other than 443, host must be exactly or end with one of: `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com` (match on `host === d || host.endsWith("." + d)`). Anything else is rejected.
- No push library: WebCrypto only. Payload JSON `{ title, body, tag, url }`; `tag` = `${type}:${key}` truncated; `url` = `/`. Headers: `Content-Encoding: aes128gcm`, `TTL: 3600`, `Urgency: normal`, `Authorization: vapid t=<jwt>, k=<publicKey b64url>`. VAPID JWT: ES256, claims `aud` (origin of the endpoint), `exp` = now + 12 h (never more than 24 h), `sub` = `VAPID_SUBJECT`; cache the signed JWT per audience in memory until 1 h before expiry.
- One alert text for both channels: add `alertText(candidate, syncedAt, now)` to `packages/core/src/alerts.ts` returning `{ title, detail, footer }` and make `alertEmbed` (Discord) and the push payload use it.
- Capacity: `MAX_ALERTING_ACCOUNTS` (8) now counts accounts with ANY channel (webhook or at least one subscription).
- Budget: every push is one subrequest, charged to the cron budget. Affordability reserves must account for the account's actual number of channel sends (webhook 0/1 + subscriptions up to 3).
- The privacy page must list `push_subscriptions` (the drift test enforces it) and push services as recipients; update `data/VERIFY.md` and `apps/worker/README.md` (setup, rotation: rotating the VAPID key invalidates all subscriptions).
- iOS: the push toggle says exactly **"Add to Home Screen first"** (with the explanation `IOS_PUSH_NOTE` from `apps/web/src/pwa/platform.ts`) on iOS Safari when not installed (`isIos()` && `!isStandalone()`).
- TS strict, no `any`, Prettier, typecheck/lint/test/build pass; avoid log lines containing endpoints.

---

### Task 1: Migration, core text, DB layer, privacy data

**Files:**
- Create: `apps/worker/migrations/0005_push.sql`, `apps/worker/src/alerts/push.ts` (+ `push.test.ts`)
- Modify: `apps/worker/src/alerts/db.ts` (+ its test), `apps/worker/src/sync/db.ts` (`deleteAccount`), `apps/worker/src/limits.ts` (`MAX_PUSH_DEVICES = 3`), `packages/core/src/alerts.ts` (+ test: `alertText`), `packages/core/src/api.ts` (`AlertsStateResponse.push`), `apps/worker/src/notify/discord.ts` (`alertEmbed` uses `alertText`), `apps/web/src/pages/privacy.ts` (+ its tests), `data/VERIFY.md`

**Interfaces:**
- Migration:
  ```sql
  CREATE TABLE push_subscriptions (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, endpoint)
  );
  ALTER TABLE alert_settings ADD COLUMN push_ok INTEGER; -- NULL = never tested, 1 = a test push went through
  ```
- Produces (`alerts/push.ts`):
  ```ts
  export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string; createdAt: number }
  export function isAllowedPushEndpoint(value: unknown): value is string;           // allowlist per Global Constraints
  export function parsePushSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | null; // validates endpoint, base64url keys (p256dh decodes to 65 bytes starting 0x04, auth to 16 bytes), caps lengths
  export async function listSubscriptions(db: D1Database, accountId: string): Promise<PushSubscriptionRow[]>;
  export async function upsertSubscription(db: D1Database, accountId: string, sub: {endpoint:string;p256dh:string;auth:string}, now: number): Promise<void>; // idempotent; keeps newest MAX_PUSH_DEVICES, drops oldest; ensures an alert_settings row exists (rules stay NULL until verified); touches last_seen_at like saveWebhook
  export async function deleteSubscription(db: D1Database, accountId: string, endpoint: string): Promise<void>;
  export function deleteSubscriptionStmt(db: D1Database, accountId: string, endpoint: string): D1PreparedStatement;
  export async function countPushAccounts(db: D1Database): Promise<number>;
  export function verifyPushStmt(db: D1Database, accountId: string, defaultRulesJson: string, now: number): D1PreparedStatement; // push_ok=1, rules = COALESCE(rules, default), next_sync_at = 0
  ```
- Modified (`alerts/db.ts`): `AlertSettingsRow` gains `pushOk: boolean | null`; `loadAlertSettings` selects `push_ok`; `countWebhooks` is replaced by `countAlertingAccounts` = accounts with a non-null webhook OR at least one subscription (update its callers and tests); `removeAlertSettings` (webhook removal) must NOT drop push: if the account still has subscriptions, null the webhook/`webhook_ok` and keep the row and rules, otherwise delete the row as before; removing the last subscription with no webhook deletes the row. `loadDueAccounts`: due when `(webhook_ok = 1 AND discord_webhook IS NOT NULL) OR (push_ok = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_id = s.account_id))`; `DueAccount.webhook` becomes `string | null`.
- Produces (core): `alertText(candidate: AlertCandidate, syncedAt: number, now: number): { title: string; detail: string; footer: string }` with the exact current Discord strings (title sliced to 256, detail to 2000, footer `Last synced N min ago · Garden HQ`); `AlertsStateResponse` gains `push: { available: boolean; publicKey: string | null; devices: number; pushOk: boolean | null }`. Existing callers/tests that build `AlertsStateResponse` must be updated.
- `deleteAccount` batch gains `DELETE FROM push_subscriptions WHERE account_id = ?1` BEFORE the accounts delete (match how the other tables are handled; keep the ordering comment style).

- [ ] **Step 1: Failing tests.** `isAllowedPushEndpoint`: accepts `https://fcm.googleapis.com/fcm/send/abc`, `https://updates.push.services.mozilla.com/wpush/v2/x`, `https://web.push.apple.com/Q`, `https://wns2-par02p.notify.windows.com/w/?token=x`; rejects `http://` variants, `https://evil.com/fcm.googleapis.com`, `https://fcm.googleapis.com.evil.com/x`, `https://user:pw@fcm.googleapis.com/x`, port `:8443`, `ftp:`, non-strings, empty, 2049+ chars. `parsePushSubscription`: a valid object with a real-length p256dh (65 random bytes, first 0x04, base64url) and auth (16 bytes); rejects short/long keys, wrong prefix byte, standard-base64 (`+`/`/`/`=`) variants, missing fields. DB tests (use the existing node:sqlite D1 stand-in helpers): upsert idempotent; 4th device evicts the oldest; `countAlertingAccounts` counts webhook-only, push-only and both once; removing the webhook keeps rules when subs exist; removing the last sub with no webhook deletes the row; due query includes a push-only account with `push_ok = 1` and excludes `push_ok` null; `deleteAccount` leaves no `push_subscriptions` rows; core `alertText` exact strings incl. truncation and minutes rounding; `alertEmbed` output unchanged (existing tests stay green).
- [ ] **Step 2: Implement** (migration file, helpers, db changes, core, `alertEmbed` via `alertText`, `MAX_PUSH_DEVICES`).
- [ ] **Step 3: Privacy data.** In `apps/web/src/pages/privacy.ts` add `push_subscriptions` to `SERVER_TABLES` ("Your browser's push address and keys, stored so we can send alerts to your device. Deleted when you turn push off, when the push service says the address is gone, or when you delete your cloud data.") and add a RECIPIENTS entry "Push services (Google, Mozilla, Apple, Microsoft)": "Receive your alert text, encrypted, to deliver it to your device." Make sure the drift test and `PrivacyScreen.test.tsx` pass; keep the "Last updated" line current (2026-11-10 stays if same day).
- [ ] **Step 4:** run core/worker/web tests, typecheck, lint. Commit `feat: push subscriptions schema, db layer and shared alert text`.

---

### Task 2: Web Push crypto, sender and VAPID key script

**Files:**
- Create: `apps/worker/src/notify/webpush.ts`, `apps/worker/src/notify/webpush.test.ts`, `apps/worker/scripts/vapid-keys.ts`
- Modify: `apps/worker/src/env.ts` (`VAPID_PUBLIC_KEY?`, `VAPID_PRIVATE_KEY?`, `VAPID_SUBJECT?`), `apps/worker/.dev.vars.example` (placeholders only), `apps/worker/package.json` (script `vapid:generate`), root `package.json` (alias), `apps/worker/README.md`

**Interfaces:**
- Consumes: `isAllowedPushEndpoint` from `../alerts/push`; `SendResult`-style union from `notify/discord.ts` (reuse the type shape: `sent | retry (retryAfterSeconds) | dead | rejected (status)`; move the shared type to a small `notify/result.ts` only if that avoids duplication, otherwise import it).
- Produces (`webpush.ts`):
  ```ts
  export interface VapidKeys { publicKey: string; privateKey: string; subject: string } // base64url: publicKey = 65-byte uncompressed point, privateKey = 32-byte scalar d
  export function vapidFromEnv(env: Env): VapidKeys | null;     // null when either key is missing or malformed; subject defaults to WEB_ORIGIN
  export interface PushTarget { endpoint: string; p256dh: string; auth: string }
  export interface EncryptOptions { ephemeral?: CryptoKeyPair; salt?: Uint8Array } // test hooks only
  export async function encryptPayload(target: PushTarget, plaintext: Uint8Array, opts?: EncryptOptions): Promise<Uint8Array>; // RFC 8291 aes128gcm body: salt(16) || rs(4, 4096) || idlen(1) || keyid(65) || ciphertext
  export async function vapidAuthorization(vapid: VapidKeys, audience: string, nowMs: number): Promise<string>; // "vapid t=<jwt>, k=<publicKey>", cached per audience
  export async function sendPush(fetchFn: typeof fetch, target: PushTarget, payload: object, vapid: VapidKeys, nowMs: number): Promise<SendResult>; // 201 -> sent; 404/410 -> dead; 429/5xx/network -> retry (Retry-After honoured, capped like Discord); other 4xx (incl. 400/401/403 bad VAPID, 413) -> rejected{status}
  export function pushPayload(text: { title: string; detail: string }, tag: string): { title: string; body: string; tag: string; url: string };
  export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }>;
  ```
- The private key imports via JWK built from the public point (`x`, `y`) and `d`; sign with `{ name: "ECDSA", hash: "SHA-256" }` and convert to the raw 64-byte r||s form JWT needs (WebCrypto already returns raw r||s for ECDSA). Use HKDF-SHA256 and AES-128-GCM exactly per RFC 8291 section 3.3-3.4 (`key_info = "WebPush: info\0" || ua_public || as_public`, `cek_info = "Content-Encoding: aes128gcm\0"`, `nonce_info = "Content-Encoding: nonce\0"`; single record, last-record padding delimiter `0x02`).

- [ ] **Step 1: Fetch the RFCs** (WebFetch https://www.rfc-editor.org/rfc/rfc8291 and rfc8292) and copy **the RFC 8291 Appendix A example** (plaintext "When I grow up, I want to be a watermelon", the application server private key, user agent public key, auth secret, salt, expected encrypted body) as constants in the test. These are public documentation values, not secrets, and must be labelled as RFC vectors in a comment.
- [ ] **Step 2: Failing tests.** (a) `encryptPayload` with the RFC's fixed ephemeral key pair and salt (imported via JWK; this is what `EncryptOptions` is for) reproduces the RFC's expected ciphertext byte for byte (base64url compare); (b) random-ephemeral round trip: encrypt then decrypt with a test-side implementation of the user agent side (ECDH with the UA private key, same HKDF) returns the plaintext; tampering any ciphertext byte fails decryption; (c) `vapidAuthorization`: with generated test keys, parse the JWT, assert header `{typ:"JWT",alg:"ES256"}`, claims `aud` = origin, `exp` between now and now + 24 h, `sub` as configured, and verify the signature with the public key via WebCrypto; the `k=` value equals the public key; a second call for the same audience returns the cached token, a call after the cache horizon re-signs; (d) `sendPush` with a fake fetch: success 201; 404 and 410 -> dead; 429 with Retry-After 30 -> retry 30; 500 -> retry; 400/401/403/413 -> rejected with status; network throw -> retry; a disallowed endpoint -> `dead` without calling fetch; request headers exactly as Global Constraints (no extra identifying headers), body is the encrypted bytes, endpoint never appears in thrown errors/log output (spy on console); (e) `vapidFromEnv`: null for missing/short/long/non-base64url keys, default subject = `WEB_ORIGIN`, https subject accepted, garbage subject rejected; (f) `pushPayload` truncates title/body to sane sizes and keeps `tag` <= 64 chars.
- [ ] **Step 3: Implement `webpush.ts`.** Base64url helpers local to the file (or reuse `encodeBase32` neighbours' style; do not add dependencies).
- [ ] **Step 4: Key script** `apps/worker/scripts/vapid-keys.ts` using `generateVapidKeys` (run with `node --experimental-strip-types` like the web scripts; confirm it works on this Node, else inline what it needs): prints
  ```
  VAPID_PUBLIC_KEY=<...>
  VAPID_PRIVATE_KEY=<...>
  Set them with:  pnpm --filter @garden-hq/worker exec wrangler secret put VAPID_PUBLIC_KEY   (paste the public key)
                  pnpm --filter @garden-hq/worker exec wrangler secret put VAPID_PRIVATE_KEY  (paste the private key)
  Never commit these. Rotating them invalidates every push subscription.
  ```
  Writes NOTHING to disk. Root alias `pnpm vapid:generate`. A test runs `generateVapidKeys` and checks lengths (65 and 32 bytes) and that the pair signs/verifies. README section "Web push setup" with the steps and rotation warning; `.dev.vars.example` gets `# VAPID_PUBLIC_KEY=`, `# VAPID_PRIVATE_KEY=`, `# VAPID_SUBJECT=https://your-site.example` placeholders (commented, no values).
- [ ] **Step 5:** worker tests, typecheck, lint. Commit `feat: web push crypto (RFC 8291/8292), sender and VAPID key script`.

---

### Task 3: Push API routes

**Files:**
- Modify: `apps/worker/src/routes/alerts.ts` (+ `alerts.test.ts`), `apps/worker/src/app.ts` only if wiring changes (it should not), `apps/worker/README.md`, `packages/core/src/api.ts` (request/response types)

**Interfaces:**
- Consumes: Task 1 (`parsePushSubscription`, `upsertSubscription`, `deleteSubscription`, `listSubscriptions`, `verifyPushStmt`, `countAlertingAccounts`, settings changes), Task 2 (`vapidFromEnv`, `sendPush`, `pushPayload`).
- Produces:
  - `GET /api/alerts` response gains `push` per `AlertsStateResponse.push`: `available = vapidFromEnv(env) !== null`, `publicKey` (the public key or null), `devices` count, `pushOk`.
  - `PUT /api/alerts/push` body `{ subscription: { endpoint, keys: { p256dh, auth } } }` (the browser's `PushSubscription.toJSON()` shape) -> 503-style `AppError("unavailable"...)` mapped to an existing error code if there is no `unavailable` (use the existing code closest to "feature not configured"; look at `errors.ts`) when VAPID is not configured; `bad_request` for an invalid/disallowed subscription; capacity check as for webhooks (`countAlertingAccounts() >= MAX_ALERTING_ACCOUNTS` and this account has no channel yet -> the same `rate_limited` message); then `upsertSubscription`; returns the new state.
  - `DELETE /api/alerts/push` body `{ endpoint }` -> removes that device (204), idempotent.
  - `POST /api/alerts/push/test` -> sends a "Garden HQ test notification" push to every device of the account; per-device outcome handling: `dead` deletes that subscription; if at least one device returned `sent`, set `push_ok = 1` and initialize rules (`verifyPushStmt` with `JSON.stringify(defaultAlertRules(true))`); returns `{ ...state, test: "sent" | "failed" | "dead" }` (`dead` = every device was dead/deleted; reuse `AlertTestResponse` or add `PushTestResponse` in core).
  - `PUT /api/alerts/rules` precondition relaxes from "webhookOk === true" to "webhookOk === true OR pushOk === true" with a matching error message ("Send a test message or test notification first so we know the channel works").
- All routes use `authenticate`, `readJsonBody`, `Cache-Control: no-store`, the same rate limits as the Discord routes; endpoints/keys are never echoed in any response or log.

- [ ] **Step 1: Failing tests** in the existing `alerts.test.ts` style: state includes `push` with `available:false`/`publicKey:null` without keys and `available:true` with test keys; PUT without keys -> unavailable error; PUT with a valid FCM-style subscription stores it (device count 1) and is idempotent; PUT with a non-allowlisted endpoint, bad key lengths, or missing fields -> 400 and nothing stored; 4th device evicts the oldest; capacity error when 8 other accounts hold channels and this one has none (and NOT when this account already has a webhook); DELETE removes only the named endpoint and is idempotent; test push with a fake fetch: `sent` sets `push_ok` and initializes rules, 410 deletes the subscription and returns `dead`, mixed outcomes -> `sent` and the dead one removed, network error -> `failed` and subscription kept; rules PUT allowed after a push test but rejected before any channel is verified; no response body or console output contains the endpoint or the key strings (assert via JSON.stringify of responses and a console spy); unauthenticated requests rejected like the Discord routes.
- [ ] **Step 2: Implement.** Factor shared bits with the Discord handlers only where it removes real duplication.
- [ ] **Step 3:** README route list (`PUT/DELETE /api/alerts/push`, `POST /api/alerts/push/test`), worker tests, typecheck, lint. Commit `feat: push subscription routes and test push`.

---

### Task 4: Cron delivery on every channel

**Files:**
- Modify: `apps/worker/src/cron.ts` (+ `cron.test.ts`), `apps/worker/src/alerts/db.ts` only if a loader needs the subscription list (batch-load subscriptions for the due accounts like `loadAccountData` does: ONE statement for all due account ids), `apps/worker/src/limits.ts` (constants), `apps/worker/README.md`

**Interfaces:**
- Consumes: Task 1 (`DueAccount.webhook: string | null`, subscriptions loader), Task 2 (`vapidFromEnv`, `sendPush`, `pushPayload`), core `alertText`.
- Behaviour:
  - `runSync` computes `vapid = vapidFromEnv(env)` once; push is skipped entirely (accounts are still processed for Discord) when null.
  - `processAccount`: the "no rules enabled" parking and everything before claims is unchanged; an account with no usable channel (no verified webhook and no subscriptions/`push_ok`) is parked like a rules-less one.
  - `deliver(...)`: for each won candidate send to the Discord webhook (if any and not dead) and then to every subscription (if vapid). Claim handling per candidate: **delivered** if at least one channel returned `sent` (claim kept); otherwise if at least one channel returned `retry` and none `sent`, release the claim and reschedule exactly as today (`retryAfterMs` = the max over retry results, capped); otherwise (all `dead`/`rejected`) the claim is kept (as today for dead). `dead` webhook -> `markWebhookDeadStmt` as today; `dead` subscription -> `deleteSubscriptionStmt`; a rejected push logs `push_rejected` with the status only. Once a channel returns `retry` stop sending to remaining *devices* for later candidates in this run (mirror the Discord behaviour) but still try the other channel.
  - Budget: each send `ctx.budget.charge(1)`; the affordability reserve in `processAccount` (`MIN_ACCOUNT_COST + 2 + n*3`) must become `+ n * (2 + sends)` where `sends` = (webhook ? 1 : 0) + (vapid ? subs.length : 0); keep the existing meaning (worst case) and update the comment with the arithmetic. A candidate set that is unaffordable still leaves the account due (existing behaviour).
  - New constant `MAX_PUSH_SENDS_PER_RUN = 12` in `limits.ts`: once reached, remaining pushes in this run are treated as `retry` (claim released, account stays due) so a burst can never exhaust CPU/subrequests; `RunSummary` gains `pushSent`, and `cron_run` logs it (counts only).
  - Logging: counts only; never endpoints.
- [ ] **Step 1: Failing tests** in the existing cron test style (fake clock, fake net): push-only account (push_ok=1, one subscription, no webhook) gets its alert pushed and the claim is recorded once, a second tick sends nothing; webhook + 2 devices all receive one message each for one alert; one device 410 -> deleted from the table and the others still sent; Discord retry + push sent -> claim kept (no duplicate on the next tick); push retry (500) and no Discord -> claim released and `next_sync_at` rescheduled, the next tick after the delay sends once; all channels dead -> claim kept, no resend; vapid missing -> push-only account is parked/never sends and a webhook account is unaffected; `MAX_PUSH_SENDS_PER_RUN` reached -> the rest are released and still due next run; budget arithmetic (an account whose worst-case sends do not fit stays due, as before); the payload actually sent is decryptable with the subscription's keys and contains the same title/detail as the Discord embed (`alertText`); no console output contains an endpoint; existing cron tests unchanged and green. For deterministic push in tests use throwaway generated VAPID keys and subscription keys generated in the test.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** README (delivery rules, caps), worker tests, typecheck, lint. Commit `feat: cron delivers alerts over Discord and web push`.

---

### Task 5: Service worker handlers and the Push section in Settings

**Files:**
- Create: `apps/web/src/pwa/swPush.ts` (+ test), `apps/web/src/pwa/pushClient.ts` (+ test), `apps/web/src/components/PushSection.tsx` (+ test)
- Modify: `apps/web/src/sw.ts`, `apps/web/src/api/client.ts` (push endpoints), `apps/web/src/components/AlertsSection.tsx` (+ test), `apps/web/src/screens/SettingsScreen.tsx` only if placement needs it, `apps/web/src/index.css`, `data/VERIFY.md`, `apps/worker/README.md` (owner setup checklist)

**Interfaces:**
- Consumes: `AlertsStateResponse.push`, the new routes (Task 3), `isIos`, `isStandalone`, `IOS_PUSH_NOTE` from `apps/web/src/pwa/platform.ts`, the existing sync-code auth in `api/client.ts`.
- Produces (`swPush.ts`, pure, used by `sw.ts`): `parsePushPayload(data: unknown): { title: string; body: string; tag: string; url: string }` (tolerates missing/garbage fields with safe defaults "Garden HQ" / ""), `notificationOptions(p): NotificationOptions` (icon `/icons/icon-192.png`, badge same, `tag`, `data: { url }`), `pickClientToFocus(clients: {url:string; focused?:boolean}[], target: string): number | null`.
- `sw.ts` adds: `push` -> `event.waitUntil(self.registration.showNotification(title, options))` (parse `event.data?.json()` in try/catch; a push with no/invalid data still shows a generic "Garden HQ" notification, because browsers require a notification per push), `notificationclick` -> close, then focus an existing same-origin window client or `clients.openWindow(url)` (only same-origin URLs). Keep every Phase 5D constraint (no runtime caching, no clientsClaim). Remove the `// Push handlers are added in Phase 5E.` comment.
- Produces (`pushClient.ts`): `pushSupported(env?)`, `urlBase64ToUint8Array(b64url)`, `currentSubscription(): Promise<PushSubscription | null>`, `subscribeThisDevice(publicKey): Promise<PushSubscriptionJSON>` (requests permission ONLY here, i.e. from a click; `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`), `unsubscribeThisDevice(): Promise<string | null>` returns the endpoint to delete server-side. All browser access behind injectable functions so tests need no real browser APIs.
- `PushSection` states (exact copy): server `push.available === false` -> "Push alerts aren't set up on this server yet."; browser without push support (not iOS) -> "This browser doesn't support push notifications."; **iOS Safari not installed (`isIos() && !isStandalone()`) -> the heading text "Add to Home Screen first" plus `IOS_PUSH_NOTE` and a pointer to the Install section above**; permission `denied` -> "Notifications are blocked for this site. Allow them in your browser or system settings, then try again."; not subscribed -> button "Turn on push on this device"; subscribed -> "Push is on for this device" with buttons "Send test notification" and "Turn off", plus "N device(s) will get alerts". After enabling, if `push.pushOk !== true`, prompt the user to press "Send test notification" (needed before rules can be edited, same as the Discord flow). Idempotent resync: when the section mounts with a local subscription and permission granted, silently PUT it again.
- `AlertsSection`: the rules editor currently appears only when `webhookOk === true`; it must appear when `webhookOk === true || push.pushOk === true`, and the Discord parts must keep working when there is no webhook but push is on. Render `<PushSection />` as its own sub-block (own heading "Push notifications") in the Alerts area.

- [ ] **Step 1: Failing tests.** `swPush`: payload parsing defaults and garbage (null, string, array, huge title truncated to 120 / body to 300), `notificationOptions` shape, `pickClientToFocus` (prefers focused, then first same-origin, null when none); `pushClient`: `urlBase64ToUint8Array` round trip incl. `-`/`_` and padding cases, `subscribeThisDevice` requests permission once and passes the right `applicationServerKey` (inject fakes), denied permission rejects with a typed error, `unsubscribeThisDevice` returns the endpoint and calls `unsubscribe`; `PushSection` for every state above (inject env + fake client + mocked API hook), exact iOS copy "Add to Home Screen first" and `IOS_PUSH_NOTE`, no permission request on mount (only after click), test button calls the API and shows sent/failed/dead outcomes, turn-off calls DELETE with the endpoint; `AlertsSection`: rules editor visible with push-only (`webhookOk` null, `pushOk` true) and hidden with neither; existing AlertsSection tests unchanged and green.
- [ ] **Step 2: Implement** all of the above. Mobile-first, existing tokens, buttons >= 44 px high.
- [ ] **Step 3:** `data/VERIFY.md` "Web push (Phase 5E)": manual device checklist (iPhone: Add to Home Screen, open from the icon, Settings -> Push -> Turn on, allow, Send test notification arrives; Android Chrome; desktop Chrome/Firefox; revoke permission -> UI shows blocked; turn off -> server device count drops; real alert via a lowered threshold arrives once on every device; 410 cleanup after uninstalling the PWA), plus the owner setup checklist (generate keys, `wrangler secret put` x2, optional `VAPID_SUBJECT` var, verify `GET /api/alerts` shows `push.available: true`). Update `apps/worker/README.md` accordingly.
- [ ] **Step 4:** web tests, typecheck, lint, `pnpm --filter @garden-hq/web build` (inspect built `dist/sw.js`: still no `clientsClaim`, no runtime caching, contains `showNotification`). Commit `feat: push notification UI and service worker handlers`.
