import { getCrop } from "@garden-hq/core";
import { useContests, useMayor } from "../state/queries";
import { useNow } from "../state/useNow";
import { buildHudViewModel } from "../viewmodels/hud";
import { Countdown } from "./Countdown";

function cropNames(ids: string[]): string {
  return ids.map((id) => getCrop(id)?.name ?? id).join(", ");
}

export function Hud({ assignedCropIds }: { assignedCropIds: string[] }) {
  const now = useNow();
  const contests = useContests();
  const mayor = useMayor();

  const vm = buildHudViewModel(
    now,
    contests.data?.contests ?? null,
    mayor.data?.mayor ?? null,
    assignedCropIds,
  );

  return (
    <section className="card hud" aria-label="SkyBlock status">
      <span>
        Year {vm.date.year}, {vm.season} {vm.date.day}
      </span>
      <span>{vm.isDay ? "☀ Day" : "☾ Night"}</span>
      <span>
        {vm.nextContest.status === "unavailable" ? (
          "Contest: unavailable"
        ) : vm.nextContest.status === "none" ? (
          "Contest: none scheduled"
        ) : (
          <>
            Contest in <Countdown target={vm.nextContest.startsAt} /> —{" "}
            {cropNames(vm.nextContest.crops)}
            {vm.nextContest.matchesAssigned
              ? " (you have a plot for this)"
              : ""}
          </>
        )}
      </span>
      <span>
        {vm.mayor === null
          ? "Mayor: unavailable"
          : vm.mayor.perks.length === 0
            ? `Mayor: ${vm.mayor.name}`
            : `Mayor: ${vm.mayor.name} (${vm.mayor.perks.map((perk) => perk.name).join(", ")})`}
      </span>
    </section>
  );
}
