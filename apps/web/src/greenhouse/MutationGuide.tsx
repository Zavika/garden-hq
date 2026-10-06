import {
  ALL_MUTATIONS,
  GREENHOUSE_GRID_SIZE,
  getMutation,
  placeableName,
  type Candidate,
  type MutationRarity,
} from "@garden-hq/core";

const RARITY_ORDER: MutationRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

export interface MutationGuideProps {
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  discovered: ReadonlySet<string>;
  analyzed: ReadonlySet<string>;
  best: Candidate | undefined;
  /** extraCellsNeeded: 0 = fits, N = unlock N more cells, null = cannot fit the grid. */
  extraCells: number | null;
}

function optionLabel(
  name: string,
  id: string,
  discovered: ReadonlySet<string>,
  analyzed: ReadonlySet<string>,
): string {
  if (analyzed.has(id)) return `${name} (analysed)`;
  if (discovered.has(id)) return `${name} (discovered)`;
  return name;
}

export function MutationGuide({
  selectedId,
  onSelect,
  discovered,
  analyzed,
  best,
  extraCells,
}: MutationGuideProps) {
  const mutation =
    selectedId === undefined ? undefined : getMutation(selectedId);

  return (
    <div className="gh-guide">
      <h3>Mutation guide</h3>
      <label>
        Target mutation
        <select
          value={selectedId ?? ""}
          onChange={(event) =>
            onSelect(event.target.value === "" ? undefined : event.target.value)
          }
        >
          <option value="">Choose a mutation…</option>
          {RARITY_ORDER.map((rarity) => (
            <optgroup key={rarity} label={rarity}>
              {ALL_MUTATIONS.filter((m) => m.rarity === rarity).map((m) => (
                <option key={m.id} value={m.id}>
                  {optionLabel(m.name, m.id, discovered, analyzed)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {mutation === undefined ? null : (
        <div className="gh-recipe">
          <h4>
            {mutation.name} <small>({mutation.rarity})</small>
          </h4>
          {mutation.recipe.kind === "special" ? (
            <p>{mutation.recipe.text}</p>
          ) : (
            <ul>
              {mutation.recipe.ingredients.map((ingredient) => (
                <li key={ingredient.id}>
                  {ingredient.placeable
                    ? `${ingredient.count}× ${placeableName(ingredient.id)}`
                    : `${ingredient.count}× ${ingredient.id} (not placeable — not checked)`}
                </li>
              ))}
            </ul>
          )}
          {mutation.effects.length > 0 ? (
            <p>Effects: {mutation.effects.join(", ")}</p>
          ) : null}
          {mutation.growth.footprint > 1 ? (
            <p>
              Needs a free {mutation.growth.footprint}×
              {mutation.growth.footprint} block of unlocked cells.
            </p>
          ) : null}
          {extraCells === null ? (
            <p role="status" className="gh-warn">
              {`Can't fit in a ${GREENHOUSE_GRID_SIZE}×${GREENHOUSE_GRID_SIZE} grid.`}
            </p>
          ) : extraCells > 0 ? (
            <p role="status" className="gh-warn">
              {`Needs ${extraCells} more unlocked ${extraCells === 1 ? "cell" : "cells"}.`}
            </p>
          ) : best === undefined ? null : best.status.satisfied ? (
            <p role="status">
              Recipe satisfied at cell {best.x},{best.z}.
            </p>
          ) : (
            <p role="status">
              Closest spot: cell {best.x},{best.z} — missing{" "}
              {best.status.missing}.
            </p>
          )}
          <p className="muted">
            Layout is unverified: assumes the ring of cells around the mutation
            (8 for a 1×1, 12 for a 2×2, 16 for a 3×3) counts toward the recipe.
          </p>
        </div>
      )}
    </div>
  );
}
