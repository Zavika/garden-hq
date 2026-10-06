import { ALL_MUTATIONS, GREENHOUSE_CROPS } from "@garden-hq/core";

export function GreenhousePalette({
  brush,
  onBrush,
}: {
  /** "" = eraser, undefined = nothing selected. */
  brush: string | undefined;
  onBrush: (id: string | undefined) => void;
}) {
  function toggle(id: string) {
    onBrush(brush === id ? undefined : id);
  }

  return (
    <div className="gh-palette">
      <p className="muted">Pick something, then tap cells to place it.</p>
      <div className="gh-palette-row">
        <button
          type="button"
          aria-pressed={brush === ""}
          onClick={() => toggle("")}
        >
          Clear cell
        </button>
        {GREENHOUSE_CROPS.map((crop) => (
          <button
            key={crop.id}
            type="button"
            aria-pressed={brush === crop.id}
            onClick={() => toggle(crop.id)}
          >
            {crop.name}
          </button>
        ))}
      </div>
      <details>
        <summary>Place a grown mutation</summary>
        <div className="gh-palette-row">
          {ALL_MUTATIONS.map((mutation) => (
            <button
              key={mutation.id}
              type="button"
              aria-pressed={brush === mutation.id}
              onClick={() => toggle(mutation.id)}
            >
              {mutation.name}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
