import type { ComposterState } from "@garden-hq/core";
import { useNow } from "../state/useNow";
import { buildComposterViewModel } from "../viewmodels/composter";

function at(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleString();
}

function Gauge({
  label,
  ratio,
  value,
}: {
  label: string;
  ratio: number;
  value: number;
}) {
  return (
    <div>
      <div>
        {label}: {Math.round(value).toLocaleString()}
      </div>
      <div
        className="gauge"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function ComposterPanel({ composter }: { composter: ComposterState }) {
  const now = useNow(10_000);
  const vm = buildComposterViewModel(composter, now);

  return (
    <section className="card" aria-label="Composter">
      <h2>Composter</h2>
      <Gauge label="Fuel" ratio={vm.fuelRatio} value={vm.fuel} />
      <Gauge
        label="Organic matter"
        ratio={vm.organicMatterRatio}
        value={vm.organicMatter}
      />
      <p>Compost ready: {vm.compostReady}</p>
      <p>Fuel runs out at {at(vm.fuelRunsOutAt)}</p>
      <p>Organic matter runs out at {at(vm.organicMatterRunsOutAt)}</p>
    </section>
  );
}
