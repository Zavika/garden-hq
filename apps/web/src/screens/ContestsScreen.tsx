import { getCrop } from "@garden-hq/core";
import { useContests } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";
import { buildContestsViewModel } from "../viewmodels/contests";

export function ContestsScreen() {
  const now = useNow(60_000);
  const { assignments, timeZone } = useStoredData();
  const contests = useContests();

  if (contests.data === undefined) {
    return (
      <p>
        {contests.isError
          ? "The contest schedule is unavailable right now."
          : "Loading contests…"}
      </p>
    );
  }

  const vm = buildContestsViewModel(
    contests.data.contests,
    Object.values(assignments),
    now,
    timeZone,
  );
  const { source } = contests.data;

  return (
    <section className="card">
      <h1>Jacob&apos;s Contests</h1>
      {vm.filtered ? (
        <p>Showing contests that include your assigned crops.</p>
      ) : (
        <p>Assign crops to your plots on the map to filter this list.</p>
      )}
      <ul>
        {vm.rows.map((row) => (
          <li key={row.startsAt}>
            {row.label} ({timeZone}) —{" "}
            {row.crops.map((id) => getCrop(id)?.name ?? id).join(", ")}
          </li>
        ))}
      </ul>
      <p>
        Source:{" "}
        <a href={source.url} target="_blank" rel="noreferrer">
          {source.name}
        </a>
      </p>
    </section>
  );
}
