import {
  MAX_SHOWN_ACTIONS,
  planActions,
  type GardenState,
  type PlannedAction,
} from "@garden-hq/core";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useContests } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";

/** Only actions that have their own screen link out; the rest are on Home already. */
const SCREEN: Partial<Record<PlannedAction["kind"], string>> = {
  contest_soon: "/contests",
  greenhouse_water: "/greenhouse",
};

export function DoNextCard({ garden }: { garden: GardenState }) {
  const now = useNow(30_000);
  const contests = useContests();
  const { assignments, greenhouses } = useStoredData();

  const actions = useMemo(
    () =>
      planActions({
        now,
        garden,
        contests: contests.data?.contests ?? [],
        assignments,
        greenhouses,
      }).slice(0, MAX_SHOWN_ACTIONS),
    [now, garden, contests.data, assignments, greenhouses],
  );

  return (
    <section className="card" aria-label="Do next">
      <h2>Do next</h2>
      {actions.length === 0 ? (
        <p>Nothing to do right now.</p>
      ) : (
        <ol className="do-next">
          {actions.map((action) => {
            const to = SCREEN[action.kind];
            return (
              <li key={action.id}>
                <strong>
                  {to === undefined ? (
                    action.title
                  ) : (
                    <Link to={to}>{action.title}</Link>
                  )}
                </strong>
                <span className="muted">{action.detail}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
