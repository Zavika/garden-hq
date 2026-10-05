import { plotLabel, type MapViewModel, type PlotTile } from "../viewmodels/map";

function describe(tile: PlotTile): string {
  if (tile.state === "locked") {
    return tile.lockedCost === null
      ? "locked — cost unknown"
      : `locked — ${tile.lockedCost} Compost`;
  }
  return tile.state === "assigned"
    ? `crop: ${tile.cropId}`
    : "unlocked — no crop";
}

export function PlotList({
  viewModel,
  onSelect,
}: {
  viewModel: MapViewModel;
  onSelect: (plotId: string) => void;
}) {
  const plots = viewModel.tiles.filter((t): t is PlotTile => t.kind === "plot");
  return (
    <ul className="plot-list">
      {plots.map((tile) => (
        <li key={tile.plotId}>
          {tile.state === "locked" ? (
            <span>
              {plotLabel(tile)} — {describe(tile)}
            </span>
          ) : (
            <button type="button" onClick={() => onSelect(tile.plotId)}>
              {plotLabel(tile)} — {describe(tile)}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
