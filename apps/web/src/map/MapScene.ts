import { Application, Container, Graphics, Sprite, type Ticker } from "pixi.js";
import { GRID_SIZE } from "@garden-hq/core";
import type { BarnTile, MapViewModel, PlotTile } from "../viewmodels/map";
import { COLORS, cropColor } from "./palette";
import { tracksHover } from "./pointer";
import { TILE, tilePxFor } from "./layout";
import { plotSpriteSlots } from "./plotSprites";
import { PRESENT_SLOTS } from "../sprites/manifest";
import type { SpriteSlot } from "../sprites/slots";
import { loadTextures, type TextureMap } from "../sprites/textures";

export interface SceneHandlers {
  onPlotTap(plotId: string, state: PlotTile["state"]): void;
  onPlotHover(plotId: string | null): void;
}

const NOOP: SceneHandlers = { onPlotTap: () => {}, onPlotHover: () => {} };

/** Deterministic per-tile noise so the meadow looks scattered but never flickers. */
function noise(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13) ^ salt, 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export class MapScene {
  private app: Application | null = null;
  private mounting: Promise<void> | null = null;
  private destroyed = false;
  private world = new Container();
  private vm: MapViewModel | null = null;
  private handlers: SceneHandlers = NOOP;
  private scale = 1;
  /** Glowing "+" outlines on buyable plots; pulsed by the ticker. */
  private glows: Graphics[] = [];
  private phase = 0;
  private textures: TextureMap = new Map();

  private tick = (ticker: Ticker): void => {
    this.phase += ticker.deltaTime * 0.07;
    const alpha = 0.6 + 0.4 * Math.sin(this.phase);
    for (const glow of this.glows) glow.alpha = alpha;
  };

  mount(canvas: HTMLCanvasElement): Promise<void> {
    if (this.mounting !== null) return this.mounting;
    if (this.destroyed) return Promise.resolve();

    this.mounting = (async () => {
      const app = new Application();
      await app.init({
        canvas,
        width: GRID_SIZE * TILE,
        height: GRID_SIZE * TILE,
        antialias: false,
        roundPixels: true,
        backgroundAlpha: 1,
        background: COLORS.grass,
        resolution: 1,
        autoDensity: false,
      });
      if (this.destroyed) {
        app.destroy(false, { children: true });
        return;
      }
      this.textures = await loadTextures(PRESENT_SLOTS);
      if (this.destroyed) {
        app.destroy(false, { children: true });
        return;
      }
      this.app = app;
      app.stage.addChild(this.world);
      if (!prefersReducedMotion()) app.ticker.add(this.tick);
      this.applyScale();
      if (this.vm !== null) this.draw(this.vm);
    })();

    return this.mounting;
  }

  setHandlers(handlers: SceneHandlers): void {
    this.handlers = handlers;
  }

  update(vm: MapViewModel): void {
    this.vm = vm;
    if (this.app !== null) this.draw(vm);
  }

  /** Picks the largest integer scale that fits `cssWidth`; returns CSS px per tile. */
  resize(cssWidth: number): number {
    const tilePx = tilePxFor(cssWidth);
    this.scale = tilePx / TILE;
    if (this.app !== null) this.applyScale();
    return tilePx;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app !== null) {
      this.app.ticker.remove(this.tick);
      this.app.destroy(false, { children: true });
      this.app = null;
    }
  }

  private applyScale(): void {
    if (this.app === null) return;
    const size = GRID_SIZE * TILE * this.scale;
    this.app.renderer.resize(size, size);
    this.world.scale.set(this.scale);
  }

  private draw(vm: MapViewModel): void {
    for (const child of this.world.removeChildren())
      child.destroy({ children: true }); // never `true`: textures are shared across redraws
    this.glows = [];
    for (const tile of vm.tiles) {
      this.world.addChild(
        tile.kind === "barn" ? this.barnGraphic(tile) : this.plotGraphic(tile),
      );
    }
  }

  /** Meadow base: checker, grass blades, and the odd flower. */
  private grass(g: Graphics, tx: number, ty: number): void {
    const x = tx * TILE;
    const y = ty * TILE;
    g.rect(x, y, TILE, TILE).fill(
      (tx + ty) % 2 === 0 ? COLORS.grass : COLORS.grassAlt,
    );
    for (let i = 0; i < 4; i++) {
      const n = noise(tx, ty, i);
      const bx = x + 1 + (n % 13);
      const by = y + 2 + ((n >>> 8) % 12);
      g.rect(bx, by, 1, 2).fill(i % 2 === 0 ? COLORS.blade : COLORS.bladeLight);
    }
    const flower = noise(tx, ty, 99);
    if (flower % 5 === 0) {
      const fx = x + 2 + ((flower >>> 4) % 11);
      const fy = y + 2 + ((flower >>> 12) % 11);
      g.rect(fx, fy, 2, 2).fill(
        flower % 2 === 0 ? COLORS.flowerPink : COLORS.flowerWhite,
      );
    }
  }

  private weeds(g: Graphics, tx: number, ty: number): void {
    const x = tx * TILE;
    const y = ty * TILE;
    for (let i = 0; i < 5; i++) {
      const n = noise(tx, ty, 200 + i);
      const wx = x + 2 + (n % 10);
      const wy = y + 3 + ((n >>> 8) % 9);
      g.rect(wx, wy, 3, 2).fill(COLORS.weed);
      g.rect(wx + 1, wy - 1, 1, 1).fill(COLORS.weedLight);
    }
  }

  private fence(g: Graphics, x: number, y: number): void {
    const t = TILE;
    // Rails along each edge, then corner and mid posts on top.
    g.rect(x, y + 2, t, 1).fill(COLORS.fenceRail);
    g.rect(x, y + t - 3, t, 1).fill(COLORS.fenceRail);
    g.rect(x + 2, y, 1, t).fill(COLORS.fenceRail);
    g.rect(x + t - 3, y, 1, t).fill(COLORS.fenceRail);
    for (const [px, py] of [
      [0, 0],
      [t - 3, 0],
      [0, t - 3],
      [t - 3, t - 3],
    ] as const) {
      g.rect(x + px, y + py, 3, 3).fill(COLORS.fencePost);
      g.rect(x + px, y + py, 3, 1).fill(COLORS.fencePostLight);
    }
  }

  /** Tilled earth: alternating ridges and furrows, roughened with clods. */
  private tilledSoil(g: Graphics, tx: number, ty: number): void {
    const x = tx * TILE;
    const y = ty * TILE;
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill(COLORS.soilEdge);
    g.rect(x + 2, y + 2, TILE - 4, TILE - 4).fill(COLORS.soilFurrow);
    for (let row = 0; row < 4; row++) {
      const ry = y + 3 + row * 3;
      g.rect(x + 2, ry, TILE - 4, 2).fill(COLORS.soilRidge);
      g.rect(x + 2, ry, TILE - 4, 1).fill(COLORS.soilRidgeLight);
    }
    for (let i = 0; i < 6; i++) {
      const n = noise(tx, ty, 300 + i);
      g.rect(x + 2 + (n % 11), y + 3 + ((n >>> 8) % 10), 1, 1).fill(
        i % 2 === 0 ? COLORS.soilFurrow : COLORS.soilRidgeLight,
      );
    }
  }

  /** A sprite for the slot at tile pixel (x, y), or null when no texture is present. */
  private sprite(slot: SpriteSlot, x: number, y: number): Sprite | null {
    const texture = this.textures.get(slot);
    if (texture === undefined) return null;
    const sprite = new Sprite(texture);
    sprite.position.set(x, y);
    return sprite;
  }

  private plotGraphic(tile: PlotTile): Container {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    const x = tile.x * TILE;
    const y = tile.y * TILE;

    const slots = plotSpriteSlots(tile, (s) => this.textures.has(s));
    const baseSprite =
      slots.base === null ? null : this.sprite(slots.base, x, y);
    // With a base sprite, programmatic extras go in a second Graphics above it.
    const top = baseSprite === null ? g : new Graphics();

    if (baseSprite === null) {
      this.grass(g, tile.x, tile.y);
    } else {
      root.addChild(baseSprite);
      root.addChild(top);
    }

    if (tile.state === "locked") {
      if (baseSprite === null) {
        this.weeds(g, tile.x, tile.y);
        this.fence(g, x, y);
      }

      if (tile.availability === "unreachable") {
        top.rect(x, y, TILE, TILE).fill({ color: COLORS.dim, alpha: 0.45 });
        // Small padlock: body then shackle.
        top.rect(x + 6, y + 8, 5, 4).fill(COLORS.lockDark);
        top.rect(x + 7, y + 5, 3, 3).fill(COLORS.lockDark);
        top.rect(x + 8, y + 6, 1, 2).fill(COLORS.dim);
      } else {
        // Buyable: a pulsing gold outline and "+" that sit above the fence.
        const glow = new Graphics();
        // Frame hugging the tile edge so it never fights the plot number.
        glow.rect(x, y, TILE, 1).fill(COLORS.glow);
        glow.rect(x, y + TILE - 1, TILE, 1).fill(COLORS.glow);
        glow.rect(x, y, 1, TILE).fill(COLORS.glow);
        glow.rect(x + TILE - 1, y, 1, TILE).fill(COLORS.glow);
        glow.rect(x + 5, y + 8, 6, 2).fill(COLORS.glow);
        glow.rect(x + 7, y + 6, 2, 6).fill(COLORS.glow);
        glow.rect(x + 6, y + 8, 4, 2).fill(COLORS.glowCore);
        glow.rect(x + 7, y + 7, 2, 4).fill(COLORS.glowCore);
        this.glows.push(glow);
        root.addChild(glow);
      }
    } else {
      if (baseSprite === null) this.tilledSoil(g, tile.x, tile.y);
      const overlaySprite =
        slots.overlay === null ? null : this.sprite(slots.overlay, x, y);
      if (overlaySprite !== null) root.addChild(overlaySprite);
      if (tile.greenhouse) {
        if (overlaySprite === null) this.glassHouse(top, x, y);
      } else if (
        overlaySprite === null &&
        tile.state === "assigned" &&
        tile.cropId !== undefined
      ) {
        const colour = cropColor(tile.cropId);
        // 3x3 plants in the lower-right, clear of the plot-number badge
        // (which lives in the top-left ~6px of the tile).
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const px = x + 6 + col * 3;
            const py = y + 6 + row * 3;
            top.rect(px, py, 2, 2).fill(colour);
            top.rect(px, py, 2, 1).fill({ color: 0xffffff, alpha: 0.3 });
          }
        }
      }
    }

    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", () => {
      this.handlers.onPlotTap(tile.plotId, tile.state);
      this.handlers.onPlotHover(tile.state === "locked" ? tile.plotId : null);
    });
    root.on("pointerover", (e) => {
      if (tracksHover(e.pointerType)) this.handlers.onPlotHover(tile.plotId);
    });
    root.on("pointerout", (e) => {
      if (tracksHover(e.pointerType)) this.handlers.onPlotHover(null);
    });
    return root;
  }

  /** Original pixel-art glasshouse: roof ridge, framed 2x2 panes with a shine pixel row. */
  private glassHouse(g: Graphics, x: number, y: number): void {
    g.rect(x + 2, y + 2, TILE - 4, 2).fill(COLORS.glassFrame);
    g.rect(x + 1, y + 4, TILE - 2, TILE - 6).fill(COLORS.glassFrame);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const px = x + 2 + col * 6;
        const py = y + 5 + row * 4;
        g.rect(px, py, 5, 3).fill({ color: COLORS.glassPane, alpha: 0.9 });
        g.rect(px, py, 2, 1).fill({ color: COLORS.glassShine, alpha: 0.8 });
      }
    }
  }

  private barnGraphic(tile: BarnTile): Container {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    const x = tile.x * TILE;
    const y = tile.y * TILE;
    this.grass(g, tile.x, tile.y);

    const barnSprite = this.sprite("barn", x, y);
    // Visitor markers always draw last, above the barn sprite.
    let dots = g;
    if (barnSprite !== null) {
      root.addChild(barnSprite);
      dots = new Graphics();
      root.addChild(dots);
    } else {
      this.barnPlaceholder(g, x, y);
    }

    tile.visitors.forEach((_, i) => {
      dots.rect(x + 1 + i * 3, y + TILE - 2, 2, 2).fill(COLORS.visitor);
    });
    return root;
  }

  private barnPlaceholder(g: Graphics, x: number, y: number): void {
    // Roof: stepped gable, then the wall and a braced door.
    g.rect(x + 5, y + 1, 6, 1).fill(COLORS.barnRoof);
    g.rect(x + 3, y + 2, 10, 1).fill(COLORS.barnRoof);
    g.rect(x + 1, y + 3, 14, 2).fill(COLORS.barnRoof);
    g.rect(x + 1, y + 5, 14, 1).fill(COLORS.barnRoofLight);
    g.rect(x + 2, y + 6, 12, 8).fill(COLORS.barnWall);
    g.rect(x + 2, y + 6, 12, 1).fill(COLORS.barnWallLight);
    g.rect(x + 7, y + 3, 2, 2).fill(COLORS.hay);
    g.rect(x + 5, y + 8, 6, 6).fill(COLORS.barnDoor);
    g.rect(x + 5, y + 8, 6, 1).fill(COLORS.barnTrim);
    g.rect(x + 5, y + 8, 1, 6).fill(COLORS.barnTrim);
    g.rect(x + 10, y + 8, 1, 6).fill(COLORS.barnTrim);
    for (let i = 0; i < 4; i++) {
      g.rect(x + 6 + i, y + 9 + i, 1, 1).fill(COLORS.barnTrim);
      g.rect(x + 9 - i, y + 9 + i, 1, 1).fill(COLORS.barnTrim);
    }
    g.rect(x + 1, y + 14, 14, 1).fill(COLORS.barnShadow);
  }
}
