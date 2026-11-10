import { useCallback, useMemo, useState } from "react";
import { cropValues, type GardenState } from "@garden-hq/core";
import { useNavigate } from "react-router-dom";
import { useBazaar } from "../state/queries";
import { useStorage } from "../state/StorageProvider";
import { MAX_GREENHOUSES } from "../state/storage";
import { useUi } from "../state/ui";
import { buildMapViewModel, plotLabel, type PlotTile } from "../viewmodels/map";
import { AssignCropSheet } from "./AssignCropSheet";
import { MapCanvas } from "./MapCanvas";
import { PlotList } from "./PlotList";
import type { SceneHandlers } from "./MapScene";

export interface MapSectionProps {
  garden: GardenState;
  assignments: Record<string, string>;
  greenhousePlotIds?: readonly string[];
}

const NO_GREENHOUSES: readonly string[] = [];

export function MapSection({
  garden,
  assignments,
  greenhousePlotIds = NO_GREENHOUSES,
}: MapSectionProps) {
  const storage = useStorage();
  const navigate = useNavigate();
  const selectedPlotId = useUi((s) => s.selectedPlotId);
  const hoveredPlotId = useUi((s) => s.hoveredPlotId);
  const selectPlot = useUi((s) => s.selectPlot);
  const hoverPlot = useUi((s) => s.hoverPlot);
  const [webglFailed, setWebglFailed] = useState(false);

  const viewModel = useMemo(
    () => buildMapViewModel(garden, assignments, new Set(greenhousePlotIds)),
    [garden, assignments, greenhousePlotIds],
  );

  const handlers = useMemo<SceneHandlers>(
    () => ({
      onPlotTap: (plotId, state) => {
        if (state !== "locked") selectPlot(plotId);
      },
      onPlotHover: hoverPlot,
    }),
    [selectPlot, hoverPlot],
  );
  const onUnavailable = useCallback(() => setWebglFailed(true), []);

  const bazaar = useBazaar();
  const cropValueHints = useMemo(() => {
    if (bazaar.data === undefined) return undefined;
    const hints: Record<string, number | null> = {};
    for (const v of cropValues({
      prices: bazaar.data.prices,
      lastUpdated: bazaar.data.lastUpdated,
    })) {
      hints[v.cropId] = v.sellOffer;
    }
    return hints;
  }, [bazaar.data]);

  const plots = viewModel.tiles.filter((t): t is PlotTile => t.kind === "plot");
  const hovered = plots.find((t) => t.plotId === hoveredPlotId);
  const selected = plots.find((t) => t.plotId === selectedPlotId);

  return (
    <section className="card map-card" aria-label="Garden map">
      {webglFailed ? null : (
        <MapCanvas
          viewModel={viewModel}
          handlers={handlers}
          onUnavailable={onUnavailable}
        />
      )}
      {hovered !== undefined && hovered.state === "locked" ? (
        <p>
          {plotLabel(hovered)}:{" "}
          {hovered.lockedCost === null
            ? "cost unknown"
            : `${hovered.lockedCost} Compost`}
        </p>
      ) : null}
      <details open={webglFailed}>
        <summary>Plot list</summary>
        <PlotList viewModel={viewModel} onSelect={selectPlot} />
      </details>
      {selected !== undefined ? (
        <AssignCropSheet
          key={selected.plotId}
          plotId={selected.plotId}
          plotNumber={selected.plotNumber}
          currentCropId={selected.cropId}
          gardenLevel={garden.level}
          cropValueHints={cropValueHints}
          onPick={(cropId) => {
            storage.setAssignment(selected.plotId, cropId);
            selectPlot(null);
          }}
          onClose={() => selectPlot(null)}
          greenhouse={{
            marked: selected.greenhouse,
            canMark: greenhousePlotIds.length < MAX_GREENHOUSES,
            onMark: () => {
              storage.markGreenhouse(selected.plotId);
              selectPlot(null);
            },
            onRemove: () => {
              storage.unmarkGreenhouse(selected.plotId);
              selectPlot(null);
            },
            onOpen: () => {
              selectPlot(null);
              navigate("/greenhouse");
            },
          }}
        />
      ) : null}
    </section>
  );
}
