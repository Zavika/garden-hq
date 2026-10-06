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
}: {
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
        <h2>Assign crop — {label}</h2>
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
              </button>
            ),
          )}
        </div>
        {currentCropId !== undefined ? (
          <button type="button" onClick={() => onPick(null)}>
            Clear
          </button>
        ) : null}
        {greenhouse === undefined ? null : greenhouse.marked ? (
          <>
            <button type="button" onClick={greenhouse.onOpen}>
              Open Greenhouse
            </button>
            {confirmRemove ? (
              <button type="button" onClick={greenhouse.onRemove}>
                Confirm &mdash; clears its grid
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)}>
                Remove Greenhouse
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!greenhouse.canMark}
              onClick={greenhouse.onMark}
            >
              Mark as Greenhouse
            </button>
            {greenhouse.canMark ? null : (
              <p>You can have at most 3 Greenhouses.</p>
            )}
          </>
        )}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
