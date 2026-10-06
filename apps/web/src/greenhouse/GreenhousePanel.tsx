import {
  ALL_MUTATIONS,
  getMutation,
  extraCellsNeeded,
  getPlot,
  rankCandidateCells,
  type GardenMemberState,
  type GreenhouseCellRef,
} from "@garden-hq/core";
import { useMemo, useState } from "react";
import { useStorage, useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";
import {
  buildGreenhouseViewModel,
  buildHighlights,
  formatAge,
} from "../viewmodels/greenhouse";
import { BonusBar } from "./BonusBar";
import { ChipLevels } from "./ChipLevels";
import { GreenhouseGrid } from "./GreenhouseGrid";
import { GreenhousePalette } from "./GreenhousePalette";
import { MutationGuide } from "./MutationGuide";

export interface GreenhousePanelProps {
  plotId: string;
  lockedCells: readonly GreenhouseCellRef[];
  member: GardenMemberState | undefined;
  memberError?: boolean;
}

const MUTATION_IDS = new Set(ALL_MUTATIONS.map((m) => m.id));

export function GreenhousePanel({
  plotId,
  lockedCells,
  member,
  memberError = false,
}: GreenhousePanelProps) {
  const storage = useStorage();
  const save = useStoredData().greenhouses[plotId];
  const [brush, setBrush] = useState<string | undefined>(undefined);
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const now = useNow(30_000);
  const wateredAt = save?.lastWateredAt ?? null;

  const vm = useMemo(
    () =>
      save === undefined ? null : buildGreenhouseViewModel(save, lockedCells),
    [save, lockedCells],
  );

  const discovered = useMemo(
    () =>
      new Set(
        (member?.discoveredMutations ?? []).filter((id) =>
          MUTATION_IDS.has(id),
        ),
      ),
    [member],
  );
  const analyzed = useMemo(
    () =>
      new Set(
        (member?.analyzedMutations ?? []).filter((id) => MUTATION_IDS.has(id)),
      ),
    [member],
  );

  const target = targetId === undefined ? undefined : getMutation(targetId);
  const guide = useMemo(() => {
    if (vm === null || target === undefined) return null;
    const candidates = rankCandidateCells(target, vm.cells, vm.unlocked);
    return {
      best: candidates[0],
      extraCells: extraCellsNeeded(target, vm.unlocked),
      highlights: buildHighlights(candidates),
    };
  }, [vm, target]);

  if (vm === null) return null;

  const plot = getPlot(plotId);
  const title =
    plot === undefined ? plotId : `Plot ${plot.plotNumber} (${plotId})`;

  function onCellTap(key: string) {
    if (brush === undefined) return;
    storage.setGreenhouseCell(plotId, key, brush === "" ? null : brush);
  }

  return (
    <section className="card gh-panel" aria-label={`Greenhouse ${title}`}>
      <h2>Greenhouse — {title}</h2>
      <BonusBar bonus={vm.bonus} />
      <p>
        {wateredAt === null
          ? "Not watered yet"
          : `Watered ${formatAge(now - wateredAt)}`}{" "}
        <button
          type="button"
          onClick={() => storage.markGreenhouseWatered(plotId, Date.now())}
        >
          I watered it
        </button>
      </p>
      <GreenhouseGrid
        rows={vm.rows}
        highlights={guide?.highlights}
        onCellTap={onCellTap}
        label={`Greenhouse grid, ${title}`}
      />
      <p className="muted">
        Greyed cells are locked: expand with Ethereal Vines.
      </p>
      <GreenhousePalette brush={brush} onBrush={setBrush} />
      <MutationGuide
        selectedId={targetId}
        onSelect={setTargetId}
        discovered={discovered}
        analyzed={analyzed}
        best={guide?.best}
        extraCells={guide === null ? 0 : guide.extraCells}
      />
      {member === undefined ? (
        memberError ? (
          <p className="muted">Mutation progress unavailable right now.</p>
        ) : null
      ) : (
        <>
          <p>{`Discovered ${discovered.size}/${MUTATION_IDS.size} · Analysed ${analyzed.size}/${MUTATION_IDS.size}`}</p>
          <ChipLevels chips={member.chips} />
        </>
      )}
      {confirmRemove ? (
        <button type="button" onClick={() => storage.unmarkGreenhouse(plotId)}>
          Confirm &mdash; clears its grid
        </button>
      ) : (
        <button type="button" onClick={() => setConfirmRemove(true)}>
          Remove Greenhouse
        </button>
      )}
    </section>
  );
}
