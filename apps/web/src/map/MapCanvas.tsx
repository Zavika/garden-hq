import { useEffect, useRef, useState } from "react";
import type { MapScene, SceneHandlers } from "./MapScene";
import type { CSSProperties } from "react";
import type { MapViewModel, PlotTile } from "../viewmodels/map";

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
  const [scene, setScene] = useState<MapScene | null>(null);
  const [tilePx, setTilePx] = useState(16);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) return;

    let cancelled = false;
    let created: MapScene | null = null;
    let observer: ResizeObserver | null = null;

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
        setTilePx(next.resize(wrap.clientWidth - 4));
        observer = new ResizeObserver(() =>
          setTilePx(next.resize(wrap.clientWidth - 4)),
        );
        observer.observe(wrap);
        setScene(next);
      } catch {
        created?.destroy();
        if (!cancelled) onUnavailable();
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      created?.destroy();
      setScene(null);
    };
  }, [onUnavailable]);

  useEffect(() => {
    scene?.setHandlers(handlers);
    scene?.update(viewModel);
  }, [scene, viewModel, handlers]);

  return (
    <div ref={wrapRef} className="map-wrap">
      <div
        className="map-frame"
        style={{ "--tile": `${tilePx}px` } as CSSProperties}
      >
        <canvas ref={canvasRef} aria-hidden="true" />
        {/* Plot numbers are DOM so they use the body font and stay crisp at any zoom. */}
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
      </div>
    </div>
  );
}
