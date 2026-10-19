import { formatSyncCode, isSyncCode, normalizeSyncCode } from "@garden-hq/core";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useStoredData } from "../state/StorageProvider";
import { useSyncEngine, useSyncSnapshot } from "../state/SyncProvider";
import { useNow } from "../state/useNow";

const WARNING =
  "Save this somewhere safe. It is the only way to restore your data on another device or after clearing your browser. We cannot recover it.";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeError(e: unknown, joining: boolean): string {
  if (e instanceof ApiError) {
    if (e.code === "network") {
      return "Can't reach the server. Try again when you're online.";
    }
    if (e.code === "rate_limited") {
      return (e.retryAfter ?? 0) > 300 && e.message !== ""
        ? e.message
        : `Too many attempts. Try again in ${e.retryAfter ?? 60}s.`;
    }
    if (e.code === "unauthorized" && joining) {
      return "That code was not recognised.";
    }
  }
  return e instanceof Error && e.message !== ""
    ? e.message
    : "Something went wrong. Try again.";
}

export function SyncSection() {
  const snap = useSyncSnapshot();
  // Keyed on the code so reveal/confirm/message state never leaks across
  // sign-out or a new code.
  return <SyncSectionBody key={snap.code ?? "signed-out"} />;
}

function SyncSectionBody() {
  const engine = useSyncEngine();
  const snap = useSyncSnapshot();
  const { link } = useStoredData();
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    [],
  );

  async function run(
    action: () => Promise<void>,
    joining: boolean,
  ): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      return true;
    } catch (e) {
      setMessage(describeError(e, joining));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!isSyncCode(normalizeSyncCode(input))) {
      setMessage("That is not a valid code. Check it and try again.");
      return;
    }
    if (await run(() => engine.joinWithCode(input), true)) setInput("");
  }

  async function copy(text: string) {
    try {
      const write = navigator.clipboard?.writeText;
      if (typeof write !== "function") throw new Error("no clipboard");
      await write.call(navigator.clipboard, text);
      setMessage(null);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setRevealed(true);
      setMessage("Could not copy — select the code and copy it manually.");
    }
  }

  if (snap.code === null) {
    const linked = link !== null;
    return (
      <section className="card sync-section">
        <h2>Cloud save</h2>
        <p className="muted">
          Keep your plots and settings on our server so you can restore them on
          another device.
        </p>
        <button
          type="button"
          disabled={!linked || busy}
          onClick={() => void run(() => engine.enableWithNewAccount(), false)}
        >
          Save to cloud
        </button>
        {!linked ? <p className="muted">Link a Minecraft name first</p> : null}
        <label>
          I already have a code
          <input
            type="text"
            value={input}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void join()}>
          Use code
        </button>
        {message !== null ? <p role="alert">{message}</p> : null}
      </section>
    );
  }

  const formatted = formatSyncCode(normalizeSyncCode(snap.code));
  const masked = formatted.replace(/[^-]/g, "•");
  const minutes =
    snap.syncedAt === null
      ? null
      : Math.max(0, Math.floor((now - snap.syncedAt) / 60_000));
  const retry = snap.status === "error" || snap.status === "offline";

  return (
    <section className="card sync-section">
      <h2>Cloud save</h2>
      <p>
        <code className="sync-code">{revealed ? formatted : masked}</code>
      </p>
      <div className="sync-actions">
        <button type="button" onClick={() => setRevealed((r) => !r)}>
          {revealed ? "Hide" : "Show"}
        </button>
        <button type="button" onClick={() => void copy(formatted)}>
          Copy
        </button>
        <span role="status">{copied ? "Copied" : ""}</span>
      </div>
      <p>{WARNING}</p>

      <p className="muted" role="status">
        {minutes === null ? "Not synced yet" : `Last synced ${minutes} min ago`}
      </p>
      {snap.pending > 0 ? (
        <p className="muted">
          {plural(snap.pending, "change", "changes")} waiting to sync
        </p>
      ) : null}
      {snap.status === "offline" ? (
        <p>Offline — changes are saved on this device and will sync later.</p>
      ) : null}
      {snap.status === "unauthorized" ? (
        <p role="alert">
          This code was not recognised. Forget the sync code on this device,
          then enter your code again.
        </p>
      ) : null}
      {snap.status === "error" && snap.error !== null ? (
        <p role="alert">{snap.error}</p>
      ) : null}
      {retry ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void engine.flush()}
        >
          Try again now
        </button>
      ) : null}
      {snap.summary !== null ? (
        <p>
          {`Added ${plural(snap.summary.added, "item", "items")} from this device; kept the cloud version for ${snap.summary.kept}.`}
        </p>
      ) : null}
      {message !== null ? <p role="alert">{message}</p> : null}

      <div className="sync-actions">
        {confirmingForget ? (
          <>
            <span>
              Forget the sync code on this device? Your data stays on this
              device and in the cloud, but you will need the code to sync again.
              Make sure you have saved it.
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingForget(false);
                engine.signOut();
              }}
            >
              Yes, forget
            </button>
            <button type="button" onClick={() => setConfirmingForget(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className={snap.status === "unauthorized" ? "sync-primary" : ""}
            disabled={busy}
            onClick={() =>
              snap.status === "unauthorized"
                ? engine.signOut()
                : (setConfirming(false), setConfirmingForget(true))
            }
          >
            Forget sync code on this device
          </button>
        )}
        {confirming ? (
          <>
            <span>Really delete cloud data? This cannot be undone.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                void (async () => {
                  const ok = await run(() => engine.deleteCloud(), false);
                  // deleteCloud never rejects; a kept code means it failed.
                  if (ok && engine.getSnapshot().code !== null) {
                    setMessage(
                      "Couldn't delete the cloud copy. Check your connection and try again.",
                    );
                  }
                })();
              }}
            >
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => (setConfirmingForget(false), setConfirming(true))}
          >
            Delete cloud data
          </button>
        )}
      </div>
    </section>
  );
}
