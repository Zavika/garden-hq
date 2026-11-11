import {
  dayKey,
  getAchievement,
  nextResetMs,
  questProgress,
  questTitle,
  type GardenState,
  type ProgressEvent,
} from "@garden-hq/core";
import { Link } from "react-router-dom";
import { eventKey, useProgressEvents } from "../state/progressEvents";
import { useStorage, useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";
import { Countdown } from "./Countdown";

function Num({ children }: { children: number | string }) {
  return <span className="num">{children}</span>;
}

function eventMessage(event: ProgressEvent) {
  switch (event.type) {
    case "quest_done":
      return (
        <>
          Quest done: +<Num>{event.xp}</Num> XP
        </>
      );
    case "achievement":
      return (
        <>
          Achievement unlocked: {getAchievement(event.id)?.title ?? event.id} (+
          <Num>{event.xp}</Num> XP)
        </>
      );
    case "backfill":
      return (
        <>
          <Num>{event.count}</Num> achievements already earned (+
          <Num>{event.xp}</Num> XP)
        </>
      );
  }
}

export function QuestCard({ garden }: { garden: GardenState }) {
  const storage = useStorage();
  const { progress, timeZone, greenhouses } = useStoredData();
  const now = useNow(30_000);
  const events = useProgressEvents((s) => s.events);
  const clear = useProgressEvents((s) => s.clear);

  const today = dayKey(now, timeZone);
  const quests = progress.quests
    .filter((q) => q.day === today)
    .sort((a, b) => a.slot - b.slot);
  const allDone = quests.length > 0 && quests.every((q) => q.doneAt !== null);
  const firstPlotId = Object.keys(greenhouses)[0];

  return (
    <section className="card" aria-label="Daily quests">
      <h2>Daily quests</h2>
      <div role="status" className="quest-events">
        {events.length > 0 && (
          <>
            <ul className="quest-list">
              {events.map((event) => (
                <li key={eventKey(event)}>{eventMessage(event)}</li>
              ))}
            </ul>
            <button type="button" onClick={clear}>
              Dismiss
            </button>
          </>
        )}
      </div>
      {quests.length === 0 ? (
        <p>No quests yet today. They appear when your Garden syncs.</p>
      ) : (
        <ul className="quest-list">
          {quests.map((q) => {
            const done = q.doneAt !== null;
            const prog = done ? null : questProgress(q, garden);
            return (
              <li
                key={`${q.day}-${q.slot}`}
                className={done ? "quest done" : "quest"}
              >
                <span className="quest-box" aria-hidden="true" />
                <span className="quest-title">
                  {questTitle(q).map((part, i) =>
                    typeof part === "number" ? (
                      <Num key={i}>{part}</Num>
                    ) : (
                      <span key={i}>{part}</span>
                    ),
                  )}
                  {prog !== null && (
                    <>
                      {" "}
                      <span className="num muted">
                        {prog.current}/{prog.target}
                      </span>
                    </>
                  )}
                  {done && <span className="sr-only">done</span>}
                </span>
                <span className="quest-xp">
                  +<Num>{q.xp}</Num> XP
                </span>
                {q.kind === "water_greenhouse" &&
                  !done &&
                  firstPlotId !== undefined && (
                    <button
                      type="button"
                      className="quest-action"
                      onClick={() =>
                        storage.markGreenhouseWatered(firstPlotId, Date.now())
                      }
                    >
                      I watered it
                    </button>
                  )}
              </li>
            );
          })}
        </ul>
      )}
      {allDone && <p>All done — see you tomorrow.</p>}
      <p className="muted">
        Resets in <Countdown target={nextResetMs(now, timeZone)} />. Quests
        count from when they appear today.
      </p>
      <p>
        <Link className="link-target" to="/achievements">
          All achievements
        </Link>
      </p>
    </section>
  );
}
