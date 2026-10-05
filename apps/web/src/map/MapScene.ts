import { Application, Container, Graphics } from "pixi.js";
import { GRID_SIZE } from "@garden-hq/core";
import type { BarnTile, MapViewModel, PlotTile } from "../viewmodels/map";
import { COLORS, cropColor } from "./palette";
import { tracksHover } from "./pointer";

/** Logical pixels per tile; the whole scene is scaled by an integer factor. */
const TILE = 16;

export interface SceneHandlers {
  onPlotTap(plotId: string, state: PlotTile["state"]): void;
  onPlotHover(plotId: string | null): void;
}

const NOOP: SceneHandlers = { onPlotTap: () => {}, onPlotHover: () => {} };

export class MapScene {
  private app: Application | null = null;
  private mounting: Promise<void> | null = null;
  private destroyed = false;
  private world = new Container();
  private vm: MapViewModel | null = null;
  private handlers: SceneHandlers = NOOP;
  private scale = 1;

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
        backgroundAlpha: 0,
        resolution: 1,
        autoDensity: false,
      });
      if (this.destroyed) {
        app.destroy(false, { children: true });
        return;
      }
      this.app = app;
      app.stage.addChild(this.world);
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

  /** Picks the largest integer scale that fits `cssWidth`; never below 1. */
  resize(cssWidth: number): void {
    this.scale = Math.max(1, Math.floor(cssWidth / (GRID_SIZE * TILE)));
    if (this.app !== null) this.applyScale();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app !== null) {
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
    for (const child of this.world.removeChildren()) child.destroy();
    for (const tile of vm.tiles) {
      this.world.addChild(
        tile.kind === "barn" ? this.barnGraphic(tile) : this.plotGraphic(tile),
      );
    }
  }

  private plotGraphic(tile: PlotTile): Graphics {
    const g = new Graphics();
    const x = tile.x * TILE;
    const y = tile.y * TILE;
    const checker = (tile.x + tile.y) % 2 === 0;

    g.rect(x, y, TILE, TILE).fill(checker ? COLORS.grass : COLORS.grassAlt);

    if (tile.state === "locked") {
      g.rect(x, y, TILE, TILE).fill(COLORS.lock);
      g.rect(x + 5, y + 7, 6, 5).fill(COLORS.lockDark);
      g.rect(x + 6, y + 4, 4, 3).fill(COLORS.lockDark);
    } else {
      g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill(COLORS.soil);
      if (tile.state === "assigned" && tile.cropId !== undefined) {
        const colour = cropColor(tile.cropId);
        // A 3x3 pattern of 3px "plants" - original, flat-colour glyph.
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            g.rect(x + 2 + col * 4, y + 2 + row * 4, 3, 3).fill(colour);
          }
        }
      }
    }

    g.eventMode = "static";
    g.cursor = "pointer";
    g.on("pointertap", () => {
      this.handlers.onPlotTap(tile.plotId, tile.state);
      if (tile.state === "locked") this.handlers.onPlotHover(tile.plotId);
    });
    g.on("pointerover", (e) => {
      if (tracksHover(e.pointerType)) this.handlers.onPlotHover(tile.plotId);
    });
    g.on("pointerout", (e) => {
      if (tracksHover(e.pointerType)) this.handlers.onPlotHover(null);
    });
    return g;
  }

  private barnGraphic(tile: BarnTile): Graphics {
    const g = new Graphics();
    const x = tile.x * TILE;
    const y = tile.y * TILE;
    g.rect(x, y, TILE, TILE).fill(COLORS.grass);
    g.rect(x + 1, y + 5, TILE - 2, TILE - 6).fill(COLORS.barnWall);
    g.rect(x, y + 1, TILE, 5).fill(COLORS.barnRoof);
    tile.visitors.forEach((_, i) => {
      g.rect(x + 1 + i * 3, y + TILE - 3, 2, 2).fill(COLORS.visitor);
    });
    return g;
  }
}
