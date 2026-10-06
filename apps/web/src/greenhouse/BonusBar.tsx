import type { BonusResult } from "@garden-hq/core";

export function BonusBar({ bonus }: { bonus: BonusResult }) {
  return (
    <div className="gh-bonus">
      <p>
        <strong>
          {bonus.counted}/{bonus.max} unique crops
        </strong>{" "}
        — yield bonus +{bonus.percent}%
      </p>
      <progress
        value={bonus.counted}
        max={bonus.max}
        aria-label="Unique crop bonus"
      />
      {bonus.unique > bonus.max ? (
        <p className="muted">
          {bonus.unique} different crops placed; the bonus is capped at{" "}
          {bonus.max}.
        </p>
      ) : null}
    </div>
  );
}
