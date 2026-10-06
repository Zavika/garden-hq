import {
  ALL_PLOTS,
  BARN_CELL,
  nextPlotCost,
  type GardenState,
} from "@garden-hq/core";

export const MAX_VISITOR_MARKERS = 5;

export interface PlotTile {
  kind: "plot";
  plotId: string;
  /** In-game plot number (1-24). */
  plotNumber: number;
  x: number;
  y: number;
  state: "locked" | "unlocked" | "assigned";
  /** Locked plots are buyable once the garden level reaches their tier. */
  availability: "owned" | "buyable" | "unreachable";
  cropId?: string;
  /** null = cost unknown (see data/VERIFY.md). */
  lockedCost: number | null;
}

export interface BarnTile {
  kind: "barn";
  x: number;
  y: number;
  visitors: { id: string; name: string }[];
  overflow: number;
}

export function plotLabel(tile: {
  plotNumber: number;
  plotId: string;
}): string {
  return `Plot ${tile.plotNumber} (${tile.plotId})`;
}

export interface MapViewModel {
  tiles: (PlotTile | BarnTile)[];
}

export function buildMapViewModel(
  garden: GardenState,
  assignments: Record<string, string>,
): MapViewModel {
  const unlocked = new Set(garden.unlockedPlotIds);

  const plots: PlotTile[] = ALL_PLOTS.map((plot) => {
    const base = {
      kind: "plot" as const,
      plotId: plot.id,
      plotNumber: plot.plotNumber,
      x: plot.x,
      y: plot.y,
    };
    if (!unlocked.has(plot.id)) {
      return {
        ...base,
        state: "locked" as const,
        availability:
          plot.unlockLevel <= garden.level
            ? ("buyable" as const)
            : ("unreachable" as const),
        lockedCost: nextPlotCost(plot.tierId, garden.unlockedPlotIds),
      };
    }
    const cropId = assignments[plot.id];
    return cropId === undefined
      ? {
          ...base,
          state: "unlocked" as const,
          availability: "owned" as const,
          lockedCost: null,
        }
      : {
          ...base,
          state: "assigned" as const,
          availability: "owned" as const,
          cropId,
          lockedCost: null,
        };
  });

  const barn: BarnTile = {
    kind: "barn",
    x: BARN_CELL.x,
    y: BARN_CELL.y,
    visitors: garden.visitors.slice(0, MAX_VISITOR_MARKERS),
    overflow: Math.max(0, garden.visitors.length - MAX_VISITOR_MARKERS),
  };

  return { tiles: [...plots, barn] };
}
