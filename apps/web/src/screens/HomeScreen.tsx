import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { ComposterPanel } from "../components/ComposterPanel";
import { DoNextCard } from "../components/DoNextCard";
import { ErrorCard } from "../components/ErrorCard";
import { Hud } from "../components/Hud";
import { QuestCard } from "../components/QuestCard";
import { SyncBar } from "../components/SyncBar";
import { VisitorsPanel } from "../components/VisitorsPanel";
import { MapSection } from "../map/MapSection";
import { useProgressEngine } from "../state/progress";
import { useGarden } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";

export function HomeScreen() {
  const { link, assignments, greenhouses } = useStoredData();
  const garden = useGarden(link?.profileId ?? null);
  useProgressEngine();

  const greenhousePlotIds = useMemo(
    () => Object.keys(greenhouses),
    [greenhouses],
  );

  if (link === null) return <Navigate to="/link" replace />;

  const error = garden.error;
  const rateLimitedUntil =
    error instanceof ApiError && error.code === "rate_limited"
      ? garden.errorUpdatedAt + (error.retryAfter ?? 60) * 1000
      : null;
  const state = garden.data?.garden;
  const assignedCropIds = Object.values(assignments);

  return (
    <>
      <Hud assignedCropIds={assignedCropIds} />
      <SyncBar
        fetchedAt={garden.data?.fetchedAt}
        isFetching={garden.isFetching}
        isStale={garden.isError && state !== undefined}
        refreshDisabledUntil={rateLimitedUntil}
        onRefresh={() => void garden.refetch()}
      />
      {state === undefined ? (
        garden.isError ? (
          <ErrorCard
            title="Couldn't load your Garden"
            message={
              error instanceof ApiError ? error.message : "Unknown error"
            }
            onRetry={
              rateLimitedUntil === null
                ? () => void garden.refetch()
                : undefined
            }
          />
        ) : (
          <p>Loading your Garden…</p>
        )
      ) : (
        <>
          <DoNextCard garden={state} />
          <QuestCard garden={state} />
          <MapSection
            garden={state}
            assignments={assignments}
            greenhousePlotIds={greenhousePlotIds}
          />
          <ComposterPanel composter={state.composter} />
          <VisitorsPanel visitors={state.visitors} />
        </>
      )}
    </>
  );
}
