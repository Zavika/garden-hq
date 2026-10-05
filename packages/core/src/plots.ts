import plotsData from "../../../data/plots.json";

export interface PlotDefinition {
  id: string;
  tierId: string;
  unlockLevel: number;
  cost: number | null;
  x: number;
  y: number;
}

interface PlotsJsonPlot {
  id: string;
  cost: number | null;
  x: number;
  y: number;
}

interface PlotsJsonTier {
  id: string;
  unlockLevel: number;
  plots: PlotsJsonPlot[];
}

const TIERS = (plotsData as { tiers: PlotsJsonTier[] }).tiers;

const GRID = (
  plotsData as { grid: { size: number; barn: { x: number; y: number } } }
).grid;

export const GRID_SIZE: number = GRID.size;
export const BARN_CELL: { x: number; y: number } = { ...GRID.barn };

export const ALL_PLOTS: PlotDefinition[] = TIERS.flatMap((tier) =>
  tier.plots.map((plot) => ({
    id: plot.id,
    tierId: tier.id,
    unlockLevel: tier.unlockLevel,
    cost: plot.cost,
    x: plot.x,
    y: plot.y,
  })),
);

export function getPlot(id: string): PlotDefinition | undefined {
  return ALL_PLOTS.find((plot) => plot.id === id);
}

export function cheapestNextPlot(
  unlockedIds: string[],
  gardenLevel: number,
): PlotDefinition | undefined {
  const unlocked = new Set(unlockedIds);

  const candidates = ALL_PLOTS.filter(
    (plot) =>
      !unlocked.has(plot.id) &&
      plot.unlockLevel <= gardenLevel &&
      plot.cost !== null,
  );

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((cheapest, plot) =>
    (plot.cost as number) < (cheapest.cost as number) ? plot : cheapest,
  );
}
