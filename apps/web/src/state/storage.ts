import {
  applyOp,
  CELL_KEY_RE,
  DEFAULT_TIME_ZONE,
  EMPTY_STORED_DATA,
  getPlot,
  isPlaceableId,
  MAX_GREENHOUSES,
  MAX_WATERING_INTERVAL_HOURS,
  validWateringInterval,
  type GreenhouseSave,
  type ProfileSummary,
  type StoredData,
  type StoredLink,
  type SyncOp,
} from "@garden-hq/core";

export {
  DEFAULT_TIME_ZONE,
  MAX_GREENHOUSES,
  MAX_WATERING_INTERVAL_HOURS,
  type GreenhouseSave,
  type StoredData,
  type StoredLink,
};

const STORAGE_KEY = "garden-hq:v1";

export type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface GardenStorage {
  getSnapshot(): StoredData;
  subscribe(listener: () => void): () => void;
  setLink(link: StoredLink): void;
  clearLink(): void;
  setAssignment(plotId: string, cropId: string | null): void;
  /** Marks a plot as a Greenhouse. False if at the maximum or the plot is unknown. */
  markGreenhouse(plotId: string): boolean;
  unmarkGreenhouse(plotId: string): void;
  setGreenhouseCell(
    plotId: string,
    cellKey: string,
    contentId: string | null,
  ): void;
  markGreenhouseWatered(plotId: string, at: number): void;
  setWateringInterval(plotId: string, hours: number | null): void;
  setTimeZone(timeZone: string): void;
  clearAll(): void;
  /** Swaps in sanitized data without any op side effects (sync engine). */
  replaceAll(next: StoredData): void;
}

function isProfile(v: unknown): v is ProfileSummary {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.profileId === "string" &&
    typeof p.name === "string" &&
    typeof p.selected === "boolean"
  );
}

function parseLink(v: unknown): StoredLink | null {
  if (typeof v !== "object" || v === null) return null;
  const l = v as Record<string, unknown>;
  if (
    typeof l.name !== "string" ||
    typeof l.uuid !== "string" ||
    typeof l.profileId !== "string" ||
    !Array.isArray(l.profiles)
  ) {
    return null;
  }
  return {
    name: l.name,
    uuid: l.uuid,
    profileId: l.profileId,
    profiles: l.profiles.filter(isProfile),
  };
}

function parseAssignments(v: unknown): Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function parseGreenhouses(v: unknown): Record<string, GreenhouseSave> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: Record<string, GreenhouseSave> = {};
  for (const [plotId, raw] of Object.entries(v)) {
    if (Object.keys(out).length >= MAX_GREENHOUSES) break;
    if (getPlot(plotId) === undefined) continue;
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const cells: Record<string, string> = {};
    if (
      typeof r.cells === "object" &&
      r.cells !== null &&
      !Array.isArray(r.cells)
    ) {
      for (const [key, id] of Object.entries(r.cells)) {
        if (
          CELL_KEY_RE.test(key) &&
          typeof id === "string" &&
          isPlaceableId(id)
        ) {
          cells[key] = id;
        }
      }
    }
    out[plotId] = {
      cells,
      lastWateredAt:
        typeof r.lastWateredAt === "number" && Number.isFinite(r.lastWateredAt)
          ? r.lastWateredAt
          : null,
      wateringIntervalHours: validWateringInterval(r.wateringIntervalHours),
    };
  }
  return out;
}

export function sanitize(raw: unknown): StoredData {
  if (typeof raw !== "object" || raw === null) return EMPTY_STORED_DATA;
  const d = raw as Record<string, unknown>;
  return {
    link: parseLink(d.link),
    assignments: parseAssignments(d.assignments),
    greenhouses: parseGreenhouses(d.greenhouses),
    timeZone: typeof d.timeZone === "string" ? d.timeZone : DEFAULT_TIME_ZONE,
  };
}

function load(backing: Backing | null): StoredData {
  if (backing === null) return EMPTY_STORED_DATA;
  try {
    const raw = backing.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_STORED_DATA;
    return sanitize(JSON.parse(raw));
  } catch {
    return EMPTY_STORED_DATA;
  }
}

export function createGardenStorage(backing: Backing | null): GardenStorage {
  let data = load(backing);
  const listeners = new Set<() => void>();

  function commit(next: StoredData): void {
    data = next;
    if (backing !== null) {
      try {
        backing.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable or full: keep going with in-memory state only.
      }
    }
    listeners.forEach((listener) => listener());
  }

  function commitOp(op: SyncOp): StoredData {
    const next = applyOp(data, op);
    if (next !== data) commit(next);
    return next;
  }

  return {
    getSnapshot: () => data,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLink: (link) => void commitOp({ t: "setLink", link }),
    clearLink: () => commit({ ...data, link: null }),
    setAssignment: (plotId, cropId) =>
      void commitOp({ t: "setAssignment", plotId, cropId }),
    markGreenhouse: (plotId) =>
      plotId in commitOp({ t: "markGreenhouse", plotId }).greenhouses,
    unmarkGreenhouse: (plotId) =>
      void commitOp({ t: "unmarkGreenhouse", plotId }),
    setGreenhouseCell: (plotId, cellKey, contentId) =>
      void commitOp({ t: "setGreenhouseCell", plotId, cellKey, contentId }),
    markGreenhouseWatered: (plotId, at) =>
      void commitOp({ t: "markGreenhouseWatered", plotId, at }),
    setWateringInterval: (plotId, hours) =>
      void commitOp({ t: "setWateringInterval", plotId, hours }),
    setTimeZone: (timeZone) => void commitOp({ t: "setTimeZone", timeZone }),
    clearAll: () => commit({ ...EMPTY_STORED_DATA }),
    replaceAll: (next) => commit(sanitize(next)),
  };
}

export function browserBacking(): Backing | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
