import {
  ALL_CROPS,
  COMPOST_ID,
  cropValues,
  LOOSE_COMPOST_MAX_COST,
  plotCoinCost,
} from "@garden-hq/core";
import { useBazaar } from "../state/queries";
import { useNow } from "../state/useNow";

function fmt(value: number | null): string {
  return value === null ? "no data" : Math.round(value).toLocaleString("en-US");
}

const cropName = (id: string) => ALL_CROPS.find((c) => c.id === id)?.name ?? id;

export function BazaarHints({
  nextPlot,
}: {
  /** The cheapest plot you can buy next and its cost in Compost. */
  nextPlot?: { plotNumber: number; cost: number };
}) {
  const bazaar = useBazaar();
  const now = useNow(30_000);
  const data = bazaar.data;

  if (data === undefined) {
    return (
      <section className="card" aria-label="Bazaar hints">
        <h2>Bazaar</h2>
        {bazaar.isError ? (
          <p className="muted">Bazaar prices unavailable right now.</p>
        ) : (
          <p className="muted">Loading Bazaar prices…</p>
        )}
      </section>
    );
  }

  const snapshot = { prices: data.prices, lastUpdated: data.lastUpdated };
  const values = cropValues(snapshot);
  const compost = data.prices[COMPOST_ID]?.sellOffer ?? null;
  // Rungs above the threshold are paid in Compost Bundles (ratio unverified).
  const loose =
    nextPlot !== undefined && nextPlot.cost <= LOOSE_COMPOST_MAX_COST;
  const coins =
    nextPlot !== undefined && loose
      ? plotCoinCost(nextPlot.cost, snapshot)
      : null;
  const showNextPlot = loose && coins !== null;
  const asOf = data.lastUpdated ?? Date.parse(data.fetchedAt);
  const minutes = Number.isFinite(asOf)
    ? Math.max(0, Math.floor((now - asOf) / 60_000))
    : null;

  return (
    <section className="card bazaar" aria-label="Bazaar hints">
      <h2>Bazaar</h2>
      <p className="muted">Coins per 160 crops, not per hour.</p>
      <table className="bazaar-list">
        <caption className="sr-only">
          Crop sale value in coins per 160 crops
        </caption>
        <thead className="bazaar-head">
          <tr>
            <th scope="col">Crop</th>
            <th scope="col" className="num">
              Sell offer
            </th>
            <th scope="col" className="num">
              Instant sell
            </th>
          </tr>
        </thead>
        <tbody>
          {values.map((v, i) => (
            <tr key={v.cropId} className="bazaar-row">
              <th scope="row">
                {cropName(v.cropId)}
                {i === 0 && v.sellOffer !== null ? (
                  <span className="pill"> Best</span>
                ) : null}
              </th>
              <td className="num">{fmt(v.sellOffer)}</td>
              <td className="num">{fmt(v.instantSell)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compost !== null ? (
        <p>
          <strong>Compost:</strong> <span className="num">{fmt(compost)}</span>{" "}
          coins each
        </p>
      ) : null}
      {showNextPlot && nextPlot !== undefined ? (
        <p>
          Next plot (Plot {nextPlot.plotNumber}):{" "}
          <span className="num">{nextPlot.cost}</span> Compost ~{" "}
          <span className="num">{fmt(coins)}</span> coins
        </p>
      ) : null}
      <p className="muted">
        {minutes === null
          ? "Price age unknown"
          : `Prices as of ${minutes} min ago`}
      </p>
    </section>
  );
}
