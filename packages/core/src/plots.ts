import plotsData from "../../../data/plots.json";

export interface PlotDefinition {
  id: string;
  tierId: string;
  unlockLevel: number;
  /** In-game plot number (1-24), the label players see on the Garden menu. */
  plotNumber: number;
  x: number;
  y: number;
}

/** A plot the player could buy next, with its Compost price. */
export interface PlotOption extends PlotDefinition {
  cost: number;
}

interface PlotsJsonPlot {
  id: string;
  plot: number;
  x: number;
  y: number;
}

interface PlotsJsonTier {
  id: string;
  unlockLevel: number;
  /** Compost cost of the nth plot bought in this tier (not per plot id). */
  costLadder: number[];
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
    plotNumber: plot.plot,
    x: plot.x,
    y: plot.y,
  })),
);

export function getPlot(id: string): PlotDefinition | undefined {
  return ALL_PLOTS.find((plot) => plot.id === id);
}

/**
 * Cheapest purchasable plot. Price depends on how many plots of the tier are
 * owned, so every locked plot in a tier costs the same; the one returned is
 * the lowest-numbered. Ties between tiers go to the earlier tier.
 */
export function cheapestNextPlot(
  unlockedIds: string[],
  gardenLevel: number,
): PlotOption | undefined {
  const unlocked = new Set(unlockedIds);
  let best: PlotOption | undefined;

  for (const tier of TIERS) {
    if (tier.unlockLevel > gardenLevel) continue;
    const cost = nextPlotCost(tier.id, unlockedIds);
    if (cost === null || (best !== undefined && cost >= best.cost)) continue;

    const locked = ALL_PLOTS.filter(
      (plot) => plot.tierId === tier.id && !unlocked.has(plot.id),
    ).sort((a, b) => a.plotNumber - b.plotNumber)[0];
    if (locked !== undefined) best = { ...locked, cost };
  }

  return best;
}

/**
 * Cost of the next plot bought in a tier. The cost depends on how many plots
 * of that tier are already owned (not on which plot), so the ladder is the
 * tier's plot costs in order. Returns null when unknown or the tier is full.
 */
export function nextPlotCost(
  tierId: string,
  unlockedIds: string[],
): number | null {
  const tier = TIERS.find((t) => t.id === tierId);
  if (tier === undefined) {
    return null;
  }
  const tierPlotIds = new Set(tier.plots.map((p) => p.id));
  const owned = new Set(unlockedIds.filter((id) => tierPlotIds.has(id))).size;
  return tier.costLadder[owned] ?? null;
}
