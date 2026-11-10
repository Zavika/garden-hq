import {
  ACHIEVEMENTS,
  achievementProgress,
  dayKey,
  summarizeProgress,
  type AchievementCheck,
  type AchievementStatus,
} from "@garden-hq/core";
import { Link } from "react-router-dom";
import { useProgressEngine } from "../state/progress";
import { useGarden, useMember } from "../state/queries";
import { useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";

type Row = Omit<AchievementStatus, "value"> & { value: number | null };

// Display text only: the unit shown after a locked achievement's progress.
const PROGRESS_UNIT: Record<AchievementCheck, string> = {
  first_greenhouse: "",
  plots_unlocked: "plots",
  crops_assigned: "crops",
  mutations_discovered: "mutations",
  garden_level: "",
  visitors_served: "visitors",
  streak: "",
  quests_done: "quests",
};

function formatDate(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { timeZone });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return new Date(ms).toLocaleDateString();
  }
}

function Num({ children }: { children: number | string }) {
  return <span className="num">{children}</span>;
}

export function AchievementsScreen() {
  useProgressEngine();
  const { link, progress, assignments, greenhouses, timeZone } =
    useStoredData();
  const now = useNow(60_000);
  const garden = useGarden(link?.profileId ?? null);
  const member = useMember(link?.profileId ?? null, link?.uuid ?? null);

  const summary = summarizeProgress(progress, dayKey(now, timeZone));
  const gardenData = garden.data;
  const memberReady = member.data !== undefined;
  const rows: Row[] =
    gardenData !== undefined
      ? achievementProgress(
          {
            garden: gardenData.garden,
            member: member.data?.member ?? null,
            assignments,
            greenhouses,
            summary,
          },
          progress.achievements,
        ).map((row): Row =>
          !memberReady &&
          row.unlocked === null &&
          (row.def.check === "mutations_discovered" ||
            row.def.check === "first_greenhouse")
            ? { ...row, value: null }
            : row,
        )
      : ACHIEVEMENTS.map((def) => ({
          def,
          value: null,
          unlocked: Object.hasOwn(progress.achievements, def.id)
            ? (progress.achievements[def.id] ?? null)
            : null,
        }));

  return (
    <section className="card" aria-label="Achievements">
      <p>
        <Link to="/">Back to Home</Link>
      </p>
      <h2>Achievements</h2>
      <p className="ach-summary">
        Player level <Num>{summary.level}</Num>
        {" - "}
        <Num>{summary.xpIntoLevel}</Num>
        {summary.xpForNext !== null && (
          <>
            /<Num>{summary.xpForNext}</Num>
          </>
        )}{" "}
        XP
        {" - "}Best streak <Num>{summary.bestStreak}</Num>
      </p>
      <ul className="achievements">
        {rows.map(({ def, value, unlocked }) => (
          <li
            key={def.id}
            className={unlocked !== null ? "ach" : "ach locked"}
            aria-disabled={unlocked === null ? true : undefined}
            data-locked={unlocked === null ? "true" : undefined}
          >
            <span className="ach-title">{def.title}</span>
            <span className="ach-desc muted">{def.description}</span>
            <span className="ach-meta">
              <span className="ach-xp">
                +<Num>{def.xp}</Num> XP
              </span>
              {unlocked !== null ? (
                <span>
                  Unlocked{" "}
                  <span className="num">
                    {formatDate(unlocked.at, timeZone)}
                  </span>
                </span>
              ) : (
                <span>
                  <span className="sr-only">Locked</span>
                  {value !== null && (
                    <>
                      <span className="num muted">
                        {Math.min(value, def.threshold)}/{def.threshold}
                      </span>
                      {PROGRESS_UNIT[def.check] !== "" && (
                        <span className="muted">
                          {" "}
                          {PROGRESS_UNIT[def.check]}
                        </span>
                      )}
                    </>
                  )}
                  {value === null && (
                    <span className="muted" aria-hidden="true">
                      Locked
                    </span>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
