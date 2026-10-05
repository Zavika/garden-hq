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
