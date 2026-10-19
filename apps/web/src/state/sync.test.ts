import {
  applyOps,
  EMPTY_STORED_DATA,
  MAX_OPS_PER_REQUEST,
  seedOps,
  type StoredData,
  type SyncOp,
  type SyncStateResponse,
} from "@garden-hq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type SyncApi } from "../api/client";
import {
  createGardenStorage,
  type Backing,
  type GardenStorage,
  type StoredLink,
} from "./storage";
import { createSyncEngine } from "./sync";

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const GROUPED = "abcd-efgh-ijkl-mnop-qrst-uvwx-yz23-4567";
const KEY = "garden-hq:sync:v1";

const LINK: StoredLink = {
  name: "Steve",
  uuid: "11111111-1111-1111-1111-111111111111",
  profileId: "22222222-2222-2222-2222-222222222222",
  profiles: [],
};

function fakeBacking(): Backing & { data: Record<string, string> } {
  const data: Record<string, string> = {};
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

type FakeApi = {
  [K in keyof SyncApi]: ReturnType<typeof vi.fn<SyncApi[K]>>;
};

/** Fake server: applies posted ops to its own state, like the real Worker. */
function makeApi(initial: StoredData = EMPTY_STORED_DATA) {
  let server = initial;
  let revision = 1;
  const state = (): SyncStateResponse => ({ ...server, revision });
  const api: FakeApi = {
    createAccount: vi.fn<SyncApi["createAccount"]>(async () => ({
      syncCode: CODE,
    })),
    getSync: vi.fn<SyncApi["getSync"]>(async () => ({
      state: state(),
      etag: `"r${revision}"`,
    })),
    postSync: vi.fn<SyncApi["postSync"]>(async (_code, ops) => {
      server = applyOps(server, ops);
      revision++;
      return { state: state(), etag: `"r${revision}"` };
    }),
    deleteAccount: vi.fn<SyncApi["deleteAccount"]>(async () => undefined),
  };
  return {
    api,
    setServer(next: StoredData) {
      server = next;
      revision++;
    },
    server: () => server,
  };
}

function setup(
  opts: {
    backing?: (Backing & { data: Record<string, string> }) | null;
    server?: StoredData;
    local?: Partial<StoredData>;
  } = {},
) {
  const backing = opts.backing === undefined ? fakeBacking() : opts.backing;
  const fake = makeApi(opts.server);
  const base = createGardenStorage(null);
  if (opts.local) base.replaceAll({ ...EMPTY_STORED_DATA, ...opts.local });
  const engine = createSyncEngine({
    base,
    api: fake.api,
    backing,
    now: () => 1_000,
    debounceMs: 2000,
  });
  return { engine, base, fake, backing, api: fake.api };
}

async function signedInEngine(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup({ ...opts, local: { link: LINK, ...opts.local } });
  await s.engine.enableWithNewAccount();
  s.api.postSync.mockClear();
  s.api.getSync.mockClear();
  return s;
}

function storedPending(
  backing: (Backing & { data: Record<string, string> }) | null,
): SyncOp[] {
  const raw = backing?.getItem(KEY) ?? "{}";
  return (JSON.parse(raw) as { pending?: SyncOp[] }).pending ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("SyncEngine", () => {
  it("1. signed out: mutations change data but queue nothing and call no API", async () => {
    const { engine, api } = setup();
    engine.storage.setAssignment("beginner_1", "wheat");
    expect(engine.storage.getSnapshot().assignments).toEqual({
      beginner_1: "wheat",
    });
    expect(engine.getSnapshot()).toMatchObject({
      status: "signed_out",
      pending: 0,
      code: null,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await engine.flush();
    expect(api.postSync).not.toHaveBeenCalled();
    expect(api.getSync).not.toHaveBeenCalled();
  });

  it("2. enableWithNewAccount creates the account, stores the code and seeds", async () => {
    const { engine, api } = setup({
      local: { link: LINK, assignments: { beginner_1: "wheat" } },
    });
    await engine.enableWithNewAccount();
    expect(api.createAccount).toHaveBeenCalledWith(LINK);
    expect(api.postSync).toHaveBeenCalledTimes(1);
    const [code, ops] = api.postSync.mock.calls[0] as [string, SyncOp[]];
    expect(code).toBe(CODE);
    expect(ops).toEqual(seedOps(engine.storage.getSnapshot()));
    expect(engine.getSnapshot()).toMatchObject({
      code: CODE,
      status: "idle",
      pending: 0,
      syncedAt: 1_000,
    });
  });

  it("2b. enableWithNewAccount without a link throws and calls no API", async () => {
    const { engine, api } = setup();
    await expect(engine.enableWithNewAccount()).rejects.toThrow(/link/i);
    expect(api.createAccount).not.toHaveBeenCalled();
    expect(engine.getSnapshot().status).toBe("signed_out");
  });

  it("2c. a seed larger than the request cap is sent in sequential chunks", async () => {
    const assignments: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) assignments[`beginner_${i}`] = "wheat";
    const cells: Record<string, string> = {};
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) cells[`${x},${z}`] = "wheat";
    }
    const { engine, api } = setup({
      local: {
        link: LINK,
        assignments,
        greenhouses: {
          beginner_1: {
            cells,
            lastWateredAt: null,
            wateringIntervalHours: null,
          },
        },
      },
    });
    await engine.enableWithNewAccount();
    const sizes = api.postSync.mock.calls.map((c) => c[1].length);
    expect(sizes.length).toBeGreaterThan(1);
    for (const n of sizes) expect(n).toBeLessThanOrEqual(MAX_OPS_PER_REQUEST);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(
      seedOps(engine.storage.getSnapshot()).length,
    );
    expect(engine.getSnapshot().pending).toBe(0);
  });

  it("2d. stale local ids are dropped from the seed, valid ones still sent", async () => {
    const { engine, api } = setup({
      local: {
        link: LINK,
        assignments: {
          beginner_1: "wheat",
          ghost_plot: "wheat",
          beginner_2: "nope",
        },
      },
    });
    await engine.enableWithNewAccount();
    const sent = api.postSync.mock.calls.flatMap((c) => c[1]);
    expect(sent).toContainEqual({
      t: "setAssignment",
      plotId: "beginner_1",
      cropId: "wheat",
    });
    expect(
      sent.some(
        (o) =>
          o.t === "setAssignment" &&
          (o.plotId === "ghost_plot" || o.cropId === "nope"),
      ),
    ).toBe(false);
    expect(engine.getSnapshot().status).toBe("idle");
  });

  it("2e. a postSync failure after account creation keeps the code and the seed queued", async () => {
    const { engine, api } = setup({
      local: { link: LINK, assignments: { beginner_1: "wheat" } },
    });
    api.postSync.mockRejectedValueOnce(new ApiError("network", 0, "x"));
    await engine.enableWithNewAccount();
    expect(engine.getSnapshot()).toMatchObject({
      code: CODE,
      status: "offline",
    });
    expect(engine.getSnapshot().pending).toBeGreaterThan(0);
    await engine.flush();
    expect(engine.getSnapshot()).toMatchObject({ status: "idle", pending: 0 });
  });

  it("3. a mutation enqueues one op and flushes only after the debounce", async () => {
    const { engine, api } = await signedInEngine();
    engine.storage.setAssignment("beginner_1", "wheat");
    expect(engine.getSnapshot().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(api.postSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.postSync).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().pending).toBe(0);
  });

  it("3b. three quick mutations to one plot send a single setAssignment", async () => {
    const { engine, api } = await signedInEngine();
    engine.storage.setAssignment("beginner_1", "wheat");
    engine.storage.setAssignment("beginner_1", "carrot");
    engine.storage.setAssignment("beginner_1", "potato");
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.postSync).toHaveBeenCalledTimes(1);
    expect(api.postSync.mock.calls[0]?.[1]).toEqual([
      { t: "setAssignment", plotId: "beginner_1", cropId: "potato" },
    ]);
  });

  it("4. offline keeps ops queued and persisted; an online event sends them", async () => {
    const { engine, api, backing } = await signedInEngine();
    const stop = engine.start();
    await vi.advanceTimersByTimeAsync(0);
    api.postSync.mockRejectedValueOnce(new ApiError("network", 0, "x"));
    engine.storage.setAssignment("beginner_1", "wheat");
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.getSnapshot()).toMatchObject({
      status: "offline",
      pending: 1,
    });
    expect(storedPending(backing)).toHaveLength(1);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getSnapshot()).toMatchObject({ status: "idle", pending: 0 });
    expect(api.postSync).toHaveBeenLastCalledWith(CODE, [
      { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
    ]);
    expect(storedPending(backing)).toHaveLength(0);
    stop();
  });

  it("5. a second engine on the same backing sees the code and pending ops", async () => {
    const backing = fakeBacking();
    const first = await signedInEngine({ backing });
    first.api.postSync.mockRejectedValue(new ApiError("network", 0, "x"));
    first.engine.storage.setAssignment("beginner_1", "wheat");
    await vi.advanceTimersByTimeAsync(2000);

    const second = createSyncEngine({
      base: createGardenStorage(null),
      api: makeApi().api,
      backing,
    });
    expect(second.getSnapshot()).toMatchObject({
      code: CODE,
      status: "idle",
      pending: 1,
    });
  });

  it("6. a pull replaces keys without pending ops; a pending key keeps the local value", async () => {
    const { engine, api, base } = await signedInEngine();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // First push is held open; the server answers with other-device state.
    api.postSync.mockImplementationOnce(async () => {
      await gate;
      return {
        state: {
          ...EMPTY_STORED_DATA,
          link: LINK,
          assignments: {
            beginner_1: "wheat",
            beginner_2: "carrot",
            beginner_3: "potato",
          },
          revision: 7,
        },
        etag: '"r7"',
      };
    });
    // The follow-up push (for the op queued during flight) is held forever.
    api.postSync.mockImplementationOnce(() => new Promise(() => undefined));

    engine.storage.setAssignment("beginner_1", "wheat");
    await vi.advanceTimersByTimeAsync(2000);
    engine.storage.setAssignment("beginner_2", "cactus"); // pending locally
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(base.getSnapshot().assignments).toEqual({
      beginner_1: "wheat",
      beginner_2: "cactus", // local pending value wins
      beginner_3: "potato", // adopted from the server
    });
  });

  it("6b. a plain pull without pending ops adopts the server state", async () => {
    const { engine, fake, base } = await signedInEngine();
    fake.setServer({
      ...EMPTY_STORED_DATA,
      link: LINK,
      assignments: { beginner_2: "potato" },
    });
    await engine.flush();
    expect(base.getSnapshot().assignments).toEqual({ beginner_2: "potato" });
  });

  it("7. a 304 changes nothing and still updates syncedAt", async () => {
    let t = 1_000;
    const fake = makeApi();
    const base = createGardenStorage(null);
    base.setLink(LINK);
    const engine = createSyncEngine({
      base,
      api: fake.api,
      backing: null,
      now: () => t,
    });
    await engine.enableWithNewAccount();
    const before = base.getSnapshot();
    t = 5_000;
    fake.api.getSync.mockResolvedValueOnce(null);
    await engine.flush();
    expect(base.getSnapshot()).toBe(before);
    expect(engine.getSnapshot().syncedAt).toBe(5_000);
  });

  describe("joinWithCode", () => {
    const cloud: StoredData = {
      ...EMPTY_STORED_DATA,
      link: LINK,
      assignments: { beginner_1: "carrot" },
    };

    it("8a. an invalid format throws before any API call", async () => {
      const { engine, api } = setup();
      await expect(engine.joinWithCode("not a code")).rejects.toThrow();
      expect(api.getSync).not.toHaveBeenCalled();
    });

    it("8b. a 401 leaves local data untouched and stores no code", async () => {
      const { engine, api, base } = setup({
        local: { assignments: { beginner_3: "wheat" } },
      });
      const before = base.getSnapshot();
      api.getSync.mockRejectedValueOnce(
        new ApiError("unauthorized", 401, "nope"),
      );
      await expect(engine.joinWithCode(GROUPED)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(base.getSnapshot()).toBe(before);
      expect(engine.getSnapshot().code).toBeNull();
    });

    it("8c. success posts only missing ops, merges, sets the summary and stores the code", async () => {
      const { engine, api, base, fake } = setup({
        server: cloud,
        local: {
          assignments: { beginner_1: "wheat", beginner_2: "potato" },
        },
      });
      await engine.joinWithCode(GROUPED);
      expect(api.getSync).toHaveBeenCalledWith(CODE, null);
      expect(api.postSync).toHaveBeenCalledTimes(1);
      expect(api.postSync.mock.calls[0]).toEqual([
        CODE,
        [{ t: "setAssignment", plotId: "beginner_2", cropId: "potato" }],
      ]);
      expect(base.getSnapshot().assignments).toEqual({
        beginner_1: "carrot",
        beginner_2: "potato",
      });
      expect(base.getSnapshot().assignments).toEqual(fake.server().assignments);
      expect(engine.getSnapshot()).toMatchObject({
        code: CODE,
        status: "idle",
        pending: 0,
        summary: { added: 1, kept: 1 },
      });
    });

    it("8d. local data is unchanged and no code stored if the POST fails", async () => {
      const { engine, api, base } = setup({
        server: cloud,
        local: { assignments: { beginner_2: "potato" } },
      });
      const before = base.getSnapshot();
      api.postSync.mockRejectedValueOnce(new ApiError("network", 0, "x"));
      await expect(engine.joinWithCode(GROUPED)).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(base.getSnapshot()).toBe(before);
      expect(engine.getSnapshot().code).toBeNull();
      expect(engine.getSnapshot().status).toBe("signed_out");
    });

    it("8e. stale local ids are dropped from the join ops, valid ones still sent", async () => {
      const { engine, api } = setup({
        server: cloud,
        local: {
          assignments: {
            beginner_2: "potato",
            ghost_plot: "wheat",
            beginner_3: "nope",
          },
        },
      });
      await engine.joinWithCode(GROUPED);
      expect(api.postSync.mock.calls[0]?.[1]).toEqual([
        { t: "setAssignment", plotId: "beginner_2", cropId: "potato" },
      ]);
      expect(engine.getSnapshot().summary).toEqual({ added: 1, kept: 0 });
    });
  });

  it("9. unauthorized keeps the queue and stops automatic retries until signOut/join", async () => {
    const { engine, api } = await signedInEngine();
    api.postSync.mockRejectedValueOnce(
      new ApiError("unauthorized", 401, "revoked"),
    );
    engine.storage.setAssignment("beginner_1", "wheat");
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.getSnapshot()).toMatchObject({
      status: "unauthorized",
      pending: 1,
    });
    api.postSync.mockClear();
    engine.storage.setAssignment("beginner_2", "wheat");
    await vi.advanceTimersByTimeAsync(10_000);
    await engine.flush();
    expect(api.postSync).not.toHaveBeenCalled();
    expect(api.getSync).not.toHaveBeenCalled();
    expect(engine.getSnapshot().status).toBe("unauthorized");
    engine.signOut();
    expect(engine.getSnapshot().status).toBe("signed_out");
  });

  it("10. rate_limited becomes an error that mentions the wait", async () => {
    const { engine, api } = await signedInEngine();
    api.postSync.mockRejectedValueOnce(
      new ApiError("rate_limited", 429, "slow", 42),
    );
    engine.storage.setAssignment("beginner_1", "wheat");
    await vi.advanceTimersByTimeAsync(2000);
    expect(engine.getSnapshot().status).toBe("error");
    expect(engine.getSnapshot().error).toContain("42");
    expect(engine.getSnapshot().pending).toBe(1);
  });

  it("11. signOut clears the code and queue but keeps data", async () => {
    const { engine, base, backing } = await signedInEngine();
    engine.storage.setAssignment("beginner_1", "wheat");
    engine.signOut();
    expect(engine.getSnapshot()).toMatchObject({
      code: null,
      status: "signed_out",
      pending: 0,
    });
    expect(base.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
    expect(storedPending(backing)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
  });

  it("11b. deleteCloud calls deleteAccount then signs out", async () => {
    const { engine, api } = await signedInEngine();
    await engine.deleteCloud();
    expect(api.deleteAccount).toHaveBeenCalledWith(CODE);
    expect(engine.getSnapshot()).toMatchObject({
      code: null,
      status: "signed_out",
    });
  });

  it("11c. a failed deleteCloud keeps the code and sets an error", async () => {
    const { engine, api } = await signedInEngine();
    api.deleteAccount.mockRejectedValueOnce(
      new ApiError("internal", 500, "boom"),
    );
    await engine.deleteCloud();
    expect(engine.getSnapshot().code).toBe(CODE);
    expect(engine.getSnapshot().error).toBeTruthy();
  });

  it("12. an op enqueued during an in-flight flush is neither lost nor sent twice", async () => {
    const { engine, api, fake } = await signedInEngine();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    api.postSync.mockImplementationOnce(async (_c, ops) => {
      await gate;
      const next = applyOps(fake.server(), ops);
      fake.setServer(next);
      return { state: { ...next, revision: 50 }, etag: '"r50"' };
    });
    engine.storage.setAssignment("beginner_1", "wheat");
    await vi.advanceTimersByTimeAsync(2000); // flush starts, blocked
    engine.storage.setAssignment("beginner_2", "carrot"); // during flight
    release();
    await vi.advanceTimersByTimeAsync(5000);

    const sent = api.postSync.mock.calls.flatMap((c) => c[1]);
    expect(
      sent.filter((o) => o.t === "setAssignment" && o.plotId === "beginner_1"),
    ).toHaveLength(1);
    expect(
      sent.filter((o) => o.t === "setAssignment" && o.plotId === "beginner_2"),
    ).toHaveLength(1);
    expect(engine.getSnapshot().pending).toBe(0);
    expect(engine.storage.getSnapshot().assignments).toEqual({
      beginner_1: "wheat",
      beginner_2: "carrot",
    });
  });

  it("12b. concurrent triggers are coalesced into one request", async () => {
    const { engine, api } = await signedInEngine();
    await Promise.all([engine.flush(), engine.flush(), engine.flush()]);
    expect(api.getSync).toHaveBeenCalledTimes(1);
  });

  it("13. clearAll keeps the code and enqueues nothing", async () => {
    const { engine } = await signedInEngine();
    engine.storage.clearAll();
    expect(engine.getSnapshot()).toMatchObject({
      code: CODE,
      pending: 0,
      status: "idle",
    });
  });

  it("returns a stable snapshot between changes and notifies subscribers", async () => {
    const { engine } = setup();
    const listener = vi.fn();
    const off = engine.subscribe(listener);
    const a = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(a);
    engine.storage.setLink(LINK);
    off();
    await engine.enableWithNewAccount();
    expect(listener).not.toHaveBeenCalled();
  });

  describe("fix round 1", () => {
    const cloud: StoredData = {
      ...EMPTY_STORED_DATA,
      link: LINK,
      assignments: { beginner_2: "carrot" },
    };

    function gated(): { promise: Promise<void>; release: () => void } {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = () => resolve();
      });
      return { promise, release };
    }

    it("join (a): an edit made while signed out during the join is kept and sent to the new account", async () => {
      const { engine, api, base, fake } = setup({
        server: cloud,
        local: { assignments: { beginner_1: "wheat" } },
      });
      const held = gated();
      const real = api.postSync.getMockImplementation();
      api.postSync.mockImplementationOnce(async (c, ops) => {
        await held.promise;
        return real!(c, ops);
      });
      const joined = engine.joinWithCode(GROUPED);
      await vi.advanceTimersByTimeAsync(0); // join is now waiting on its POST
      engine.storage.setAssignment("beginner_3", "wheat");
      held.release();
      await joined;
      expect(base.getSnapshot().assignments).toEqual({
        beginner_1: "wheat",
        beginner_2: "carrot",
        beginner_3: "wheat",
      });
      expect(engine.getSnapshot()).toMatchObject({ code: CODE, pending: 1 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.postSync).toHaveBeenLastCalledWith(CODE, [
        { t: "setAssignment", plotId: "beginner_3", cropId: "wheat" },
      ]);
      expect(fake.server().assignments.beginner_3).toBe("wheat");
      expect(engine.getSnapshot().pending).toBe(0);
    });

    it("join (b): an old-code flush response arriving mid-join is dropped and never reaches the new account", async () => {
      const { engine, api, base, fake } = await signedInEngine({
        local: { assignments: { beginner_1: "wheat" } },
      });
      const real = api.postSync.getMockImplementation();
      const oldHeld = gated();
      api.postSync.mockImplementationOnce(async () => {
        await oldHeld.promise;
        return {
          state: {
            ...EMPTY_STORED_DATA,
            link: LINK,
            assignments: { intermediate_1: "potato", beginner_1: "wheat" },
            revision: 40,
          },
          etag: '"r40"',
        };
      });
      const joinHeld = gated();
      engine.storage.setAssignment("beginner_3", "wheat");
      await vi.advanceTimersByTimeAsync(2000); // old-code flush in flight
      expect(engine.getSnapshot().status).toBe("syncing");
      fake.setServer(cloud);
      // The join's own POST (the second call from here) is held as well.
      api.postSync.mockImplementationOnce(async (c, ops) => {
        await joinHeld.promise;
        return real!(c, ops);
      });
      const joined = engine.joinWithCode(GROUPED);
      await vi.advanceTimersByTimeAsync(0); // join GET done, join POST held
      oldHeld.release(); // old response lands between the join GET and POST
      await vi.advanceTimersByTimeAsync(0);
      // Mid-join: the old account's data must not have been written locally.
      expect(base.getSnapshot().assignments).not.toHaveProperty(
        "intermediate_1",
      );
      joinHeld.release();
      await joined;
      await vi.advanceTimersByTimeAsync(2000);

      const sent = api.postSync.mock.calls.flatMap((c) => c[1]);
      expect(JSON.stringify(sent)).not.toContain("intermediate_1");
      expect(base.getSnapshot().assignments).not.toHaveProperty(
        "intermediate_1",
      );
      expect(fake.server().assignments).not.toHaveProperty("intermediate_1");
      expect(engine.getSnapshot()).toMatchObject({
        status: "idle",
        pending: 0,
      });
    });

    describe.each([
      [
        "a changed key",
        (s: GardenStorage) => s.setAssignment("beginner_1", "potato"),
        (d: StoredData) => d.assignments.beginner_1 === "potato",
      ],
      [
        "a removed key",
        (s: GardenStorage) => s.setAssignment("beginner_1", null),
        (d: StoredData) => !("beginner_1" in d.assignments),
      ],
      [
        "a time zone change",
        (s: GardenStorage) => s.setTimeZone("UTC"),
        (d: StoredData) => d.timeZone === "UTC",
      ],
    ])("mid-join edit: %s", (_name, edit, holds) => {
      it("is preserved on screen and queued for the new account", async () => {
        const { engine, api, base, fake } = setup({
          server: cloud,
          local: { assignments: { beginner_1: "wheat" } },
        });
        const held = gated();
        const real = api.postSync.getMockImplementation();
        api.postSync.mockImplementationOnce(async (c, ops) => {
          await held.promise;
          return real!(c, ops);
        });
        const joined = engine.joinWithCode(GROUPED);
        await vi.advanceTimersByTimeAsync(0); // join POST held
        edit(engine.storage);
        held.release();
        await joined;
        expect(holds(base.getSnapshot())).toBe(true);
        expect(engine.getSnapshot()).toMatchObject({ code: CODE, pending: 1 });
        await vi.advanceTimersByTimeAsync(2000);
        expect(holds(fake.server())).toBe(true);
        expect(engine.getSnapshot().pending).toBe(0);
      });
    });

    it("a second joinWithCode while one is running is rejected", async () => {
      const { engine, api } = setup({ server: cloud });
      const held = gated();
      const real = api.getSync.getMockImplementation();
      api.getSync.mockImplementationOnce(async (c, e) => {
        await held.promise;
        return real!(c, e);
      });
      const first = engine.joinWithCode(GROUPED);
      await expect(engine.joinWithCode(GROUPED)).rejects.toThrow(/already/i);
      held.release();
      await first;
      expect(engine.getSnapshot().code).toBe(CODE);
    });

    it("keeps the rejected-changes message when a later chunk fails", async () => {
      const backing = fakeBacking();
      const ops: SyncOp[] = [];
      for (let x = 0; x < 9; x++) {
        for (let z = 0; z < 5; z++) {
          ops.push({
            t: "setGreenhouseCell",
            plotId: "beginner_1",
            cellKey: `${x},${z}`,
            contentId: "wheat",
          });
        }
      }
      backing.setItem(KEY, JSON.stringify({ code: CODE, pending: ops }));
      const { api, engine } = (() => {
        const fake = makeApi();
        const e = createSyncEngine({
          base: createGardenStorage(null),
          api: fake.api,
          backing,
          debounceMs: 2000,
        });
        return { api: fake.api, engine: e };
      })();
      api.postSync
        .mockRejectedValueOnce(new ApiError("bad_request", 400, "bad"))
        .mockRejectedValueOnce(new ApiError("internal", 500, "boom"));
      await engine.flush();
      expect(engine.getSnapshot().status).toBe("error");
      expect(engine.getSnapshot().error).toMatch(/rejected/i);
      expect(engine.getSnapshot().error).toMatch(/boom/);
      expect(engine.getSnapshot().pending).toBe(ops.length - 40);
    });

    it("a stale running flush after signOut does not block a fresh run", async () => {
      const { engine, api } = await signedInEngine();
      const held = gated();
      api.postSync.mockImplementationOnce(async () => {
        await held.promise;
        return { state: { ...EMPTY_STORED_DATA, revision: 3 }, etag: '"r3"' };
      });
      engine.storage.setAssignment("beginner_1", "wheat");
      await vi.advanceTimersByTimeAsync(2000); // old run held
      engine.signOut();
      await engine.enableWithNewAccount();
      expect(api.postSync).toHaveBeenCalledTimes(2);
      expect(engine.getSnapshot()).toMatchObject({
        status: "idle",
        pending: 0,
      });
      held.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.getSnapshot()).toMatchObject({
        status: "idle",
        pending: 0,
      });
      // enqueue schedules normally again
      engine.storage.setAssignment("beginner_2", "carrot");
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getSnapshot().pending).toBe(0);
    });

    it("shows the server message for a long (daily) rate limit", async () => {
      const { engine, api } = await signedInEngine();
      api.postSync.mockRejectedValueOnce(
        new ApiError(
          "rate_limited",
          429,
          "Daily cloud save limit reached for this account — try again tomorrow.",
          43_200,
        ),
      );
      engine.storage.setAssignment("beginner_1", "wheat");
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getSnapshot().status).toBe("error");
      expect(engine.getSnapshot().error).toMatch(/try again tomorrow/);
    });

    it("an invalid op is never queued", async () => {
      const { engine } = await signedInEngine();
      engine.storage.setAssignment("ghost_plot", "wheat");
      expect(engine.getSnapshot().pending).toBe(0);
    });

    it("a bad_request chunk is dropped, status is error, and the queue moves on", async () => {
      const { engine, api } = await signedInEngine();
      api.postSync.mockRejectedValueOnce(
        new ApiError("bad_request", 400, "bad op"),
      );
      engine.storage.setAssignment("beginner_1", "wheat");
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getSnapshot()).toMatchObject({
        status: "error",
        pending: 0,
      });
      expect(engine.getSnapshot().error).toMatch(/rejected/i);
      engine.storage.setAssignment("beginner_2", "carrot");
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getSnapshot()).toMatchObject({
        status: "idle",
        pending: 0,
      });
      expect(api.postSync).toHaveBeenLastCalledWith(CODE, [
        { t: "setAssignment", plotId: "beginner_2", cropId: "carrot" },
      ]);
    });

    const LOCAL_DATA: Partial<StoredData> = {
      link: LINK,
      assignments: { beginner_1: "wheat" },
      greenhouses: {
        beginner_2: {
          cells: { "0,0": "wheat" },
          lastWateredAt: null,
          wateringIntervalHours: null,
        },
      },
    };

    it("a bad_request seed chunk never wipes local assignments and Greenhouses", async () => {
      const { engine, base, api } = setup({ local: LOCAL_DATA });
      api.postSync.mockRejectedValueOnce(
        new ApiError("bad_request", 400, "bad"),
      );
      await engine.enableWithNewAccount();
      expect(base.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
      expect(Object.keys(base.getSnapshot().greenhouses)).toEqual([
        "beginner_2",
      ]);
      expect(api.getSync).not.toHaveBeenCalled();
      expect(engine.getSnapshot().status).toBe("error");
      expect(engine.getSnapshot().error).toMatch(/rejected/i);
    });

    it("rejected > 0 keeps local edits, applies the message and still sends the rest", async () => {
      const { engine, base, api } = setup({ local: LOCAL_DATA });
      api.postSync.mockImplementationOnce(async () => ({
        state: { ...EMPTY_STORED_DATA, revision: 2, rejected: 1 },
        etag: '"r2"',
      }));
      await engine.enableWithNewAccount();
      expect(base.getSnapshot().assignments).toEqual({ beginner_1: "wheat" });
      expect(Object.keys(base.getSnapshot().greenhouses)).toEqual([
        "beginner_2",
      ]);
      expect(api.getSync).not.toHaveBeenCalled();
      expect(engine.getSnapshot().status).toBe("error");
      expect(engine.getSnapshot().error).toMatch(/rejected/i);
      expect(engine.getSnapshot().pending).toBe(0);
    });

    it.each([
      ["garbage JSON", "{not json"],
      ["wrong types", JSON.stringify({ code: 5, pending: "x", etag: 3 })],
      ["a bad code", JSON.stringify({ code: "nope", pending: [] })],
      ["null", "null"],
    ])("corrupt persisted state (%s) starts signed out", (_name, raw) => {
      const backing = fakeBacking();
      backing.setItem(KEY, raw);
      const engine = createSyncEngine({
        base: createGardenStorage(null),
        api: makeApi().api,
        backing,
      });
      expect(engine.getSnapshot()).toMatchObject({
        code: null,
        status: "signed_out",
        pending: 0,
      });
    });

    it("junk ops in a valid persisted queue are discarded", () => {
      const backing = fakeBacking();
      backing.setItem(
        KEY,
        JSON.stringify({
          code: CODE,
          pending: [
            1,
            null,
            { t: "nope" },
            { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
          ],
        }),
      );
      const engine = createSyncEngine({
        base: createGardenStorage(null),
        api: makeApi().api,
        backing,
      });
      expect(engine.getSnapshot()).toMatchObject({ code: CODE, pending: 1 });
    });

    it("the persisted queue includes the in-flight chunk while a request is held", async () => {
      const { engine, api, backing } = await signedInEngine();
      const held = gated();
      api.postSync.mockImplementationOnce(async () => {
        await held.promise;
        return { state: { ...EMPTY_STORED_DATA, revision: 9 }, etag: '"r9"' };
      });
      engine.storage.setAssignment("beginner_1", "wheat");
      await vi.advanceTimersByTimeAsync(2000);
      expect(engine.getSnapshot().status).toBe("syncing");
      expect(storedPending(backing)).toEqual([
        { t: "setAssignment", plotId: "beginner_1", cropId: "wheat" },
      ]);
      engine.storage.setAssignment("beginner_2", "carrot");
      expect(storedPending(backing)).toHaveLength(2);
      held.release();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("a visible visibilitychange flushes, but an idle trigger within 5 s is skipped", async () => {
      let t = 1_000;
      const fake = makeApi();
      const base = createGardenStorage(null);
      base.setLink(LINK);
      const engine = createSyncEngine({
        base,
        api: fake.api,
        backing: null,
        now: () => t,
      });
      await engine.enableWithNewAccount();
      const stop = engine.start();
      await vi.advanceTimersByTimeAsync(0);
      fake.api.getSync.mockClear();
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.api.getSync).not.toHaveBeenCalled(); // within 5 s
      t = 10_000;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.api.getSync).toHaveBeenCalledTimes(1);
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.api.getSync).toHaveBeenCalledTimes(1);
      stop();
    });
  });
});
