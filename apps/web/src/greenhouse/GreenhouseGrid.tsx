import { placeableName } from "@garden-hq/core";
import {
  swatchColour,
  type GridCell,
  type Highlight,
} from "../viewmodels/greenhouse";

function abbreviation(id: string): string {
  return placeableName(id).slice(0, 2).toUpperCase();
}

function cellLabel(cell: GridCell, highlight: Highlight | undefined): string {
  const where = `Cell ${cell.x},${cell.z}`;
  if (cell.state === "locked") {
    return `${where}: locked — expand with Ethereal Vines`;
  }
  const content =
    cell.state === "filled" && cell.contentId !== undefined
      ? placeableName(cell.contentId)
      : "empty";
  if (highlight === undefined) return `${where}: ${content}`;
  return highlight.kind === "ok"
    ? `${where}: ${content} (recipe satisfied here)`
    : `${where}: ${content} (recipe missing ${highlight.missing})`;
}

export function GreenhouseGrid({
  rows,
  highlights,
  onCellTap,
  label,
}: {
  rows: GridCell[][];
  highlights?: ReadonlyMap<string, Highlight>;
  onCellTap: (key: string) => void;
  label: string;
}) {
  return (
    <div className="gh-grid" role="group" aria-label={label}>
      {rows.flat().map((cell) => {
        const highlight = highlights?.get(cell.key);
        return (
          <button
            key={cell.key}
            type="button"
            className="gh-cell"
            data-state={cell.state}
            data-hl={highlight?.kind}
            disabled={cell.state === "locked"}
            aria-label={cellLabel(cell, highlight)}
            title={
              cell.state === "locked" ? "Expand with Ethereal Vines" : undefined
            }
            style={
              cell.state === "filled" && cell.contentId !== undefined
                ? { background: swatchColour(cell.contentId) }
                : undefined
            }
            onClick={() => onCellTap(cell.key)}
          >
            {cell.state === "filled" && cell.contentId !== undefined
              ? abbreviation(cell.contentId)
              : null}
          </button>
        );
      })}
    </div>
  );
}
