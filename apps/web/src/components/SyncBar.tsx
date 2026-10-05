import { useNow } from "../state/useNow";

export function SyncBar({
  fetchedAt,
  isFetching,
  isStale,
  refreshDisabledUntil,
  onRefresh,
}: {
  fetchedAt: string | undefined;
  isFetching: boolean;
  isStale: boolean;
  /** epoch ms until which refresh is disabled (rate limit), or null. */
  refreshDisabledUntil: number | null;
  onRefresh: () => void;
}) {
  const now = useNow(30_000);
  const minutes =
    fetchedAt === undefined
      ? null
      : Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 60_000));
  const limited = refreshDisabledUntil !== null && refreshDisabledUntil > now;

  return (
    <div className="card">
      <span>
        {minutes === null ? "Not synced yet" : `Last synced ${minutes} min ago`}
        {isStale ? " (stale — showing last good data)" : ""}
      </span>{" "}
      <button
        type="button"
        onClick={onRefresh}
        disabled={isFetching || limited}
      >
        {limited ? "Rate limited" : isFetching ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
