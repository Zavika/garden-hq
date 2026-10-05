import { useEffect } from "react";
import { ALL_CROPS } from "@garden-hq/core";

export function AssignCropSheet({
  plotId,
  plotNumber,
  currentCropId,
  gardenLevel,
  onPick,
  onClose,
}: {
  plotId: string;
  plotNumber?: number;
  currentCropId?: string;
  gardenLevel: number;
  onPick: (cropId: string | null) => void;
  onClose: () => void;
}) {
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
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
