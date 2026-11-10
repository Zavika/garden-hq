import { getCrop, stripFormatting } from "@garden-hq/core";
import { useContests, useMayor } from "../state/queries";
import { useNow } from "../state/useNow";
import { buildHudViewModel, toSlot } from "../viewmodels/hud";
import { Countdown } from "./Countdown";
import { PlayerBadge } from "./PlayerBadge";
import { CropIcon, DayNightIcon, SeasonIcon } from "./PixelArt";

function cropName(id: string): string {
  return getCrop(id)?.name ?? id;
}

export function Hud({ assignedCropIds }: { assignedCropIds: string[] }) {
  const now = useNow();
  const contests = useContests();
  const mayor = useMayor();

  const vm = buildHudViewModel(
    now,
    toSlot({ data: contests.data?.contests, isError: contests.isError }),
    toSlot({ data: mayor.data?.mayor, isError: mayor.isError }),
    assignedCropIds,
  );
  const contest = vm.nextContest;

  return (
    <section className="card hud" aria-label="SkyBlock status">
      <span className="hud-item">
        <SeasonIcon season={vm.season} />
        <span>
          Year {vm.date.year}, {vm.season} {vm.date.day}
        </span>
      </span>
      <span className="hud-item">
        <DayNightIcon isDay={vm.isDay} />
        <span>{vm.isDay ? "Day" : "Night"}</span>
      </span>
      <span className="hud-item hud-contest">
        {contest.status === "loading" ? (
          <span className="muted">Contest: loading…</span>
        ) : contest.status === "unavailable" ? (
          <span className="muted">Contest: unavailable</span>
        ) : contest.status === "none" ? (
          <span className="muted">Contest: none scheduled</span>
        ) : (
          <>
            <span>
              Contest in <Countdown target={contest.startsAt} />
            </span>
            <span
              className="hud-crops"
              title={contest.crops.map(cropName).join(", ")}
            >
              {contest.crops.map((id) => (
                <CropIcon key={id} cropId={id} />
              ))}
              <span className="sr-only">
                {contest.crops.map(cropName).join(", ")}
              </span>
            </span>
            {contest.matchesAssigned ? (
              <span className="badge" title="You have a plot for this crop">
                ★ your crop
              </span>
            ) : null}
          </>
        )}
      </span>
      <span className="hud-item">
        {vm.mayor.status === "loading" ? (
          <span className="muted">Mayor: loading…</span>
        ) : vm.mayor.status === "unavailable" ? (
          <span className="muted">Mayor: unavailable</span>
        ) : (
          <span
            title={vm.mayor.mayor.perks
              .map((perk) => stripFormatting(perk.name))
              .join(", ")}
          >
            Mayor: <strong>{stripFormatting(vm.mayor.mayor.name)}</strong>
          </span>
        )}
      </span>
      <PlayerBadge />
    </section>
  );
}
