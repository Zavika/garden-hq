import {
  ALERT_BOUNDS,
  ALERT_TYPES,
  alertParam,
  type AlertRules,
  type AlertsStateResponse,
  type AlertType,
} from "@garden-hq/core";
import { useEffect, useState } from "react";
import { api, ApiError, type AlertsApi } from "../api/client";
import { useSyncSnapshot } from "../state/SyncProvider";

const LABELS: Record<
  AlertType,
  { label: string; unit?: string; hint?: string }
> = {
  contest_soon: {
    label: "Jacob's Contest with one of my crops",
    unit: "minutes before it starts",
  },
  composter_fuel_out: { label: "Composter ran out of fuel" },
  composter_fuel_low: {
    label: "Composter fuel running low (early warning)",
    unit: "minutes before it runs out",
  },
  visitors_waiting: {
    label: "Visitor queue is full",
    unit: "visitors in the queue",
  },
  greenhouse_water: {
    label: "Greenhouse needs water",
    hint: "Set a watering interval on the Greenhouse screen first.",
  },
};

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "network") {
      return "Can't reach the server. Try again when you're online.";
    }
    if (e.code === "rate_limited" && e.message !== "") return e.message;
    if (e.code === "bad_request" && e.message !== "") return e.message;
  }
  return "Something went wrong. Try again.";
}

// Re-keying on the stored value resets a row's draft after a save.
function ruleKey(type: AlertType, rules: AlertRules): string {
  const param = alertParam(type);
  return param === null ? type : `${type}:${String(rules[type][param])}`;
}

function RuleRow({
  type,
  rules,
  busy,
  onChange,
}: {
  type: AlertType;
  rules: AlertRules;
  busy: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const rule = rules[type];
  const { label, unit, hint } = LABELS[type];
  const param = alertParam(type);
  const stored = param === null ? undefined : rule[param];
  const [draft, setDraft] = useState(String(stored ?? ""));
  const [error, setError] = useState<string | null>(null);

  function commit() {
    if (param === null) return;
    const { min, max } = ALERT_BOUNDS[param];
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
      setError(`Enter a whole number from ${min} to ${max}.`);
      return;
    }
    setError(null);
    if (n !== stored) onChange({ [param]: n });
  }

  return (
    <div className="alert-rule">
      <label>
        <input
          type="checkbox"
          checked={rule.enabled}
          disabled={busy}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />{" "}
        {label}
      </label>
      {param !== null && unit !== undefined ? (
        <label className="muted">
          <input
            type="number"
            inputMode="numeric"
            aria-label={`${label}: ${unit}`}
            value={draft}
            min={ALERT_BOUNDS[param].min}
            max={ALERT_BOUNDS[param].max}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />{" "}
          {unit}
        </label>
      ) : null}
      {hint !== undefined ? <p className="muted">{hint}</p> : null}
      {error !== null ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function AlertsSection({ client = api }: { client?: AlertsApi }) {
  const { code } = useSyncSnapshot();
  if (code === null) {
    return (
      <section>
        <h2>Discord alerts</h2>
        <p className="muted">
          Turn on Cloud save to get Discord alerts: the server needs your data
          to watch your Garden.
        </p>
      </section>
    );
  }
  return <AlertsBody key={code} code={code} client={client} />;
}

function AlertsBody({ code, client }: { code: string; client: AlertsApi }) {
  const [state, setState] = useState<AlertsStateResponse | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .getAlerts(code)
      .then((s) => live && setState(s))
      .catch((e: unknown) => live && setMessage(describeError(e)));
    return () => {
      live = false;
    };
  }, [client, code]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const saveWebhook = () =>
    run(async () => {
      setState(await client.putWebhook(code, url.trim()));
      setUrl("");
    });

  const sendTest = () =>
    run(async () => {
      const { test, ...next } = await client.testWebhook(code);
      setState(next);
      setMessage(
        test === "sent"
          ? "Test message sent. Check your Discord channel."
          : test === "dead"
            ? "Discord says this webhook no longer exists. Add a new one."
            : "Couldn't reach Discord. Try again in a minute.",
      );
    });

  const changeRule = (type: AlertType, patch: Record<string, unknown>) =>
    run(async () => setState(await client.putRules(code, { [type]: patch })));

  const remove = () =>
    run(async () => {
      await client.deleteWebhook(code);
      setState({
        hasWebhook: false,
        webhookLast4: null,
        webhookOk: null,
        rules: null,
      });
      setConfirming(false);
    });

  const rules = state?.rules ?? null;

  return (
    <section>
      <h2>Discord alerts</h2>
      {state === null && message === null ? (
        <p className="muted">Loading…</p>
      ) : null}

      {state !== null && !state.hasWebhook ? (
        <>
          <label>
            Discord webhook URL
            <input
              type="url"
              value={url}
              placeholder="https://discord.com/api/webhooks/…"
              autoComplete="off"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || url.trim() === ""}
            onClick={() => void saveWebhook()}
          >
            Save webhook
          </button>
          <p className="muted">
            Server settings → Integrations → Webhooks in Discord. The URL is
            kept on our server and never shown again.
          </p>
        </>
      ) : null}

      {state?.hasWebhook ? (
        <>
          <p>Webhook ending in {state.webhookLast4}</p>
          {state.webhookOk === null ? (
            <p className="muted">Send a test message to turn alerts on.</p>
          ) : null}
          {state.webhookOk === false ? (
            <p role="alert">
              Discord says this webhook no longer exists. Remove it and add a
              new one.
            </p>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void sendTest()}>
            Send test message
          </button>
          {state.webhookOk === true && rules !== null
            ? ALERT_TYPES.map((type) => (
                <RuleRow
                  key={ruleKey(type, rules)}
                  type={type}
                  rules={rules}
                  busy={busy}
                  onChange={(patch) => void changeRule(type, patch)}
                />
              ))
            : null}
          {confirming ? (
            <>
              <p>Remove the webhook and stop all Discord alerts?</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                Yes, remove
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remove webhook
            </button>
          )}
        </>
      ) : null}

      {message !== null ? <p role="status">{message}</p> : null}
    </section>
  );
}
