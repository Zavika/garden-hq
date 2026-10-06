import { describe, expect, it, vi } from "vitest";
import {
  createGardenStorage,
  DEFAULT_TIME_ZONE,
  type Backing,
  type StoredLink,
} from "./storage";

function fakeBacking(initial: Record<string, string> = {}): Backing & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const LINK: StoredLink = {
  name: "Steve",
  uuid: "u1",
  profileId: "p1",
  profiles: [{ profileId: "p1", name: "Apple", selected: true }],
};

const throwing: Backing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("createGardenStorage", () => {
  it("starts empty with the default time zone", () => {
    const s = createGardenStorage(fakeBacking());
    expect(s.getSnapshot()).toEqual({
      link: null,
      assignments: {},
      greenhouses: {},
      timeZone: DEFAULT_TIME_ZONE,
    });
  });

  it("persists under the versioned key and reloads", () => {
    const backing = fakeBacking();
    const s = createGardenStorage(backing);
    s.setLink(LINK);
    s.setAssignment("beginner_1", "wheat");
    s.setTimeZone("America/New_York");
    expect(Object.keys(backing.data)).toEqual(["garden-hq:v1"]);

    const reloaded = createGardenStorage(backing).getSnapshot();
    expect(reloaded.link).toEqual(LINK);
    expect(reloaded.assignments).toEqual({ beginner_1: "wheat" });
    expect(reloaded.timeZone).toBe("America/New_York");
  });

  it("removes an assignment when cropId is null", () => {
    const s = createGardenStorage(null);
    s.setAssignment("beginner_1", "wheat");
    s.setAssignment("beginner_1", null);
    expect(s.getSnapshot().assignments).toEqual({});
  });

  it("clearLink keeps assignments; clearAll wipes everything", () => {
    const s = createGardenStorage(null);
    s.setLink(LINK);
    s.setAssignment("beginner_1", "wheat");
    s.clearLink();
    expect(s.getSnapshot().link).toBeNull();
    expect(s.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
    s.clearAll();
    expect(s.getSnapshot().assignments).toEqual({});
    expect(s.getSnapshot().timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it("returns a stable snapshot until something changes, and notifies", () => {
    const s = createGardenStorage(null);
    const first = s.getSnapshot();
    expect(s.getSnapshot()).toBe(first);
    const listener = vi.fn();
    const off = s.subscribe(listener);
    s.setTimeZone("UTC");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot()).not.toBe(first);
    off();
    s.setTimeZone("Europe/Warsaw");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores corrupt or wrongly-shaped stored JSON", () => {
    for (const raw of [
      "{not json",
      "42",
      '{"link":5,"assignments":[],"timeZone":9}',
    ]) {
      const s = createGardenStorage(fakeBacking({ "garden-hq:v1": raw }));
      expect(s.getSnapshot()).toEqual({
        link: null,
        assignments: {},
        greenhouses: {},
        timeZone: DEFAULT_TIME_ZONE,
      });
    }
  });

  it("falls back to in-memory when storage throws", () => {
    const s = createGardenStorage(throwing);
    expect(() => s.setLink(LINK)).not.toThrow();
    expect(s.getSnapshot().link).toEqual(LINK);
    expect(() => s.setAssignment("beginner_1", "wheat")).not.toThrow();
    expect(() => s.clearAll()).not.toThrow();
  });

  it("works with no backing at all", () => {
    const s = createGardenStorage(null);
    s.setLink(LINK);
    expect(s.getSnapshot().link).toEqual(LINK);
  });
});

describe("greenhouse storage", () => {
  it("marks a plot, defaulting to an empty unwatered grid, and is idempotent", () => {
    const s = createGardenStorage(null);
    expect(s.getSnapshot().greenhouses).toEqual({});
    expect(s.markGreenhouse("beginner_3")).toBe(true);
    expect(s.getSnapshot().greenhouses).toEqual({
      beginner_3: { cells: {}, lastWateredAt: null },
    });
    s.setGreenhouseCell("beginner_3", "4,4", "wheat");
    expect(s.markGreenhouse("beginner_3")).toBe(true);
    expect(s.getSnapshot().greenhouses.beginner_3?.cells).toEqual({
      "4,4": "wheat",
    });
  });

  it("allows at most 3 Greenhouses and rejects unknown plots", () => {
    const s = createGardenStorage(null);
    expect(s.markGreenhouse("beginner_1")).toBe(true);
    expect(s.markGreenhouse("beginner_2")).toBe(true);
    expect(s.markGreenhouse("beginner_3")).toBe(true);
    expect(s.markGreenhouse("beginner_4")).toBe(false);
    expect(s.markGreenhouse("not_a_plot")).toBe(false);
    expect(Object.keys(s.getSnapshot().greenhouses)).toHaveLength(3);
  });

  it("sets and clears cells, ignoring unmarked plots, bad keys and unknown ids", () => {
    const s = createGardenStorage(null);
    s.setGreenhouseCell("beginner_3", "4,4", "wheat"); // not marked
    expect(s.getSnapshot().greenhouses).toEqual({});
    s.markGreenhouse("beginner_3");
    s.setGreenhouseCell("beginner_3", "4,4", "wheat");
    s.setGreenhouseCell("beginner_3", "bad", "wheat");
    s.setGreenhouseCell("beginner_3", "4,5", "not_a_crop");
    expect(s.getSnapshot().greenhouses.beginner_3?.cells).toEqual({
      "4,4": "wheat",
    });
    s.setGreenhouseCell("beginner_3", "4,4", null);
    expect(s.getSnapshot().greenhouses.beginner_3?.cells).toEqual({});
  });

  it("records the watered time and unmarking removes the Greenhouse", () => {
    const s = createGardenStorage(null);
    s.markGreenhouse("beginner_3");
    s.markGreenhouseWatered("beginner_3", 1_000);
    expect(s.getSnapshot().greenhouses.beginner_3?.lastWateredAt).toBe(1_000);
    s.unmarkGreenhouse("beginner_3");
    expect(s.getSnapshot().greenhouses).toEqual({});
  });

  it("persists, reloads and sanitises stored greenhouses; clearAll wipes them", () => {
    const backing = fakeBacking();
    const s = createGardenStorage(backing);
    s.markGreenhouse("beginner_3");
    s.setGreenhouseCell("beginner_3", "4,4", "wheat");
    s.markGreenhouseWatered("beginner_3", 5);
    expect(createGardenStorage(backing).getSnapshot().greenhouses).toEqual({
      beginner_3: { cells: { "4,4": "wheat" }, lastWateredAt: 5 },
    });

    const corrupt = createGardenStorage(
      fakeBacking({
        "garden-hq:v1": JSON.stringify({
          greenhouses: {
            beginner_3: {
              cells: { "4,4": "wheat", x: "wheat", "4,5": 7 },
              lastWateredAt: "soon",
            },
            not_a_plot: { cells: {}, lastWateredAt: null },
            beginner_1: 5,
          },
        }),
      }),
    );
    expect(corrupt.getSnapshot().greenhouses).toEqual({
      beginner_3: { cells: { "4,4": "wheat" }, lastWateredAt: null },
    });

    s.clearAll();
    expect(s.getSnapshot().greenhouses).toEqual({});
  });

  it("loads old saves without a greenhouses field", () => {
    const s = createGardenStorage(
      fakeBacking({
        "garden-hq:v1": JSON.stringify({
          assignments: { beginner_1: "wheat" },
        }),
      }),
    );
    expect(s.getSnapshot().greenhouses).toEqual({});
    expect(s.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
  });
});
