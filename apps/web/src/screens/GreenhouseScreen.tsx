import { GREENHOUSE_UNLOCK_LEVEL, getPlot } from "@garden-hq/core";
import { Link, Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { ErrorCard } from "../components/ErrorCard";
import { GreenhousePanel } from "../greenhouse/GreenhousePanel";
import { useGarden, useMember } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";

export function GreenhouseScreen() {
  const { link, greenhouses } = useStoredData();
  const garden = useGarden(link?.profileId ?? null);
  const member = useMember(link?.profileId ?? null, link?.uuid ?? null);

  if (link === null) return <Navigate to="/link" replace />;

  const state = garden.data?.garden;
  const plotIds = Object.keys(greenhouses).sort(
    (a, b) => (getPlot(a)?.plotNumber ?? 99) - (getPlot(b)?.plotNumber ?? 99),
  );
  const built = member.data?.member.hasGreenhouse === true;

  return (
    <>
      <h1>Greenhouse</h1>
      {state !== undefined &&
      state.level < GREENHOUSE_UNLOCK_LEVEL &&
      !built ? (
        <p className="card">
          The Greenhouse unlocks at Garden Level {GREENHOUSE_UNLOCK_LEVEL} (you
          are level {state.level}).
        </p>
      ) : null}
      {plotIds.length === 0 ? (
        <div className="card">
          <p>
            No Greenhouse marked yet. Open the map, tap an unlocked plot and
            choose “Mark as Greenhouse”.
          </p>
          <Link className="link-target" to="/">
            Go to the map
          </Link>
        </div>
      ) : state === undefined ? (
        garden.isError ? (
          <ErrorCard
            title="Couldn't load your Garden"
            message={
              garden.error instanceof ApiError
                ? garden.error.message
                : "Unknown error"
            }
            onRetry={() => void garden.refetch()}
          />
        ) : (
          <p>Loading your Garden…</p>
        )
      ) : (
        plotIds.map((plotId) => (
          <GreenhousePanel
            key={plotId}
            plotId={plotId}
            lockedCells={state.greenhouse.lockedCells}
            member={member.data?.member}
            memberError={member.isError}
          />
        ))
      )}
    </>
  );
}
