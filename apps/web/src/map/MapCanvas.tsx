import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GRID_SIZE } from "@garden-hq/core";
import type { MapScene, SceneHandlers } from "./MapScene";
import type { CSSProperties } from "react";
import type { MapViewModel, PlotTile } from "../viewmodels/map";
import { tilePxFor } from "./layout";

/** The frame's 2px border on each side is not part of the drawable width. */
const FRAME_BORDER = 4;

export function MapCanvas({
  viewModel,
  handlers,
  onUnavailable,
}: {
  viewModel: MapViewModel;
  handlers: SceneHandlers;
  onUnavailable: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const [scene, setScene] = useState<MapScene | null>(null);
  const [tilePx, setTilePx] = useState<number | null>(null);

  // Size the frame from the container before Pixi loads, using the same integer
  // scale the scene will pick, so nothing jumps when the map appears.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const measure = () => {
      const width = wrap.clientWidth - FRAME_BORDER;
      setTilePx(tilePxFor(width));
      sceneRef.current?.resize(width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) return;

    let cancelled = false;
    let created: MapScene | null = null;

    void (async () => {
      try {
        const { MapScene: Scene } = await import("./MapScene");
        if (cancelled) return;
        const next = new Scene();
        created = next;
        await next.mount(canvas);
        if (cancelled) {
          next.destroy();
          return;
        }
        next.resize(wrap.clientWidth - FRAME_BORDER);
        sceneRef.current = next;
        setScene(next);
      } catch {
        created?.destroy();
        if (!cancelled) onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      sceneRef.current = null;
      created?.destroy();
      setScene(null);
    };
  }, [onUnavailable]);

  useEffect(() => {
    scene?.setHandlers(handlers);
    scene?.update(viewModel);
  }, [scene, viewModel, handlers]);

  const ready = scene !== null;
  const side = tilePx === null ? undefined : tilePx * GRID_SIZE;
  const frameStyle = {
    "--tile": `${tilePx ?? 16}px`,
    width: side,
    height: side,
  } as CSSProperties;

  return (
    <div ref={wrapRef} className="map-wrap">
      <div
        className={ready ? "map-frame" : "map-frame is-loading"}
        style={frameStyle}
        aria-busy={!ready}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
        {ready ? (
          /* Plot numbers are DOM so they use the body font and stay crisp at any zoom. */
          <ol className="plot-badges" aria-hidden="true">
            {viewModel.tiles
              .filter((t): t is PlotTile => t.kind === "plot")
              .map((tile) => (
                <li
                  key={tile.plotId}
                  style={{ gridColumn: tile.x + 1, gridRow: tile.y + 1 }}
                >
                  <span>{tile.plotNumber}</span>
                </li>
              ))}
          </ol>
        ) : (
          <p className="map-loading" role="status">
            Loading map…
          </p>
        )}
      </div>
    </div>
  );
}
