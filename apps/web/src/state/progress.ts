import { stepProgress } from "@garden-hq/core";
import { useEffect } from "react";
import { useContests, useGarden, useMember } from "./queries";
import { useProgressEvents } from "./progressEvents";
import { useStorage, useStoredData } from "./StorageProvider";
import { useNow } from "./useNow";

/**
 * Feeds the latest snapshots to stepProgress; writes only when something
 * changed. stepProgress returns its input reference when nothing changes, so a
 * sync replacing `progress` with an equal copy does not loop.
 */
export function useProgressEngine(): void {
  const storage = useStorage();
  const { link, assignments, greenhouses, timeZone, progress } =
    useStoredData();
  const garden = useGarden(link?.profileId ?? null);
  const member = useMember(link?.profileId ?? null, link?.uuid ?? null);
  const contests = useContests();
  const now = useNow(30_000);
  const gardenData = garden.data;
  const memberData = member.data;
  const contestList = contests.data?.contests;
  // Quests are frozen at generation, so wait until member and contest queries
  // settle (success or error); otherwise their kinds depend on network timing.
  const settled = !member.isPending && !contests.isPending;

  useEffect(() => {
    if (link === null || gardenData === undefined || !settled) return;
    const result = stepProgress({
      now,
      timeZone,
      seed: link.uuid,
      profileId: link.profileId,
      progress,
      assignments,
      greenhouses,
      garden: gardenData.garden,
      gardenFetchedAt: Date.parse(gardenData.fetchedAt),
      member: memberData?.member ?? null,
      memberFetchedAt:
        memberData === undefined ? null : Date.parse(memberData.fetchedAt),
      contests: contestList ?? [],
    });
    if (result.progress !== progress) storage.setProgress(result.progress);
    if (result.events.length > 0) {
      useProgressEvents.getState().push(result.events);
    }
  }, [
    storage,
    link,
    gardenData,
    settled,
    memberData,
    contestList,
    now,
    timeZone,
    progress,
    assignments,
    greenhouses,
  ]);
}
