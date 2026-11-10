# Phase 5 — Polish: design

Status: **draft for review** (2026-11-10). Nothing here is implemented.
Scope comes from the owner's request plus CLAUDE.md §8 Phase 5. The sound toggle is dropped; the mobile pass is 5F (section 10).

## 1. Decomposition

Five independent sub-projects, each with its own plan, branch and merge. Order is
by value to the owner and by dependency:

| # | Sub-project | Depends on | Touches |
|---|---|---|---|
| 5A | Sprite pipeline | none | web only |
| 5B | Privacy + credits pages | none (text audited against 5D if it lands first) | web only |
| 5C | Bazaar profit hints | none | core, worker, web, data |
| 5D | PWA install + offline shell | none | web only |
| 5E | Web push alerts | 5D (service worker) | core, worker (migration 0005), web |

Recommended order: **5A, 5B, 5D, 5C, 5E.** 5A first so the owner can start drawing.
5B before 5E would need a privacy-page revision (push subscription storage), so the
5B plan includes a "what we store" audit task and 5E includes a privacy-page update
task.

## 2. 5A — Sprite pipeline

### Goal
Drop 16x16 PNGs into `apps/web/public/sprites/`; they replace the programmatic
placeholders drawn in `MapScene.ts` and `PixelArt.tsx`. Missing files keep the
placeholder, so art can arrive one sprite at a time.

### File contract
All files are **16x16 PNG, RGBA** (transparency allowed where noted).

| File | Replaces | Transparency | Notes |
|---|---|---|---|
| `crops/<cropId>.png` x13 | the 3x3 coloured dots in `plotGraphic` and the HUD `CropIcon` | yes | Drawn over the soil tile. Keep the top-left ~6 px quiet: the plot-number badge sits there. Crop ids are `data/crops.json` ids: wheat, carrot, potato, pumpkin, sugar_cane, melon, cactus, cocoa_beans, mushroom, nether_wart, sunflower, moonflower, wild_rose |
| `soil.png` | `tilledSoil` | no | Tileable (adjacent plots touch) |
| `locked.png` | grass + weeds + fence of a locked plot | no | The padlock and the gold "buyable" glow stay programmatic, drawn over it, so state is still readable |
| `greenhouse.png` | `glassHouse` | yes | Drawn over `soil.png` |
| `barn.png` | `barnGraphic` | yes | The barn is one tile; visitor dots stay programmatic |

Not replaced (stay programmatic): grass base tile, selection outline, buyable glow,
plot-number badge, visitor dots. Adding more sprite slots later is one entry in a
table (see Architecture).

### Architecture
- **Slot table** in `apps/web/src/sprites/slots.ts`: the closed list of slot names
  (`soil`, `locked`, `greenhouse`, `barn`, `crop:<id>`) and each file path. Crop
  slots are generated from `data/crops.json`, so a new crop gets a slot for free.
- **Manifest at build time**: a small Vite plugin scans `public/sprites/**` and
  exposes `virtual:sprites` = the list of slot names whose file exists. This avoids
  probing for 404s at runtime. (On Cloudflare Pages an unknown path returns the SPA
  `index.html` with status 200, so probing would "succeed" with HTML.)
- **Validation in the plugin**: reads the PNG IHDR; a file that is not 16x16, not a
  PNG, or not in the slot table **fails the build** (and logs a warning in dev) with
  a message naming the file. `pnpm sprites:check` runs the same check standalone.
- **Pixi side**: `loadSprites()` loads the present files via `Assets.load`, sets
  `source.scaleMode = "nearest"`, returns `Map<slot, Texture>`. `MapScene` takes the
  map in its constructor; each draw method becomes `texture ? sprite : graphics`.
  The scene already uses integer scale and `roundPixels`, so nothing else changes.
- **DOM side**: a `<Sprite slot=...>` component renders `<img>` with
  `image-rendering: pixelated`, falling back to the existing `PixelArt` component.
  Used by `CropIcon` and anywhere a crop is shown in the UI.
- **Docs**: `apps/web/public/sprites/README.md` lists the file contract, a one-line
  recipe for exporting from Aseprite/Piskel, and the check command.

### Rulings (recommended, overridable)
- One frame per sprite, no growth stages or animation. Stages would be `crops/<id>.<n>.png`
  later without breaking this contract.
- PNG files, not a spritesheet: one file per slot is easier to drop in and diff.
- Sprites are bundled into the web build (served from `public/`), no runtime config.
- App icons for the PWA (5D) are **not** derived from these sprites; see 5D.

### Testing
Plugin unit tests with fixture PNGs (valid, wrong size, unknown name, not a PNG);
slot-table test that every crop in `data/crops.json` has a slot; `MapScene` test
that the textured path and the fallback path both construct; `Sprite` component
test (present and absent).

## 3. 5B — Privacy and credits pages

Two static React routes, `/privacy` and `/credits`, linked from the footer, plus a
link from the Settings screen's Cloud save and Alerts sections.

- **Credits** is data-driven from a new `data/credits.json` (EliteBot, the
  Jacob's Contest fallback source if it is ever used, SkyBlock wiki, SkyHanni for the
  plot layout, Hypixel API, Mojang API, libraries, and an optional "sprites by"
  line the owner fills in). The contest source line stays dynamic from `/api/contests`,
  as the footer does today. Keeps the "Not affiliated with Hypixel or Mojang" line.
- **Privacy** is written from an audit of what the code stores, not from memory.
  The plan's first task is that audit (D1 tables, localStorage keys, KV, logs).
  Expected content: what is stored and why (Minecraft username/UUID, selected
  profile, cloud-save ops, time zone, Discord webhook, later push subscription),
  where (Cloudflare Worker, D1, KV; browser localStorage), retention (garden
  snapshot, account deletion), how to delete everything (the existing account
  delete action), third parties that receive data (Hypixel, Mojang, Discord, push
  services, Cloudflare), no analytics, no advertising, no cookies.
- It is a plain-language notice, not legal advice.

### Needs owner input
A **contact** for privacy requests (an email or a GitHub issues URL). I will not
invent one; the page has a single `PRIVACY_CONTACT` constant and the build fails
if it is empty.

## 4. 5C — Bazaar profit hints

### Goal
Answer "what is worth selling / making" without pretending to know the player's
farming speed. Hints are priced per unit, not per hour.

### Shown
1. **Crop value ranking**: for each crop, coins per 160 raw items if compacted to
   the enchanted form and sold (sell-offer and instant-sell both shown, labelled),
   with the best crop marked. Shown in the crop-assign sheet and on the Contests
   screen.
2. **Compost economics**: cost to make one Compost from bazaar organic matter and
   fuel at current prices versus buying it, using the composter simulation's own
   per-compost inputs (`data/composter.json`).
3. A "prices as of N min ago" stamp, in the same style as the garden sync stamp.

Not planner-integrated (YAGNI). One planner rule could be added later.

### Architecture
- `data/bazaar.json`: per crop `{ rawId, enchantedId, rawPerEnchanted }` and the
  compost/fuel/organic-matter product ids, with `lastVerified` and `// VERIFY`
  entries in `data/VERIFY.md` (product ids and compaction ratios are uncertain
  until checked against the live bazaar response).
- `packages/core/src/bazaar.ts` (pure): `normalizeBazaar(raw, wantedIds)` keeps only
  the wanted products and the two prices we use; `cropValues()`, `compostCost()`.
  Every API field optional; missing products are omitted, never zeroed.
- Worker `GET /api/bazaar`: public, no key. Fetches Hypixel's bazaar, **trims to the
  ~40 wanted products before caching** (the full response is large), caches in KV
  with a 10 min TTL and serves stale on upstream error, same pattern as `/api/mayor`.
  10 min = 144 KV writes/day, inside the free-plan limit shared with mayor and
  contests.
- Web: `useBazaar()` query, a `BazaarHints` component, and a price column in
  `AssignCropSheet`.

### Rulings
- Per-unit values, not coins/hour. Per-hour needs the player's fortune, tool and
  speed, which the API does not give us.
- Sell prices only (no buy orders): this is a farmer's view.

### Needs verification at implementation time
Which of `quick_status.sellPrice` / `buyPrice` is the instant-sell price (the field
naming is inverted in a confusing way). The plan includes a task that checks the
live response and records the answer in `data/VERIFY.md`.

## 5. 5D — PWA install and offline shell

- **Manifest** (`manifest.webmanifest`): name, short name, `display: standalone`,
  theme/background colour from the existing CSS tokens, `start_url: /`, scope `/`.
- **Icons**: 192, 512 and a maskable 512 PNG, plus `apple-touch-icon`. Generated
  placeholders from `favicon.svg` by a one-off script; the owner can replace them
  by dropping `public/icons/icon-192.png` etc. (kept separate from the 16x16 sprite
  contract because icons need larger sizes).
- **Service worker** `apps/web/src/sw.ts` built with `vite-plugin-pwa` in
  `injectManifest` mode: precaches the built app shell; handles `push` and
  `notificationclick` (5E). **It never caches `/api/*`**: the cloud-save engine
  already handles offline, and a stale cached sync response would be a data bug.
  Navigation requests fall back to the cached shell, so the app opens offline and
  shows its existing "offline / last synced" state.
- **Update flow**: new worker installs in the background; a "New version available,
  reload" toast. No silent `skipWaiting`, so a sync in progress is never interrupted.
- **Install UI**: an "Install app" button in Settings using `beforeinstallprompt`
  (hidden when unavailable or already installed) and a one-line iOS hint
  (Share, Add to Home Screen) because iOS has no prompt and, importantly, only
  delivers web push to installed apps.
- Cloudflare Pages: `_headers` for the service worker (`Cache-Control: no-cache`)
  and the manifest.

### Ruling
`vite-plugin-pwa` instead of a hand-written precache list. It adds one dev
dependency and removes a class of stale-precache bugs. CLAUDE.md names `sw.ts`;
that file still exists, the plugin only injects the manifest into it.

### Testing
Manifest shape test; SW logic factored into pure functions (`shouldCache(url)`,
notification payload builder) with unit tests; install-button hook test with a
fake `beforeinstallprompt`. Real install/offline behaviour is verified manually and
listed in `data/VERIFY.md`.

## 6. 5E — Web push alerts

### Goal
Deliver the same alerts as Discord through Web Push, to any number of the player's
devices, with no Discord required.

### Data
Migration `0005_push.sql`:

```
push_subscriptions(
  account_id TEXT NOT NULL REFERENCES accounts(id),
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, endpoint)
)
```

Max **5 devices per account** (oldest dropped). `deleteAccount` cascades. Alert
settings gain per-channel switches: `discord_enabled`, `push_enabled`. Existing
accounts keep Discord behaviour unchanged.

### Delivery
- The cron's claim-first dedupe (`alert_log`) is unchanged. After a claim is won
  the alert is sent on every enabled channel. A channel failure follows the
  existing rules: retryable (429/5xx) releases the claim and reschedules;
  permanent (push `404`/`410`) deletes that subscription.
- The due-accounts query currently requires a working Discord webhook; it becomes
  "any enabled channel is usable".
- **No library**: Web Push needs RFC 8291 (aes128gcm payload encryption) and RFC
  8292 (VAPID JWT, ES256). Both are WebCrypto-only, about 150 lines, implemented in
  `apps/worker/src/notify/webpush.ts` and tested against the **RFC 8291 Appendix A
  test vectors** so correctness is checkable without a browser. Node-based
  `web-push` does not run reliably on Workers.
- **Endpoint allowlist** (SSRF): `https:` only and host must match the known push
  services (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`,
  `*.notify.windows.com`). Anything else is rejected at subscribe time and again
  at send time.
- Every push is one subrequest, charged to the cron budget like a Discord send.
- Payload: `{ title, body, tag: type+key, url: "/" }`, TTL 1 h so a stale
  "contest starts in 5 min" is dropped by the push service, not delivered late.
- Endpoints are never logged (they are bearer-like identifiers).

### API
`GET /api/alerts` response gains `push: { configured, devices }`.
`PUT /api/alerts/push` (subscribe), `DELETE /api/alerts/push` (this device),
`POST /api/alerts/push/test`. Same auth and rate limits as the Discord routes.
Public VAPID key is served as a `VAPID_PUBLIC_KEY` var; the private key is the
Worker secret `VAPID_PRIVATE_KEY`; the VAPID `sub` is a `VAPID_SUBJECT` var
holding an `https:` URL (the site), so no personal email is involved.

### Web
Settings gets a Push section: enable on this device (permission prompt only on
click), test, disable, device count. On iOS the section explains install-first.
Permission states handled: default, denied (explain how to re-enable), unsupported.

### Rulings
- One alert payload for both channels, built by the same `alertEmbed`-style core
  function, so Discord and push never disagree.
- Per-channel switches but a single set of alert rules.
- Rotating the VAPID key invalidates all subscriptions; documented in
  `apps/worker/README.md`.

### Needs owner action (cannot be done by me)
Generate the VAPID key pair and set `VAPID_PRIVATE_KEY` as a secret. I will add a
script that prints a key pair; setting the secret is a `wrangler secret put`.

## 7. Cross-cutting

- Every sub-project ends with typecheck, lint, tests and a green CI deploy.
- Tests use fixtures, never live calls (CLAUDE.md §9). Live behaviour that cannot be
  tested is listed in `data/VERIFY.md` with how to check it.
- New game facts (bazaar ids, compaction ratios) get `// VERIFY:` and a
  `data/VERIFY.md` entry.
- Free-plan limits are checked per sub-project: KV writes/day (5C), subrequests per
  cron tick (5E), D1 rows (5E).

## 8. Out of scope

- Sound toggle (dropped by the owner).
- Sprite animation, growth stages, visitor sprites, pest sprites.
- Planner integration of bazaar prices.
- Native app wrappers, background sync, periodic sync.
- Email alerts.

## 9. Owner decisions (2026-11-10)

1. Privacy contact: `https://github.com/Zavika/garden-hq/issues` (repo is public).
2. Order 5A, 5B, 5D, 5C, 5E, then **5F mobile pass**: approved.
3. `vite-plugin-pwa` dev dependency: approved.
4. Mobile pass added as 5F (after 5E). **Sound toggle dropped.**
5. One frame per crop: approved. `apps/web/public/sprites/README.md` must list every expected filename and size.
6. VAPID key-pair script: approved; the owner sets the secret at 5E.
7. **iOS**: web push only works when installed to the Home Screen (iOS 16.4+). The install hint (5D) must explain this; the push toggle (5E) says "Add to Home Screen first" on iOS Safari when not installed.
8. **Public repo**: never commit secrets, keys, real player ids or personal data. Use `.dev.vars`, `wrangler secret`, `gh secret`. Test fixtures stay anonymised. Audited 2026-11-10: raw API dumps are gitignored, fixtures use placeholder ids.

## 10. 5F — Mobile pass (scope)

Audit and fix every screen at 380 px and 320 px width: no horizontal scroll, tap
targets at least 44 px, tab bar and sheets usable one-handed, map frame at integer
scale, safe-area insets in standalone mode (notch / home indicator), no hover-only
affordances. Done with a viewport-width test matrix (jsdom layout assertions where
possible) plus a manual checklist in `data/VERIFY.md`.
