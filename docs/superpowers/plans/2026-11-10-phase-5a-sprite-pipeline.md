# Phase 5A Sprite Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop 16x16 PNGs into `apps/web/public/sprites/` and have them replace the programmatic placeholders in the Pixi map and the HTML crop icons; missing files keep the placeholders.

**Architecture:** A closed slot table (`soil`, `locked`, `greenhouse`, `barn`, `crop:<id>`) maps to files under `public/sprites/`. A Vite plugin scans that directory at build/dev time, validates every PNG (16x16, known name) and exposes the present slots as `virtual:sprites`. Runtime code takes that list: `MapScene` loads textures for present slots (nearest-neighbour) and a DOM `<Sprite>` component renders `<img>` with a PixelArt fallback.

**Tech Stack:** TypeScript strict, Vite 8 plugin API, Pixi.js 8, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-phase-5-polish-design.md` (section 2, 5A).

## Global Constraints

- Sprites are **16x16 PNG, RGBA**. One frame per sprite. No spritesheets.
- Slot files (exact): `soil.png`, `locked.png`, `greenhouse.png`, `barn.png`, `crops/<cropId>.png` for each id in `data/crops.json` (wheat, carrot, potato, pumpkin, sugar_cane, melon, cactus, cocoa_beans, mushroom, nether_wart, sunflower, moonflower, wild_rose).
- Missing sprite = existing programmatic drawing, unchanged. The app must work with an empty `public/sprites/`.
- Not replaced (stay programmatic): grass base tile, selection outline, buyable glow, padlock, plot-number badge, visitor dots.
- Pixi textures use `scaleMode = "nearest"`; DOM images use `image-rendering: pixelated`. Integer zoom only (existing).
- A wrong-size / non-PNG / unknown-name file in `public/sprites/` **fails `vite build`** with a message naming the file; in dev it logs a warning.
- Do not copy Hypixel or Minecraft textures. Tests use generated fixture PNGs only.
- Public repo: no secrets, no real player data.
- Prettier formatting; `pnpm typecheck`, `pnpm lint`, `pnpm test` pass. No `any`.

## File Structure

- Create `apps/web/src/sprites/slots.ts` — slot names, file paths, pure helpers (also used by the plugin test).
- Create `apps/web/vite/png.ts` — `readPngSize(bytes)`, pure.
- Create `apps/web/vite/sprites-plugin.ts` — `scanSprites(dir, cropIds)` (pure-ish, fs) and `spritesPlugin()`.
- Create `apps/web/vite/check-sprites.ts` — standalone CLI using `scanSprites`.
- Create `apps/web/src/sprites.d.ts` — `declare module "virtual:sprites"`.
- Create `apps/web/src/sprites/manifest.ts` — `PRESENT_SLOTS` re-export of the virtual module (one import point, mockable).
- Create `apps/web/src/sprites/textures.ts` — `loadTextures(present)` for Pixi.
- Create `apps/web/src/sprites/Sprite.tsx` — DOM component.
- Create `apps/web/src/map/plotSprites.ts` — pure `plotSpriteSlots(tile, present)`.
- Modify `apps/web/vite.config.ts`, `apps/web/package.json` (script), `apps/web/src/map/MapScene.ts`, `apps/web/src/components/PixelArt.tsx` (`CropIcon`), `apps/web/src/index.css`.
- Create `apps/web/public/sprites/README.md` (+ `.gitkeep` dirs not needed: README keeps the dir tracked).

---

### Task 1: Slot table, PNG reader, Vite plugin, README, check script

**Files:**
- Create: `apps/web/src/sprites/slots.ts`, `apps/web/src/sprites/slots.test.ts`
- Create: `apps/web/vite/png.ts`, `apps/web/vite/png.test.ts`
- Create: `apps/web/vite/sprites-plugin.ts`, `apps/web/vite/sprites-plugin.test.ts`
- Create: `apps/web/vite/check-sprites.ts`, `apps/web/src/sprites.d.ts`, `apps/web/src/sprites/manifest.ts`
- Create: `apps/web/public/sprites/README.md`
- Modify: `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/tsconfig.node.json` (include `vite/**/*.ts` if needed so typecheck covers the plugin)

**Interfaces:**
- Produces (`slots.ts`):
  ```ts
  export const SPRITE_SIZE = 16;
  export type SpriteSlot = "soil" | "locked" | "greenhouse" | "barn" | `crop:${string}`;
  export function cropSlot(cropId: string): SpriteSlot;           // `crop:${cropId}`
  export function slotsFor(cropIds: readonly string[]): SpriteSlot[]; // 4 fixed + one per crop, fixed order
  export function slotFile(slot: SpriteSlot): string;             // "soil.png" | "crops/wheat.png"
  export function slotUrl(slot: SpriteSlot): string;              // "/sprites/" + slotFile(slot)
  export function fileSlot(file: string, cropIds: readonly string[]): SpriteSlot | null; // inverse; null if unknown
  ```
- Produces (`png.ts`): `readPngSize(bytes: Uint8Array): { width: number; height: number } | null` (null if not a PNG).
- Produces (`sprites-plugin.ts`):
  ```ts
  export interface SpriteIssue { file: string; problem: string }
  export interface SpriteScan { present: SpriteSlot[]; issues: SpriteIssue[] }
  export function scanSprites(dir: string, cropIds: readonly string[]): SpriteScan;
  export function spritesPlugin(opts?: { dir?: string }): import("vite").Plugin;
  ```
  Virtual module id `virtual:sprites` default-exports `SpriteSlot[]` (present slots, in `slotsFor` order).
- Produces (`manifest.ts`): `export const PRESENT_SLOTS: readonly SpriteSlot[]`.

- [ ] **Step 1: Write `slots.ts` + failing test.** Test: `slotsFor(["wheat","carrot"])` equals `["soil","locked","greenhouse","barn","crop:wheat","crop:carrot"]`; `slotFile("crop:sugar_cane")` is `"crops/sugar_cane.png"`; `slotUrl("soil")` is `"/sprites/soil.png"`; `fileSlot("crops/wheat.png", ["wheat"])` is `"crop:wheat"`; `fileSlot("crops/nope.png", ["wheat"])`, `fileSlot("other.png", [])`, `fileSlot("soil.PNG", [])` and `fileSlot("crops/wheat.png", [])` are `null`. Also a test that imports `ALL_CROPS` from `@garden-hq/core` and asserts `slotsFor(ALL_CROPS.map(c => c.id))` has 17 entries (4 + 13).
- [ ] **Step 2: Run the test, confirm it fails; implement `slots.ts`; confirm it passes.**
- [ ] **Step 3: Write `png.ts` + failing test.** A PNG starts with the 8-byte signature `89 50 4E 47 0D 0A 1A 0A`, then the IHDR chunk: 4-byte length, `IHDR`, then big-endian width (bytes 16-19) and height (bytes 20-23). Return null if shorter than 24 bytes, the signature differs, or bytes 12-15 are not `IHDR`. Tests build a byte array by hand: valid 16x16, valid 32x16, truncated, wrong signature (a JPEG header `FF D8 FF`), empty. Export a small test helper `pngBytes(width, height)` from the test file only (the plugin test needs the same helper: put it in `apps/web/vite/testPng.ts` and import it from both tests; it writes a signature + IHDR chunk with a zeroed CRC, which `readPngSize` does not check).
- [ ] **Step 4: Run the test (fail), implement `png.ts`, run (pass).**
- [ ] **Step 5: Write `sprites-plugin.ts` + failing test.** `scanSprites(dir, cropIds)` walks `dir` (missing dir = empty result, no error) for files, recursively, relative paths with `/` separators, ignoring `README.md` and dotfiles. For each file: if `fileSlot` is null -> issue `"not a known sprite name"`; else read bytes, `readPngSize`; null -> issue `"not a PNG"`; size != 16x16 -> issue `` `must be 16x16, is ${w}x${h}` ``; otherwise the slot is present. `present` is returned in `slotsFor(cropIds)` order. Tests use `fs.mkdtempSync(path.join(os.tmpdir(), "sprites-"))` and `pngBytes`: empty dir, missing dir, valid soil + wheat, wrong size, unknown name, a text file named `soil.png`, README ignored.
  `spritesPlugin`: `name: "garden-sprites"`; reads crop ids from `../../data/crops.json` (resolved from the plugin file with `import.meta.dirname`... use `path.resolve(__dirname-equivalent)`; in an ESM Vite config context use `fileURLToPath(new URL(...))`); default dir `apps/web/public/sprites`; `resolveId("virtual:sprites")` returns `"\0virtual:sprites"`; `load` returns `` `export default ${JSON.stringify(present)};` `` and calls `this.addWatchFile` is not needed; in `buildStart`, when `isBuild` (use `configResolved(config)` to capture `config.command === "build"`), throw via `this.error` with all issues joined one per line (`public/sprites/<file>: <problem>`) if any; in serve mode `this.warn` each issue. `configureServer(server)`: `server.watcher.add(dir)` and on `add`/`unlink`/`change` of a path inside `dir`, invalidate the virtual module (`server.moduleGraph.getModuleById("\0virtual:sprites")`) and `server.ws.send({ type: "full-reload" })`. Add a unit test for the plugin's `resolveId`/`load` hooks only (call them directly with a temp dir containing a valid `soil.png`: `load` output contains `"soil"`); the build-failure path is covered by the `scanSprites` issues test plus one test that calls `buildStart` with `command: "build"` through `configResolved` and expects it to throw.
- [ ] **Step 6: Run the tests (fail), implement the plugin, run (pass).**
- [ ] **Step 7: Wire it up.** `vite.config.ts`: add `spritesPlugin()` to `plugins`. `sprites.d.ts`: `declare module "virtual:sprites" { import type { SpriteSlot } from "./sprites/slots"; const slots: SpriteSlot[]; export default slots; }` (use the `import()` type form if a top-level import breaks the ambient declaration). `manifest.ts`: `import present from "virtual:sprites"; export const PRESENT_SLOTS: readonly SpriteSlot[] = present;`. Make sure `pnpm --filter @garden-hq/web typecheck` covers `vite/*.ts` (add to `tsconfig.node.json` `include` if it does not already).
- [ ] **Step 8: Write `check-sprites.ts` and the package script.** It calls `scanSprites` on `public/sprites`, prints `OK: N sprites present (names...)` or one line per issue, and exits 1 on any issue. Add `"sprites:check": "node --experimental-strip-types vite/check-sprites.ts"` to `apps/web/package.json` (verify the repo's Node supports type stripping with `node -v`; if the Node version is below 22.6 use `tsx` only if it is already a dependency, otherwise rewrite the script as `.mjs` importing nothing from TS by inlining the 20 lines it needs and keep a test asserting it agrees with `scanSprites`). Run `pnpm --filter @garden-hq/web sprites:check` and show the output.
- [ ] **Step 9: Write `apps/web/public/sprites/README.md`.** Must contain: a one-paragraph intro (drop 16x16 PNGs here, missing ones keep the built-in art, `pnpm --filter @garden-hq/web sprites:check` validates, wrong files fail the build); a table of **every expected filename** with columns File, Size, Transparent?, Replaces, Notes — rows `soil.png`, `locked.png`, `greenhouse.png`, `barn.png`, and `crops/<id>.png` for all 13 crop ids, each `16x16`. Notes per the spec: crops are drawn over `soil.png`, keep the top-left ~6 px quiet (plot-number badge); `soil.png` is tileable and opaque; `locked.png` is opaque and the padlock / gold "buyable" glow are drawn over it; `greenhouse.png` is drawn over soil; `barn.png` fills one tile and visitor dots are drawn over it. A "Not replaced" list (grass base tile, selection outline, buyable glow, padlock, plot-number badge, visitor dots). A "Export tips" section: Aseprite File > Export, Piskel PNG export, no scaling, RGBA, nearest-neighbour only. Add a test in `slots.test.ts` that reads this README (`fs.readFileSync`) and asserts every `slotFile(slot)` for `slotsFor(ALL_CROPS ids)` appears in it, so the README cannot drift.
- [ ] **Step 10: Run `pnpm typecheck`, `pnpm lint`, `pnpm --filter @garden-hq/web test`, `pnpm --filter @garden-hq/web build`. Commit** (`feat: sprite slots, manifest plugin and README`).

---

### Task 2: Runtime loaders and the DOM `<Sprite>`

**Files:**
- Create: `apps/web/src/sprites/textures.ts`, `apps/web/src/sprites/textures.test.ts`
- Create: `apps/web/src/sprites/Sprite.tsx`, `apps/web/src/sprites/Sprite.test.tsx`
- Modify: `apps/web/src/components/PixelArt.tsx` (`CropIcon` only), `apps/web/src/index.css`, `apps/web/src/components/Hud.test.tsx` only if it breaks

**Interfaces:**
- Consumes: `SpriteSlot`, `slotUrl`, `cropSlot` from `slots.ts`; `PRESENT_SLOTS` from `manifest.ts`.
- Produces (`textures.ts`):
  ```ts
  import type { Texture } from "pixi.js";
  export type TextureMap = ReadonlyMap<SpriteSlot, Texture>;
  export type TextureLoader = (url: string) => Promise<Texture>;
  /** Loads every present slot; a slot whose load fails is omitted (placeholder stays). Never throws. */
  export function loadTextures(present: readonly SpriteSlot[], load?: TextureLoader): Promise<TextureMap>;
  ```
  The default loader is `Assets.load<Texture>(url)` followed by `texture.source.scaleMode = "nearest"`. `textures.ts` must import `pixi.js` only as a type plus a dynamic `import("pixi.js")` inside the default loader, so the Pixi chunk stays lazy.
- Produces (`Sprite.tsx`):
  ```tsx
  export function Sprite(props: { slot: SpriteSlot; present?: readonly SpriteSlot[]; scale?: number; className?: string; fallback: React.ReactNode }): React.ReactElement;
  ```
  Renders `fallback` when `slot` is not in `present` (default `PRESENT_SLOTS`) or after the `<img>` fires `onError`; otherwise `<img src={slotUrl(slot)} width={16*scale} height={16*scale} alt="" aria-hidden className={...} draggable={false}>`. `scale` defaults to 1 and must be a positive integer (clamp with `Math.max(1, Math.round(scale))`).

- [ ] **Step 1: Failing tests for `loadTextures`** with a fake loader (returns `{ id: url } as unknown as Texture`): all present slots loaded under their keys; one loader rejection omits only that slot and does not throw; empty `present` returns an empty map and never calls the loader; the loader is called with `slotUrl(slot)`.
- [ ] **Step 2: Implement `loadTextures` (`Promise.all` over per-slot try/catch), run tests green.**
- [ ] **Step 3: Failing tests for `<Sprite>`** (Testing Library): absent slot renders the fallback and no `img`; present slot renders an `img` with `src="/sprites/crops/wheat.png"`, width/height 32 at `scale={2}`, `image-rendering` comes from a CSS class `sprite` (assert the class); `fireEvent.error(img)` swaps to the fallback; fractional and zero scale are clamped to integers >= 1.
- [ ] **Step 3b: Implement `Sprite.tsx`; add to `index.css`:** `.sprite { image-rendering: pixelated; image-rendering: crisp-edges; display: inline-block; vertical-align: middle; }`. Tests green.
- [ ] **Step 4: Use it in `CropIcon`.** Wrap the existing `PixelArt` in `<Sprite slot={cropSlot(cropId)} scale={1} className="icon" fallback={<PixelArt .../>} />` keeping the exact existing fallback element and the `size` prop for the fallback. Add a `CropIcon` test: with no sprites present it still renders the svg (existing behaviour); with `present` injected it renders the img. Because `CropIcon` has no `present` prop, thread an optional `present?: readonly SpriteSlot[]` through `CropIcon` to `Sprite`.
- [ ] **Step 5: Run `pnpm typecheck`, `pnpm lint`, the web tests, and `pnpm --filter @garden-hq/web build`. Commit** (`feat: runtime sprite loaders and Sprite component`).

---

### Task 3: Pixi map uses the textures

**Files:**
- Create: `apps/web/src/map/plotSprites.ts`, `apps/web/src/map/plotSprites.test.ts`
- Modify: `apps/web/src/map/MapScene.ts`, `apps/web/src/map/MapCanvas.tsx` (only if needed to pass nothing new), `apps/web/src/map/MapCanvas.test.tsx` / `MapSection.test.tsx` only if they break
- Modify: `data/VERIFY.md` (a short "Sprites (Phase 5A)" entry), `apps/web/README.md` (one paragraph pointing at `public/sprites/README.md`)

**Interfaces:**
- Consumes: `PlotTile`, `BarnTile` from `../viewmodels/map` (read them first: fields used are `state`, `availability`, `greenhouse`, `cropId`); `SpriteSlot`, `cropSlot` from `../sprites/slots`; `TextureMap`, `loadTextures` from `../sprites/textures`; `PRESENT_SLOTS` from `../sprites/manifest`.
- Produces (`plotSprites.ts`):
  ```ts
  export interface PlotSprites {
    /** Replaces the whole programmatic base (grass+weeds+fence, or tilled soil). null = draw the placeholder. */
    base: SpriteSlot | null;
    /** Drawn above the base: crop or greenhouse. null = placeholder / nothing. */
    overlay: SpriteSlot | null;
  }
  export function plotSpriteSlots(tile: PlotTile, has: (slot: SpriteSlot) => boolean): PlotSprites;
  ```
  Rules: locked tile -> `base = "locked"` if present else null, `overlay = null` (padlock and buyable glow stay programmatic). Unlocked tile -> `base = "soil"` if present else null; `overlay` = `"greenhouse"` if `tile.greenhouse` and present, else `crop:<id>` if `tile.state === "assigned"`, `cropId` defined, not greenhouse, and present, else null. When the overlay is null for a greenhouse / crop tile the placeholder drawing for that thing is used by `MapScene` (the plan for `MapScene`: placeholder drawn exactly when the slot is absent).

- [ ] **Step 1: Failing tests for `plotSpriteSlots`** covering: locked with and without `locked`; unlocked empty with/without `soil`; assigned crop with crop present / absent; greenhouse tile with greenhouse present / absent (and that a greenhouse tile never yields a crop overlay); assigned tile with `cropId` undefined; soil absent but crop present (overlay still returned). Use a small `tile()` factory in the test.
- [ ] **Step 2: Implement `plotSprites.ts`; tests green.**
- [ ] **Step 3: Wire `MapScene`.** Add `private textures: TextureMap = new Map()`. In `mount`, after `app.init` and the destroyed check, `this.textures = await loadTextures(PRESENT_SLOTS)` (it never throws), then the existing `draw`. Add a private `sprite(slot, x, y): Sprite | null` that creates a Pixi `Sprite` from the texture at `(x, y)` or returns null when absent (import `Sprite` from `pixi.js` next to `Container`). In `plotGraphic`: compute `const slots = plotSpriteSlots(tile, (s) => this.textures.has(s))`. Draw order for a **locked** tile: if `slots.base` -> add the base sprite to `root` (instead of `this.grass` + `this.weeds` + `this.fence`), else the existing three calls; then the existing `unreachable` dim + padlock and the buyable glow code unchanged. For an **unlocked** tile: if `slots.base` -> sprite, else `this.grass` + `this.tilledSoil`; then if `tile.greenhouse`: overlay sprite or `this.glassHouse`; else if assigned with a crop: overlay sprite or the existing 3x3 dots. Sprites must be added to `root` in the same container order as the `Graphics` they replace (the `Graphics` `g` is added first; sprites are added right after it so the glow and later children remain on top). In `barnGraphic`: keep `this.grass(g, ...)`; if `barn` texture present add the sprite and skip the programmatic roof/wall/door, else the existing drawing; the visitor dots loop always runs (draw them into `g` after adding the sprite to the returned container: change `barnGraphic` to return a `Container` holding `g` then the sprite then a second `Graphics` for the dots, or draw dots in a `Graphics` added last). Keep pointer handlers and everything else byte-for-byte.
- [ ] **Step 4: MapScene test.** If the existing suite can already construct `MapScene` under jsdom (check `MapCanvas.test.tsx` for how Pixi is handled; it likely mocks `./MapScene`), do NOT add a Pixi rendering test; instead export a tiny pure helper if needed. The pure `plotSpriteSlots` tests are the coverage for the decision logic; add one test asserting `loadTextures` is invoked with `PRESENT_SLOTS` via `vi.mock("../sprites/manifest")` only if `MapScene` can be constructed in the test environment. State in the report which route was taken.
- [ ] **Step 5: Manual check script.** Create a throwaway fixture directory outside the repo (scratchpad) with generated 16x16 PNGs for `soil`, `locked`, `barn`, `crops/wheat`; run `vite build` with `sprites-plugin`'s `dir` option pointed at it (the plugin option exists for this) and confirm the built `virtual:sprites` chunk lists exactly those four slots (grep the built JS). Report the result; leave nothing in the repo.
- [ ] **Step 6: Docs.** `data/VERIFY.md`: "Sprites (Phase 5A, 2026-11-10)": real rendering of owner art on the map (visual check: crisp edges at 1x/2x/3x scale, correct draw order of glow/padlock/badge over sprites) is manual. `apps/web/README.md`: one paragraph and link.
- [ ] **Step 7: Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (per package if the machine is loaded), `pnpm --filter @garden-hq/web build`. Commit** (`feat: Pixi map renders dropped-in sprites`).
