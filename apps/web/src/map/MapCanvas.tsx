import { useEffect, useRef, useState } from "react";
import type { MapScene, SceneHandlers } from "./MapScene";
import type { MapViewModel } from "../viewmodels/map";

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
        next.resize(wrap.clientWidth);
        observer = new ResizeObserver(() => next.resize(wrap.clientWidth));
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
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
