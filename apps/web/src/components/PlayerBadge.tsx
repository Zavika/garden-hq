import { dayKey, summarizeProgress } from "@garden-hq/core";
import { Link } from "react-router-dom";
import { useStoredData } from "../state/StorageProvider";
import { useNow } from "../state/useNow";
import { FlameIcon } from "./PixelArt";

const SEGMENTS = 10;

export function PlayerBadge() {
  const { progress, timeZone } = useStoredData();
  const now = useNow(30_000);
  const s = summarizeProgress(progress, dayKey(now, timeZone));
  const max = s.xpForNext;
  const filled =
    max === null ? SEGMENTS : Math.floor((SEGMENTS * s.xpIntoLevel) / max);

  const xpText = max === null ? "max level" : `${s.xpIntoLevel}/${max} XP`;
  const streakText = `streak ${s.streak} ${s.streak === 1 ? "day" : "days"}`;
  const riskText = s.atRisk ? ", streak at risk, complete a quest today" : "";
  const title = s.atRisk
    ? "Streak at risk: complete a quest today"
    : `Streak: ${s.streak} ${s.streak === 1 ? "day" : "days"}`;

  return (
    <Link
      to="/achievements"
      className="hud-item player-badge"
      aria-label={`Level ${s.level}, ${xpText}, ${streakText}${riskText}, view achievements`}
    >
      <span>
        Lv <span className="num">{s.level}</span>
      </span>
      <span
        className="xp-bar"
        role="progressbar"
        aria-label="Player XP"
        aria-valuemin={0}
        aria-valuenow={max === null ? 1 : s.xpIntoLevel}
        aria-valuemax={max === null ? 1 : max}
        aria-valuetext={max === null ? "Max level" : undefined}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} className={i < filled ? "on" : undefined} />
        ))}
      </span>
      <span className="num">
        {max === null ? s.xpIntoLevel : `${s.xpIntoLevel}/${max}`}
      </span>
      <span className={s.atRisk ? "streak at-risk" : "streak"} title={title}>
        <FlameIcon atRisk={s.atRisk} />
        <span className="num">{s.streak}</span>
        {s.atRisk ? (
          <span className="sr-only">
            streak at risk, complete a quest today
          </span>
        ) : null}
      </span>
    </Link>
  );
}
