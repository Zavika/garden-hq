# Phase 5C Bazaar Profit Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show per-unit crop sale values and the Compost price (with the coin cost of the next plot unlock) from live Bazaar prices, without pretending to know the player's farming speed.

**Architecture:** Pure core module `packages/core/src/bazaar.ts` scans the raw Bazaar response **as text** (the response is ~3.4 MB and a full `JSON.parse` costs ~40 ms, which exceeds the Worker CPU limit) and extracts only the two prices we need for ~40 wanted products; `cropValues()` and `plotCoinCost()` turn them into hints. The Worker route `GET /api/bazaar` fetches the public endpoint, extracts, and caches the small result in KV for 10 minutes (same pattern as `/api/mayor`). The web app reads it with a TanStack query and renders a `BazaarHints` card plus a price hint in the crop picker.

**Tech Stack:** TypeScript strict, Hono Worker, KV, React 19, TanStack Query, Vitest. Data in `data/bazaar.json`.

**Spec:** `docs/superpowers/specs/2026-11-10-phase-5-polish-design.md` (section 4, 5C) as amended by the Rulings below.

## Global Constraints

- Prices are **per unit**, never per hour (the API does not give the player's fortune/tool/speed). Say so in the UI ("per 160 crops, not per hour").
- Two prices per product, defined from the order books (verify against the live response, Task 1): `sellOffer` = the lowest price in `buy_summary` (the asks) (what you would list at / what an instant-buyer pays), `instantSell` = the highest price in `sell_summary` (the bids) (what you get selling immediately). Use min/max over the listed entries so array ordering cannot matter. Either may be `null` (empty book).
- Do NOT `JSON.parse` the full Bazaar body in the Worker. Extract by text scanning; a missing or malformed product is omitted, never zeroed. If nothing is extracted, respond with the existing `upstream_down` AppError and do not cache.
- KV: one key `bazaar`, 10 minute TTL (144 writes/day; the free plan allows 1,000/day shared with mayor and contests).
- Public endpoint, no API key sent; response `Cache-Control: public, max-age=60`; CORS and rate limit follow the existing `/api` conventions. Never log prices or bodies.
- Game facts (product ids, compaction ratios) come from `data/bazaar.json`, each with `lastVerified` and a `// VERIFY` entry in `data/VERIFY.md`. A crop whose ids/ratio cannot be verified is left out of `crops` and listed in VERIFY.md as unverified; do not guess.
- Show "Prices as of N min ago" in the same style as the garden "last synced" stamp.
- Tests use fixtures (a small real-shaped sample), never live calls. Public repo: fixtures contain only public market data.
- TS strict, no `any` in `packages/core`, Prettier, typecheck/lint/test/build pass.

## Rulings (amend the spec)

- Compost economics is reduced to: the **Compost** bazaar price, and the coin cost of the next plot unlock (compost needed x price). "Make vs buy" would need Organic Matter and fuel item tables and is dropped (YAGNI).
- No stale-on-error serving (the shared `cached()` helper does not do it, and `/api/mayor` does not either); the web query keeps the last successful data on screen.
- Text-scan extraction instead of parsing JSON (CPU). After deploy the controller measures `/api/bazaar` CPU with `wrangler tail`.

---

### Task 1: Core module, data file and fixture

**Files:**
- Create: `data/bazaar.json`, `packages/core/src/bazaar.ts`, `packages/core/src/bazaar.test.ts`, `packages/core/fixtures/bazaar-response.sample.json`
- Modify: `packages/core/src/index.ts` (export), `data/VERIFY.md` (a "Bazaar (Phase 5C)" section)

**Interfaces:**
- Produces:
  ```ts
  export interface BazaarPrice { sellOffer: number | null; instantSell: number | null }
  export type BazaarPrices = Record<string, BazaarPrice>; // keyed by Bazaar product id
  export interface BazaarSnapshot { prices: BazaarPrices; lastUpdated: number | null } // lastUpdated = response `lastUpdated` epoch ms
  export interface BazaarCropEntry { cropId: string; rawId: string; enchantedId: string; rawPerEnchanted: number }
  export const BAZAAR_CROPS: readonly BazaarCropEntry[];   // from data/bazaar.json (verified ones only)
  export const COMPOST_ID: string;                          // "COMPOST"
  export function wantedProductIds(): string[];             // every rawId, enchantedId and COMPOST_ID, de-duplicated
  /** Text-scan extraction; never JSON.parse the whole body. */
  export function extractBazaar(body: string, ids: readonly string[]): BazaarSnapshot;
  export interface CropValue { cropId: string; unit: "enchanted" | "raw"; sellOffer: number | null; instantSell: number | null } // coins for 160 raw crops
  export function cropValues(snapshot: BazaarSnapshot): CropValue[]; // sorted best first by sellOffer, nulls last
  export function plotCoinCost(compostNeeded: number, snapshot: BazaarSnapshot): number | null; // compostNeeded * lowest Compost sell offer (what buying Compost costs); null when unknown
  ```
  Define the 160-raw value precisely: for each of `sellOffer` and `instantSell`, value = `price(enchantedId) * 160 / rawPerEnchanted`; if the enchanted product is missing or has no price for that side, fall back to `price(rawId) * 160` with `unit: "raw"` (unit is `"enchanted"` only when both sides came from the enchanted product). `plotCoinCost(n, snap)` = `n * snap.prices[COMPOST_ID].sellOffer`, or null when unknown; 0 compost gives 0.

- [ ] **Step 1: Verify the facts (no code yet).** Fetch the live public response (`curl -s https://api.hypixel.net/v2/skyblock/bazaar` into the scratchpad, NOT the repo). For each of the 13 crops in `data/crops.json` find the raw and enchanted product ids that exist in the response (examples seen: WHEAT, ENCHANTED_HAY_BLOCK/ENCHANTED_HAY_BALE, CARROT_ITEM, ENCHANTED_CARROT, POTATO_ITEM, ENCHANTED_POTATO, PUMPKIN, ENCHANTED_PUMPKIN, SUGAR_CANE, ENCHANTED_SUGAR, MELON, ENCHANTED_MELON, CACTUS, ENCHANTED_CACTUS_GREEN, INK_SACK:3, ENCHANTED_COCOA, RED_MUSHROOM, ENCHANTED_RED_MUSHROOM, NETHER_STALK, ENCHANTED_NETHER_STALK, plus SUNFLOWER/DOUBLE_PLANT, MOONFLOWER, WILD_ROSE and their ENCHANTED_ forms; several of these are guesses: check). Confirm each compaction ratio (raw items per enchanted item, e.g. 160 for most) against the SkyBlock wiki (hypixelskyblock.minecraft.wiki; use WebFetch/WebSearch) and, where possible, against the price ratio in the live data. Also confirm the order-book semantics: print `sell_summary` and `buy_summary` ordering and relate them to `quick_status.buyPrice/sellPrice` for one product, and write down in the report which array holds the instant-buy and which the instant-sell side. Write `data/bazaar.json` as `{ "lastVerified": "<today>", "compostId": "COMPOST", "crops": [ { "cropId", "rawId", "enchantedId", "rawPerEnchanted" } ... ] }` with ONLY verified crops; list unverified ones in VERIFY.md with why.
- [ ] **Step 2: Fixture.** Create `packages/core/fixtures/bazaar-response.sample.json`: a **compact, single-line** JSON (like Hypixel's, no whitespace) `{"success":true,"lastUpdated":<number>,"products":{...}}` containing ~8 real-shaped products copied from the live response but with each `sell_summary`/`buy_summary` truncated to 3-6 entries (keep real `product_id`, `quick_status` fields, `pricePerUnit`, `amount`, `orders`, and field order as live). Include: ENCHANTED_CARROT, CARROT_ITEM, ENCHANTED_CARROT_ON_A_STICK (a prefix-collision decoy), COMPOST, one product with an EMPTY `sell_summary":[]`, and one product with prices in a different array order than the others (to prove min/max not index). Public market data only.
- [ ] **Step 3: Failing tests (`bazaar.test.ts`).** `extractBazaar(fixtureText, [...])`: exact numbers for ENCHANTED_CARROT (`sellOffer` = min of its `buy_summary`, `instantSell` = max of its `sell_summary`); `ENCHANTED_CARROT` is not confused with `ENCHANTED_CARROT_ON_A_STICK` and the reverse; empty `sell_summary` gives `sellOffer: null` while `instantSell` is still set; unordered arrays give the right min/max; a requested id absent from the body is absent from `prices` (not zero); `lastUpdated` parsed, `null` when missing; a body that is not JSON-looking / empty string returns `{ prices: {}, lastUpdated: null }` without throwing; ids with special characters (`INK_SACK:3`) work; a product whose book contains a malformed number is omitted. `cropValues`: with a hand-built snapshot, value math for an enchanted ratio of 160 and of another ratio, fallback to raw when the enchanted product is missing, sorted best first with nulls last, crops absent from `BAZAAR_CROPS` never appear. `plotCoinCost`: `n * price`, null when Compost is unknown, 0 compost gives 0. Also a test that `wantedProductIds()` has no duplicates and includes `COMPOST`, and that every `BAZAAR_CROPS.cropId` exists in `ALL_CROPS`.
- [ ] **Step 4: Implement `bazaar.ts`.** For each wanted id: `body.indexOf('"' + id + '":{"product_id":"' + id + '"')` (exact key and product_id so prefixes can never match); take the slice from that index up to the next product start or a bounded window (find the end of the object by scanning for the `,"quick_status"` ... or simply bound the slice at the next occurrence of `"product_id":"` after the first; document the approach); inside the slice, locate `"sell_summary":[` and `"buy_summary":[`, take text up to the matching `]` (entries contain no nested arrays, so the first `]` ends it), and read every `"pricePerUnit":<number>` with a global regex; all numbers must be finite or the product is omitted. `lastUpdated` via a regex on the head of the body (`"lastUpdated":(\d+)`). No `JSON.parse` of the whole body. Performance guard test: build a 3 MB synthetic body (repeat decoy products) and assert `extractBazaar` finishes in under 50 ms on the test machine only as a loose smoke check (use a generous bound; skip if flaky and say so).
- [ ] **Step 5:** VERIFY.md section (ids verified date, compaction ratios and sources, order-book semantics, unverified crops, the text-scan fragility note: "if Hypixel changes the field order or key format, extraction returns fewer products and the route fails closed"). Run core tests, typecheck, lint. Commit `feat: bazaar core module, data and fixture`.

---

### Task 2: Worker route `GET /api/bazaar`

**Files:**
- Create: `apps/worker/src/routes/bazaar.ts`, `apps/worker/src/routes/bazaar.test.ts`
- Modify: `apps/worker/src/hypixel.ts` (add `bazaar(): Promise<string>` returning the raw body TEXT, unauthenticated), `apps/worker/src/app.ts` (mount), `apps/worker/README.md`, `data/VERIFY.md` (CPU measurement to do after deploy)

**Interfaces:**
- Consumes: `extractBazaar`, `wantedProductIds`, `BazaarSnapshot` from `@garden-hq/core`; `cached` from `../cache`; `AppError`.
- Produces: `GET /api/bazaar` -> `{ prices: BazaarPrices, lastUpdated: number | null, fetchedAt: string }` (ISO `fetchedAt` like `/api/mayor`); web type `BazaarResponse` is declared in Task 3.

- [ ] **Step 1: Read `apps/worker/src/hypixel.ts`** (the `request()` helper currently parses JSON; add a way to get text for this one unauthenticated endpoint without breaking existing callers or the retry/backoff and rate-limit-header handling; follow how `election` is wired and keep the key out of the request: `authenticated=false`). The method must return the body as a string and must not `JSON.parse` it. Keep logging via the existing `logUpstream` (path template only).
- [ ] **Step 2: Failing tests (`bazaar.test.ts`)** modelled on `mayor.test.ts` (fake deps, KV fake): serves extracted prices from the fixture text; second call within 10 min is a KV hit with no upstream call; after 10 min (fake clock) refetches; upstream failure -> existing error body/status (502 upstream_down style as mayor), nothing cached; extraction of zero products -> `upstream_down`, nothing cached; the response sets `Cache-Control: public, max-age=60`; the upstream request carries no Authorization/API-key header; response body contains only the wanted ids (no 3 MB passthrough).
- [ ] **Step 3: Implement the route and mount it** (`app.route("/api", bazaarRoute(deps, clientFor))`). TTL const `10 * 60`.
- [ ] **Step 4:** README route list + a line on the CPU reasoning; VERIFY.md "Bazaar route CPU: measure `/api/bazaar` on a cold cache with `wrangler tail` (target well under 10 ms); if over, options are a smaller wanted list or browser-direct fetch (the endpoint allows CORS *)". Run worker tests, typecheck, lint. Commit `feat: GET /api/bazaar with text-scan extraction and 10 min KV cache`.

---

### Task 3: Web query, BazaarHints card and crop-picker price

**Files:**
- Create: `apps/web/src/components/BazaarHints.tsx`, `apps/web/src/components/BazaarHints.test.tsx`
- Modify: `apps/web/src/api/client.ts` (type `BazaarResponse`, `api.bazaar()`), `apps/web/src/state/queries.ts` (`useBazaar`), `apps/web/src/screens/HomeScreen.tsx` (render the card below the existing panels; follow the existing structure), `apps/web/src/map/AssignCropSheet.tsx` (+ test), `apps/web/src/index.css` if needed, `apps/web/src/pages/privacy.ts` only if a data statement changes (it does not: the browser talks only to our Worker)

**Interfaces:**
- Consumes: `cropValues`, `plotCoinCost`, `BazaarSnapshot` from `@garden-hq/core`; the existing `useContests`/`useMayor` query style (stale time, retry); how the app shows "last synced X min ago" (reuse that helper/component).
- Produces: `useBazaar()` (stale time 5 min, refetch on window focus off); `<BazaarHints />`.

- [ ] **Step 1: Failing tests.** `BazaarHints` (mock `useBazaar`): loading state, error state (non-blocking message, no crash), success: lists crops best first with names (from `ALL_CROPS`), the sell-offer and instant-sell numbers formatted with thousands separators and a "coins per 160 crops, not per hour" caption, the best crop marked, a crop with `null` prices shows "no data", the Compost price row and, when `plotCoinCost` inputs are available (next plot cost from existing plot data on Home), "Next plot: N Compost ~ X coins"; shows "Prices as of N min ago". `AssignCropSheet`: when bazaar data is present each crop row shows a small value hint (sell-offer per 160), when absent/loading the sheet is unchanged (existing tests unchanged).
- [ ] **Step 2: Implement.** Find the next plot's compost cost where Home/planner already computes it (search `nextPlot`, `plots.ts` in core, `DoNextCard`); if it is not readily available on Home, render only the Compost price row and say so in the report. Mobile first (380 px): table collapses to a list, no horizontal scroll, numbers right-aligned with tabular figures. Use existing tokens/card styles.
- [ ] **Step 3:** run web tests, typecheck, lint, build. Commit `feat: bazaar hints card and crop value in the picker`.
