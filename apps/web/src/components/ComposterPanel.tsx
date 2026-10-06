import type { ComposterState } from "@garden-hq/core";
import { useNow } from "../state/useNow";
import { buildComposterViewModel } from "../viewmodels/composter";

const SEGMENTS = 20;

function fmt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Chunky segmented bar with the numbers written on it. */
function Bar({
  label,
  unit,
  value,
  cap,
  ratio,
  tone,
}: {
  label: string;
  unit: string;
  value: number;
  cap: number;
  ratio: number;
  tone: "fuel" | "matter";
}) {
  const lit = Math.round(ratio * SEGMENTS);
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div
        className={`bar bar-${tone}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < lit ? "seg on" : "seg"} />
        ))}
      </div>
      <div className="bar-numbers">
        {fmt(value)} / {fmt(cap)} {unit}
      </div>
    </div>
  );
}

function stopTime(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ComposterPanel({ composter }: { composter: ComposterState }) {
  const now = useNow(10_000);
  const vm = buildComposterViewModel(composter, now);

  return (
    <section className="card" aria-label="Composter">
      <h2>Composter</h2>
      <Bar
        label="Fuel"
        unit="fuel"
        value={vm.fuel}
        cap={vm.fuelCap}
        ratio={vm.fuelRatio}
        tone="fuel"
      />
      <Bar
        label="Organic matter"
        unit="organic matter"
        value={vm.organicMatter}
        cap={vm.organicMatterCap}
        ratio={vm.organicMatterRatio}
        tone="matter"
      />
      <p className={vm.status === "running" ? "status ok" : "status idle"}>
        {vm.status === "no_fuel"
          ? "Composter idle — add fuel"
          : vm.status === "no_organic_matter"
            ? "Composter idle — add organic matter"
            : vm.stopsAt === null
              ? "Composter running"
              : `Running — ${vm.stopsBecause === "fuel" ? "fuel" : "organic matter"} lasts until ${stopTime(vm.stopsAt)}`}
      </p>
      <p className="compost-ready">
        <span className="pill">Compost ready</span>
        <strong className="num">{vm.compostReady}</strong>
      </p>
    </section>
  );
}
