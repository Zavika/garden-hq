import { prettifyId } from "@garden-hq/core";

export function ChipLevels({
  chips,
}: {
  chips: Readonly<Record<string, number>>;
}) {
  const entries = Object.entries(chips).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    <div>
      <h3>Chips</h3>
      <ul className="gh-chips">
        {entries.map(([id, level]) => (
          <li key={id}>{`${prettifyId(id)} Lv ${level}`}</li>
        ))}
      </ul>
    </div>
  );
}
