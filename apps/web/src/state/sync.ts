import {
  applyOps,
  enqueueOp,
  isSyncCode,
  MAX_OPS_PER_REQUEST,
  normalizeSyncCode,
  parseOps,
  planJoin,
  seedOps,
  type StoredData as SyncedData,
  type SyncOp,
  type SyncStateResponse,
} from "@garden-hq/core";
import { ApiError, type SyncApi } from "../api/client";
import type {
  Backing,
  GardenStorage,
  StoredData as LocalData,
} from "./storage";

const REJECTED_MESSAGE =
  "Some changes were rejected by the server and were dropped.";
const KEY = "garden-hq:sync:v1";
/** Visibility/online triggers skip a pull this soon after the last exchange. */
const TRIGGER_MIN_INTERVAL_MS = 5_000;

export type SyncStatus =
  "signed_out" | "idle" | "syncing" | "offline" | "unauthorized" | "error";

export interface SyncSnapshot {
  /** Normalized sync code, or null when cloud save is off on this device. */
  code: string | null;
  status: SyncStatus;
  pending: number;
  /** Epoch ms of the last successful exchange. */
  syncedAt: number | null;
  /** From the last join. */
  summary: { added: number; kept: number } | null;
  error: string | null;
}

export interface SyncEngine {
  /** Decorated: mutators also enqueue ops. */
  readonly storage: GardenStorage;
  getSnapshot(): SyncSnapshot;
  subscribe(listener: () => void): () => void;
  enableWithNewAccount(): Promise<void>;
  joinWithCode(raw: string): Promise<void>;
  flush(): Promise<void>;
  /** Forget the code on this device, keep data. */
  signOut(): void;
  deleteCloud(): Promise<void>;
  /** Attaches visibility/online listeners and flushes once; returns cleanup. */
  start(): () => void;
}

interface Persisted {
  code: string | null;
  pending: SyncOp[];
  etag: string | null;
  syncedAt: number | null;
}

function loadPersisted(backing: Backing | null): Persisted {
  const empty: Persisted = {
    code: null,
    pending: [],
    etag: null,
    syncedAt: null,
  };
  if (backing === null) return empty;
  try {
    const raw = backing.getItem(KEY);
    if (raw === null) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const p = parsed as Record<string, unknown>;
    if (typeof p.code !== "string" || !isSyncCode(p.code)) return empty;
    return {
      code: p.code,
      pending: Array.isArray(p.pending) ? sendable(p.pending as SyncOp[]) : [],
      etag: typeof p.etag === "string" ? p.etag : null,
      syncedAt:
        typeof p.syncedAt === "number" && Number.isFinite(p.syncedAt)
          ? p.syncedAt
          : null,
    };
  } catch {
    return empty;
  }
}

/** Drops ops the server's parseOps would reject (stale local ids, junk). */
function sendable(ops: readonly SyncOp[]): SyncOp[] {
  return ops.filter((op) => parseOps([op]).ok);
}

function withoutRevision(state: SyncStateResponse): SyncedData {
  return {
    link: state.link,
    assignments: state.assignments,
    greenhouses: state.greenhouses,
    timeZone: state.timeZone,
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function describeError(e: unknown): {
  status: SyncStatus;
  error: string | null;
} {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "network":
        return { status: "offline", error: null };
      case "unauthorized":
        return {
          status: "unauthorized",
          error: "This sync code is no longer valid.",
        };
      case "rate_limited":
        return {
          status: "error",
          // Long waits (daily budgets) read better in the server's own words.
          error:
            (e.retryAfter ?? 0) > 300 && e.message !== ""
              ? e.message
              : `Too many requests. Try again in ${e.retryAfter ?? 60}s.`,
        };
      default:
        return { status: "error", error: e.message };
    }
  }
  return {
    status: "error",
    error: e instanceof Error ? e.message : "Sync failed.",
  };
}

function sameSnapshot(a: SyncSnapshot, b: SyncSnapshot): boolean {
  return (
    a.code === b.code &&
    a.status === b.status &&
    a.pending === b.pending &&
    a.syncedAt === b.syncedAt &&
    a.error === b.error &&
    a.summary?.added === b.summary?.added &&
    a.summary?.kept === b.summary?.kept &&
    (a.summary === null) === (b.summary === null)
  );
}

export function createSyncEngine(opts: {
  base: GardenStorage;
  api: SyncApi;
  backing: Backing | null;
  now?: () => number;
  debounceMs?: number;
}): SyncEngine {
  const { base, api, backing } = opts;
  const now = opts.now ?? (() => Date.now());
  const debounceMs = opts.debounceMs ?? 2000;

  const persisted: Persisted = loadPersisted(backing);
  /** Taken from `pending` while a request runs. */
  let inFlight: SyncOp[] = [];
  let status: SyncStatus = persisted.code === null ? "signed_out" : "idle";
  let summary: SyncSnapshot["summary"] = null;
  let error: string | null = null;
  let running: Promise<void> | null = null;
  let runningEpoch = -1;
  /** True while joinWithCode is in flight: old-code flushes must not touch base. */
  let joining = false;
  /** Ops the user produced while a join was running; they win over the joined state. */
  let joinBuffer: SyncOp[] = [];
  /** Bumped by sign-out/join so a stale in-flight flush discards its result. */
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function buildSnapshot(): SyncSnapshot {
    return {
      code: persisted.code,
      status,
      pending: inFlight.length + persisted.pending.length,
      syncedAt: persisted.syncedAt,
      summary,
      error,
    };
  }
  let snapshot = buildSnapshot();

  function notify(): void {
    const next = buildSnapshot();
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    listeners.forEach((l) => l());
  }

  function save(): void {
    if (backing === null) return;
    try {
      if (persisted.code === null) {
        backing.removeItem(KEY);
        return;
      }
      backing.setItem(
        KEY,
        JSON.stringify({
          code: persisted.code,
          pending: [...inFlight, ...persisted.pending],
          etag: persisted.etag,
          syncedAt: persisted.syncedAt,
        }),
      );
    } catch {
      // Storage unavailable or full: the queue lives in memory only.
    }
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  }

  function enqueue(op: SyncOp): void {
    if (persisted.code === null) return;
    if (sendable([op]).length === 0) return;
    persisted.pending = enqueueOp(persisted.pending, op);
    save();
    notify();
    // A running flush picks the op up itself; unauthorized never auto-retries.
    if (
      (running === null || runningEpoch !== epoch) &&
      status !== "unauthorized"
    ) {
      schedule();
    }
  }

  /** Rebases not-yet-acknowledged ops on top of the server state. */
  function applyServer(state: SyncStateResponse): void {
    const server = withoutRevision(state);
    const local = base.getSnapshot();
    const merged: LocalData = {
      ...server,
      link: server.link ?? local.link,
      progress: local.progress,
    };
    base.replaceAll(applyOps(merged, [...inFlight, ...persisted.pending]));
  }

  async function run(code: string, gen: number): Promise<void> {
    status = "syncing";
    error = null;
    notify();
    let dropped = false;
    try {
      let pulled = false;
      for (;;) {
        let pushed = false;
        while (persisted.pending.length > 0) {
          inFlight = persisted.pending.slice(0, MAX_OPS_PER_REQUEST);
          persisted.pending = persisted.pending.slice(inFlight.length);
          save();
          let result: Awaited<ReturnType<SyncApi["postSync"]>>;
          try {
            result = await api.postSync(code, inFlight);
          } catch (e) {
            if (gen !== epoch) return;
            if (e instanceof ApiError && e.code === "bad_request") {
              // The server will never accept this chunk: drop it so the queue can move on.
              inFlight = [];
              dropped = true;
              save();
              continue;
            }
            throw e;
          }
          if (gen !== epoch) return;
          if (joining) {
            // A join is replacing local state: do not write old-account data into it.
            inFlight = [];
            persisted.etag = null;
            status = "idle";
            notify();
            return;
          }
          inFlight = [];
          if ((result.state.rejected ?? 0) > 0) dropped = true;
          persisted.syncedAt = now();
          if (dropped) {
            // Something was rejected or dropped this run: rebasing onto the
            // server state would erase the local data behind it. Leave local
            // state alone and force a fresh pull on a later exchange.
            persisted.etag = null;
          } else {
            persisted.etag = result.etag;
            applyServer(result.state);
          }
          save();
          notify();
          pushed = true;
        }
        if (pushed || pulled) {
          if (persisted.pending.length === 0) break;
          continue;
        }
        // A dropped chunk must never be followed by a wiping pull.
        if (dropped) break;
        const pull = await api.getSync(code, persisted.etag);
        if (gen !== epoch) return;
        if (joining) {
          status = "idle";
          notify();
          return;
        }
        if (pull !== null) {
          persisted.etag = pull.etag;
          applyServer(pull.state);
        }
        persisted.syncedAt = now();
        save();
        pulled = true;
        if (persisted.pending.length === 0) break;
      }
      status = dropped ? "error" : "idle";
      error = dropped ? REJECTED_MESSAGE : null;
    } catch (e) {
      if (gen !== epoch) return;
      persisted.pending = [...inFlight, ...persisted.pending];
      inFlight = [];
      ({ status, error } = describeError(e));
      if (dropped) {
        // Keep surfacing the dropped chunk even if a later one failed.
        error =
          error === null ? REJECTED_MESSAGE : `${REJECTED_MESSAGE} ${error}`;
        if (status === "offline") status = "error";
      }
      save();
    }
    notify();
  }

  function flush(): Promise<void> {
    const code = persisted.code;
    if (code === null || status === "unauthorized") return Promise.resolve();
    clearTimer();
    if (running !== null && runningEpoch === epoch) return running;
    const gen = epoch;
    const current = run(code, gen).finally(() => {
      if (running === current) running = null;
    });
    running = current;
    runningEpoch = gen;
    return current;
  }

  /** Listener-driven flush: skip a redundant pull right after an exchange. */
  function trigger(): void {
    if (
      persisted.pending.length === 0 &&
      inFlight.length === 0 &&
      status === "idle" &&
      persisted.syncedAt !== null &&
      now() - persisted.syncedAt < TRIGGER_MIN_INTERVAL_MS
    ) {
      return;
    }
    void flush();
  }

  function wrap<A extends unknown[], R>(
    fn: (...a: A) => R,
    toOp: (...a: A) => SyncOp,
  ): (...a: A) => R {
    return (...a: A): R => {
      const before = base.getSnapshot();
      const result = fn(...a);
      if (base.getSnapshot() !== before) {
        const op = toOp(...a);
        enqueue(op);
        if (joining) joinBuffer.push(op);
      }
      return result;
    };
  }

  const storage: GardenStorage = {
    ...base,
    setLink: wrap(base.setLink, (link) => ({ t: "setLink", link })),
    setAssignment: wrap(base.setAssignment, (plotId, cropId) => ({
      t: "setAssignment",
      plotId,
      cropId,
    })),
    markGreenhouse: wrap(base.markGreenhouse, (plotId) => ({
      t: "markGreenhouse",
      plotId,
    })),
    unmarkGreenhouse: wrap(base.unmarkGreenhouse, (plotId) => ({
      t: "unmarkGreenhouse",
      plotId,
    })),
    setGreenhouseCell: wrap(
      base.setGreenhouseCell,
      (plotId, cellKey, contentId) => ({
        t: "setGreenhouseCell",
        plotId,
        cellKey,
        contentId,
      }),
    ),
    markGreenhouseWatered: wrap(base.markGreenhouseWatered, (plotId, at) => ({
      t: "markGreenhouseWatered",
      plotId,
      at,
    })),
    setWateringInterval: wrap(base.setWateringInterval, (plotId, hours) => ({
      t: "setWateringInterval",
      plotId,
      hours,
    })),
    setTimeZone: wrap(base.setTimeZone, (timeZone) => ({
      t: "setTimeZone",
      timeZone,
    })),
  };

  function adopt(code: string): void {
    epoch++;
    clearTimer();
    inFlight = [];
    persisted.code = code;
    persisted.pending = [];
    persisted.etag = null;
    persisted.syncedAt = null;
    status = "idle";
    error = null;
  }

  async function enableWithNewAccount(): Promise<void> {
    if (persisted.code !== null) {
      throw new Error("Cloud save is already on for this device.");
    }
    const link = base.getSnapshot().link;
    if (link === null) {
      throw new Error(
        "Link your Minecraft account before turning on cloud save.",
      );
    }
    const { syncCode } = await api.createAccount(link);
    adopt(normalizeSyncCode(syncCode));
    summary = null;
    // Queue the seed; flush sends it in chunks and keeps it queued on failure.
    persisted.pending = sendable(seedOps(base.getSnapshot()));
    save();
    notify();
    await flush();
  }

  async function joinWithCode(raw: string): Promise<void> {
    const code = normalizeSyncCode(raw);
    if (!isSyncCode(code)) {
      throw new Error("That does not look like a sync code.");
    }
    if (joining) throw new Error("A join is already in progress.");
    joining = true;
    joinBuffer = [];
    let succeeded = false;
    try {
      const first = await api.getSync(code, null);
      if (first === null)
        throw new ApiError("bad_response", 304, "Empty reply");
      const server = withoutRevision(first.state);
      const local = base.getSnapshot();
      const plan = planJoin(local, server);
      const ops = sendable(plan.ops);

      let latest = first;
      for (const part of chunks(ops, MAX_OPS_PER_REQUEST)) {
        latest = await api.postSync(code, part);
      }

      // Everything succeeded: only now touch local state.
      const finalState = withoutRevision(latest.state);
      const edits = sendable(joinBuffer);
      const currentLink = base.getSnapshot().link;
      adopt(code);
      // The user's own mid-join edits win, exactly like normal rebasing.
      persisted.pending = edits.reduce<SyncOp[]>(enqueueOp, []);
      base.replaceAll(
        applyOps(
          {
            ...finalState,
            link: finalState.link ?? currentLink,
            progress: base.getSnapshot().progress,
          },
          edits,
        ),
      );
      persisted.etag = latest.etag;
      persisted.syncedAt = now();
      summary = {
        added: plan.added - (plan.ops.length - ops.length),
        kept: plan.kept,
      };
      succeeded = true;
      save();
      notify();
      if (persisted.pending.length > 0) schedule();
    } finally {
      joining = false;
      joinBuffer = [];
      // A failed join leaves the old account in place: an old-code flush whose
      // response was dropped mid-join may have left chunks waiting.
      if (
        !succeeded &&
        persisted.code !== null &&
        persisted.pending.length > 0 &&
        status !== "unauthorized"
      ) {
        schedule();
      }
    }
  }

  function signOut(): void {
    epoch++;
    clearTimer();
    inFlight = [];
    persisted.code = null;
    persisted.pending = [];
    persisted.etag = null;
    persisted.syncedAt = null;
    status = "signed_out";
    summary = null;
    error = null;
    save();
    notify();
  }

  async function deleteCloud(): Promise<void> {
    const code = persisted.code;
    if (code === null) return;
    try {
      await api.deleteAccount(code);
    } catch (e) {
      const described = describeError(e);
      status = described.status;
      error =
        described.error ??
        (e instanceof Error ? e.message : "Could not delete the cloud save.");
      notify();
      return;
    }
    signOut();
  }

  function start(): () => void {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") trigger();
    };
    const onOnline = (): void => trigger();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }
    void flush();
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
      clearTimer();
    };
  }

  return {
    storage,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enableWithNewAccount,
    joinWithCode,
    flush,
    signOut,
    deleteCloud,
    start,
  };
}
