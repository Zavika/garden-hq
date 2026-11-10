import { useEffect, useState } from "react";
import { ALL_CROPS } from "@garden-hq/core";

export function AssignCropSheet({
  plotId,
  plotNumber,
  currentCropId,
  gardenLevel,
  onPick,
  onClose,
  greenhouse,
  cropValueHints,
}: {
  /** Sell-offer coins per 160 crops by crop id; absent while unknown. */
  cropValueHints?: Record<string, number | null>;
  plotId: string;
  plotNumber?: number;
  currentCropId?: string;
  gardenLevel: number;
  onPick: (cropId: string | null) => void;
  onClose: () => void;
  greenhouse?: {
    marked: boolean;
    canMark: boolean;
    onMark: () => void;
    onRemove: () => void;
    onOpen: () => void;
  };
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The internal id stays in the accessible name only; the heading shows what
  // the player sees in game.
  const title = plotNumber === undefined ? plotId : `Plot ${plotNumber}`;
  const label =
    plotNumber === undefined ? plotId : `Plot ${plotNumber} (${plotId})`;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Assign crop to ${label}`}
        className="sheet"
      >
        <header className="sheet-head">
          <div>
            <h2>{title}</h2>
            <p className="sheet-sub">
              Choose a crop
              {cropValueHints === undefined
                ? ""
                : " (sell offer, coins per 160 crops, not per hour)"}
            </p>
          </div>
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <div className="crop-grid">
          {ALL_CROPS.filter((crop) => crop.unlockLevel <= gardenLevel).map(
            (crop) => (
              <button
                key={crop.id}
                type="button"
                aria-pressed={crop.id === currentCropId}
                onClick={() => onPick(crop.id)}
              >
                {crop.name}
                {cropValueHints?.[crop.id] != null ? (
                  <small className="crop-hint num">
                    {" "}
                    {Math.round(
                      cropValueHints[crop.id] as number,
                    ).toLocaleString("en-US")}{" "}
                    coins / 160
                  </small>
                ) : null}
              </button>
            ),
          )}
        </div>
        {currentCropId === undefined && greenhouse === undefined ? null : (
          <div className="sheet-actions">
            {currentCropId !== undefined ? (
              <button type="button" onClick={() => onPick(null)}>
                Clear crop
              </button>
            ) : null}
            {greenhouse === undefined ? null : greenhouse.marked ? (
              <>
                <button type="button" onClick={greenhouse.onOpen}>
                  Open Greenhouse
                </button>
                {confirmRemove ? (
                  <button
                    type="button"
                    className="danger"
                    onClick={greenhouse.onRemove}
                  >
                    Confirm &mdash; clears its grid
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(true)}>
                    Remove Greenhouse
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                disabled={!greenhouse.canMark}
                onClick={greenhouse.onMark}
              >
                Mark as Greenhouse
              </button>
            )}
          </div>
        )}
        {greenhouse !== undefined &&
        !greenhouse.marked &&
        !greenhouse.canMark ? (
          <p className="sheet-note">You can have at most 3 Greenhouses.</p>
        ) : null}
      </div>
    </>
  );
}
