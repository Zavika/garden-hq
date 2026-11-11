# Phase 5F Mobile Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen is usable one-handed on a phone: no horizontal scroll at 320 and 380 px, tap targets at least 44 px, no iOS input zoom, safe-area insets respected in standalone (Home Screen) mode, no hover-only affordances.

**Architecture:** Layout cannot be verified in jsdom, so verification is a **throwaway headless-browser harness** (Playwright with Chromium, kept OUTSIDE the repo in the SDD workspace `.superpowers/sdd/2026-11-10-phase-5f-mobile-pass/audit/`, which is git-ignored). It serves the built web app, mocks every `/api/*` call with the anonymised fixtures in `packages/core/fixtures/`, seeds localStorage with a fake link, visits every route at several viewports, and reports overflow, small tap targets and iOS-zoom risks, plus screenshots. Fixes are CSS-first in `apps/web/src/index.css` and small component tweaks; each fix is re-measured with the harness (before/after numbers go in the report).

**Tech Stack:** React 19, Vite 8, plain CSS (tokens in `index.css`), Playwright (scratch only, never added to the repo's package.json or lockfile).

**Spec:** `docs/superpowers/specs/2026-11-10-phase-5-polish-design.md` (section 10).

## Global Constraints

- Mobile-first; the map must work at 380 px (CLAUDE.md §9). Required viewports: 320x568, 360x740, 380x800, 414x896 (portrait), 667x375 (landscape, overflow check only).
- No horizontal page scroll: `document.documentElement.scrollWidth <= window.innerWidth` on every route at every viewport, and no element's right edge beyond the viewport except inside an intentional scroll container.
- Interactive elements (buttons, links, inputs, selects, tab-bar items, toggles) at least **44x44 CSS px** hit area (visual size may be smaller if padding/`::after` extends the hit area), except inline text links inside a paragraph.
- Form controls (`input`, `select`, `textarea`) use `font-size >= 16px` on touch devices so iOS Safari does not zoom on focus; do not disable user zoom (no `maximum-scale`, no `user-scalable=no`).
- Standalone mode (iOS Home Screen / installed PWA): fixed bottom UI (tab bar, update toast) and the page bottom padding include `env(safe-area-inset-bottom)`; content respects `env(safe-area-inset-left/right)` in landscape; `viewport-fit=cover` is already set in `index.html`. Use `100dvh` (with a `100vh` fallback) where full-height is used.
- Pixel art stays crisp: integer zoom only (existing map logic); no `transform: scale` fractional on sprites.
- No hover-only affordances: anything revealed on `:hover` must also work on tap/focus.
- Respect `prefers-reduced-motion` (existing) and dark mode (every changed colour has a dark counterpart).
- Do not add Playwright (or any new dependency) to the repo. Public repo: fixtures are anonymised, no real player data in screenshots or reports; screenshots stay in the git-ignored workspace.
- Existing tests keep passing; add tests only where behaviour (not layout) changes. TS strict, Prettier, typecheck/lint/test/build pass.

---

### Task 1: Audit harness and overflow / tap-target fixes

**Files:**
- Create (OUTSIDE the tracked tree, git-ignored): `.superpowers/sdd/2026-11-10-phase-5f-mobile-pass/audit/` containing `package.json`, `audit.mjs`, `fixtures.mjs`, `README.txt`, and `out/` (screenshots + `report.json`)
- Modify: `apps/web/src/index.css`, and component files only where markup must change (e.g. wrap a table in a scroll container, add `min-width: 0`, add accessible hit-area padding)
- Modify: `data/VERIFY.md` (a "Mobile pass (Phase 5F)" section with the manual checklist and the harness description)

**Interfaces:** none produced for later tasks except the harness and its `report.json` shape: `{ viewport, route, scrollWidth, innerWidth, overflowing: [{selector, right, width}], smallTargets: [{selector, w, h, text}], zoomRisks: [{selector, fontSize}] }[]`, which Task 2 re-runs.

- [ ] **Step 1: Build the harness.** In the audit folder: `npm init -y`, `npm i playwright` and `npx playwright install chromium` (network is available; if the install is blocked, report BLOCKED with the error, do not fall back to guessing). `audit.mjs`: (a) builds the web app once with `VITE_API_URL=http://127.0.0.1:8799` (`pnpm --filter @garden-hq/web build`) and serves `apps/web/dist` with a tiny static server (Node `http`, SPA fallback to `index.html`, correct content types) on a free port; (b) launches Chromium, for each viewport creates a context with `isMobile: true, hasTouch: true, deviceScaleFactor: 2`, the viewport size and a mobile UA (use an iPhone UA string); (c) `page.route("http://127.0.0.1:8799/**")` returns fixture responses built in `fixtures.mjs` from `packages/core/fixtures/*.json` (garden, profiles, contests, mayor, member, bazaar, alerts state, sync pull) in the exact response shapes the web `api/client.ts` expects (read it and the Worker routes' response builders to get shapes right; where a fixture is missing, hand-build a small anonymised object); unknown API calls return a 404 JSON error so error states are also exercised once; (d) seeds `localStorage["garden-hq:v1"]` with a fake linked account (placeholder name like `TestFarmer`, an all-zero/`1111...` style placeholder UUID and profile id, a few plot assignments and a greenhouse plan) using the storage shape from `apps/web/src/state/storage.ts`, via `context.addInitScript`; (e) visits `/`, `/greenhouse`, `/contests`, `/achievements`, `/settings`, `/link`, `/privacy`, `/credits`, waits for network idle plus 500 ms, and on each page runs the measurements in `page.evaluate`: page overflow, elements whose `getBoundingClientRect().right > innerWidth + 0.5` (report the shortest selector path and ignore elements inside a computed `overflow-x: auto|scroll` ancestor), interactive elements (`a[href], button, [role=button], input, select, textarea, summary, label` with a control) whose hit box (width/height of the element or its `closest` label/anchor wrapper) is under 44 px, and form controls with computed `font-size < 16px`; (f) also opens the plot-assign sheet and the greenhouse editor if they are reachable by a click on a stable selector, and measures again; (g) writes `out/report.json` and `out/<viewport>-<route>.png` full-page screenshots (and a combined `summary.txt`: counts per viewport/route). Print a summary table. The script must be re-runnable (`node audit.mjs`) and exit non-zero when the report has any overflow.
- [ ] **Step 2: Baseline.** Run it; save `report.json` as `out/baseline.json`; view the screenshots for the worst offenders (use the Read tool on the PNGs) and list the real problems in the report (not every flagged item is a bug: decide, with a reason, what is intentional).
- [ ] **Step 3: Fix overflow.** Remove all page-level horizontal overflow at 320/360/380/414 and the landscape viewport using CSS-first fixes (`min-width: 0` on grid/flex children, `overflow-wrap: anywhere` on long strings such as names/URLs, responsive table/list collapse, `max-width: 100%` on media/canvas wrappers, reducing fixed widths). The map must remain integer-scaled and fully visible at 320 (tile size 48 px at the smallest viewport is expected: confirm the 5x5 grid fits). Do not change game logic.
- [ ] **Step 4: Fix tap targets.** Bring every flagged interactive element to >= 44 px hit area (padding, `min-height: 44px`, or an `::after` hit-area extension for small visual controls such as the plot chips, tab-bar items, toggles, "x" buttons, links in lists). Keep the visual design (pixel/wood theme); inline text links in paragraphs are exempt. Do not shrink anything else.
- [ ] **Step 5: Re-run and record.** Re-run the harness: report before/after counts per viewport; any remaining flagged item must be justified in the report. Update `data/VERIFY.md` (what is automated by the harness, how to re-run it, and the manual device checklist: iPhone Safari + installed app, one-handed reach of the tab bar and primary buttons, rotate to landscape, dark mode, text size set to large).
- [ ] **Step 6:** run web tests, typecheck, lint, `pnpm --filter @garden-hq/web build`. Commit `feat: mobile pass - overflow and tap-target fixes`. The commit must contain only tracked-tree changes (the audit folder is ignored; confirm with `git status`).

---

### Task 2: iOS zoom, safe areas, standalone polish

**Files:**
- Modify: `apps/web/src/index.css`, `apps/web/index.html` (only if a meta is missing), small component tweaks where needed (e.g. tab bar, update toast, footer, sheets/modals)
- Modify: `data/VERIFY.md`

**Interfaces:** consumes the Task 1 harness (`audit.mjs`, `report.json` shape) — read its README.

- [ ] **Step 1: Extend the harness** (scratch only) with static CSS checks, because Chromium cannot emulate `env(safe-area-inset-*)` or the `display-mode: standalone` media query: parse `apps/web/src/index.css` and assert that every fixed or sticky bottom element (`.tab-bar`, the update toast, bottom sheets, any other `position: fixed` bottom rule) includes `env(safe-area-inset-bottom)`, and that the `.app`/`body` bottom padding accounts for the tab bar height plus the inset. Also assert in the browser run that inputs/selects/textareas have computed `font-size >= 16px` under touch emulation and that `meta[name=viewport]` has no `maximum-scale` or `user-scalable=no`.
- [ ] **Step 2: Fix.** (a) 16 px minimum font size on form controls on touch devices without making desktop look huge (`@media (pointer: coarse)` or `max-width` query); (b) safe-area insets: tab bar `padding-bottom: env(safe-area-inset-bottom)` (and its height `calc(var(--tabbar-h) + env(safe-area-inset-bottom))`), `.app` bottom padding likewise, update toast (already uses the calc: verify), footer, bottom sheets (plot-assign sheet, greenhouse editor sheets), left/right insets for landscape on the main column; (c) `100dvh` with `100vh` fallback wherever `100vh` is used; (d) `touch-action: manipulation` on buttons/links/tab items (no double-tap zoom delay) and `-webkit-tap-highlight-color` set to a theme-matching transparent/subtle value; (e) `overscroll-behavior-y: none` only on sheets/modals if they scroll internally (do not break pull-to-refresh on the page unless it is already disabled: check); (f) verify no hover-only affordance remains: grep `index.css` for `:hover` rules that reveal content or change layout (cosmetic hover is fine) and for `onPointerOver`/`onMouseEnter` handlers in `apps/web/src` that show information without a tap/focus equivalent (the map's locked-plot compost-cost hover already has a tap path via `onPlotTap` — confirm and note it).
- [ ] **Step 3: Re-run the harness** across all viewports; the report must show: zero overflow, zero small targets (or justified exemptions), zero zoom risks, safe-area checks pass. Re-view screenshots of Home, Settings (with the install, alerts and push sections), Greenhouse and the plot-assign sheet at 320 and 380.
- [ ] **Step 4:** web tests, typecheck, lint, build. Update `data/VERIFY.md` (what changed, what remains manual: real-device notch/home-indicator check). Commit `feat: mobile pass - iOS zoom, safe areas, touch polish`.
