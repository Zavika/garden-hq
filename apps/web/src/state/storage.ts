import { getPlot, isPlaceableId, type ProfileSummary } from "@garden-hq/core";

export interface StoredLink {
  name: string;
  uuid: string;
  profileId: string;
  profiles: ProfileSummary[];
}

export const MAX_GREENHOUSES = 3;

export interface GreenhouseSave {
  /** Cell key "x,z" -> placed crop or mutation id. */
  cells: Record<string, string>;
  /** Epoch ms of the player's last "I watered it" press, or null. */
  lastWateredAt: number | null;
}

export interface StoredData {
  link: StoredLink | null;
  assignments: Record<string, string>;
  greenhouses: Record<string, GreenhouseSave>;
  timeZone: string;
}

export const DEFAULT_TIME_ZONE = "Europe/Warsaw";
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
  setTimeZone(timeZone: string): void;
  clearAll(): void;
}

const EMPTY: StoredData = {
  link: null,
  assignments: {},
  greenhouses: {},
  timeZone: DEFAULT_TIME_ZONE,
};

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

const CELL_KEY_RE = /^\d,\d$/;

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
    };
  }
  return out;
}

function load(backing: Backing | null): StoredData {
  if (backing === null) return EMPTY;
  try {
    const raw = backing.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const d = parsed as Record<string, unknown>;
    return {
      link: parseLink(d.link),
      assignments: parseAssignments(d.assignments),
      greenhouses: parseGreenhouses(d.greenhouses),
      timeZone: typeof d.timeZone === "string" ? d.timeZone : DEFAULT_TIME_ZONE,
    };
  } catch {
    return EMPTY;
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

  return {
    getSnapshot: () => data,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLink: (link) => commit({ ...data, link }),
    clearLink: () => commit({ ...data, link: null }),
    setAssignment(plotId, cropId) {
      const assignments = { ...data.assignments };
      if (cropId === null) delete assignments[plotId];
      else assignments[plotId] = cropId;
      commit({ ...data, assignments });
    },
    markGreenhouse(plotId) {
      if (plotId in data.greenhouses) return true;
      if (
        getPlot(plotId) === undefined ||
        Object.keys(data.greenhouses).length >= MAX_GREENHOUSES
      ) {
        return false;
      }
      commit({
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [plotId]: { cells: {}, lastWateredAt: null },
        },
      });
      return true;
    },
    unmarkGreenhouse(plotId) {
      if (!(plotId in data.greenhouses)) return;
      const greenhouses = { ...data.greenhouses };
      delete greenhouses[plotId];
      commit({ ...data, greenhouses });
    },
    setGreenhouseCell(plotId, cellKey, contentId) {
      const save = data.greenhouses[plotId];
      if (save === undefined || !CELL_KEY_RE.test(cellKey)) return;
      if (contentId !== null && !isPlaceableId(contentId)) return;
      const cells = { ...save.cells };
      if (contentId === null) delete cells[cellKey];
      else cells[cellKey] = contentId;
      commit({
        ...data,
        greenhouses: { ...data.greenhouses, [plotId]: { ...save, cells } },
      });
    },
    markGreenhouseWatered(plotId, at) {
      const save = data.greenhouses[plotId];
      if (save === undefined) return;
      commit({
        ...data,
        greenhouses: {
          ...data.greenhouses,
          [plotId]: { ...save, lastWateredAt: at },
        },
      });
    },
    setTimeZone: (timeZone) => commit({ ...data, timeZone }),
    clearAll: () => commit({ ...EMPTY }),
  };
}

export function browserBacking(): Backing | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
