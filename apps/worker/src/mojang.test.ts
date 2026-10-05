import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeKV,
  MOJANG_LEGACY_ROUTE,
  MOJANG_ROUTE,
  PLAYERDB_ROUTE,
  fixtures,
  json,
  makeClock,
  routedFetch,
  trackedResponse,
  type FakeHandler,
} from "../test/helpers";
import { AppError } from "./errors";
import { lookupUuid } from "./mojang";

afterEach(() => vi.restoreAllMocks());

const UUID = "11111111-1111-1111-1111-111111111111";
const down = () => new Response("", { status: 503 });
const playerdbBody = {
  success: true,
  code: "player.found",
  data: { player: { id: UUID, username: "TestFarmer" } },
};

type Routes = Record<string, FakeHandler>;

async function lookup(routes: Routes) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const net = routedFetch(routes);
  const result = await lookupUuid(net.fetch, "TestFarmer");
  return { result, calls: net.calls };
}

async function code(routes: Routes): Promise<string | undefined> {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const err = await lookupUuid(routedFetch(routes).fetch, "TestFarmer").then(
    () => undefined,
    (e: unknown) => e,
  );
  return err instanceof AppError ? err.code : undefined;
}

describe("lookupUuid", () => {
  it("returns the dashed UUID and canonical name from the primary", async () => {
    const { result, calls } = await lookup({
      [MOJANG_ROUTE]: () => json(fixtures.mojangProfile),
    });

    expect(result).toEqual({ uuid: UUID, name: "TestFarmer" });
    expect(calls).toEqual([MOJANG_ROUTE]);
  });

  it.each([404, 429, 500])(
    "cancels the unread body of a %i",
    async (status) => {
      const tracked = trackedResponse(status);

      await code({
        [MOJANG_ROUTE]: () => tracked.response,
        [MOJANG_LEGACY_ROUTE]: down,
        [PLAYERDB_ROUTE]: down,
      });

      expect(tracked.cancelled()).toBe(true);
    },
  );

  it("maps 404 and 204 to unknown_player without trying fallbacks", async () => {
    for (const status of [404, 204]) {
      const calls: string[] = [];
      const routes: Routes = {
        [MOJANG_ROUTE]: () => new Response(null, { status }),
        [MOJANG_LEGACY_ROUTE]: () => {
          calls.push("legacy");
          return down();
        },
      };
      expect(await code(routes)).toBe("unknown_player");
      expect(calls).toEqual([]);
    }
  });

  it("falls back to api.mojang.com when the primary fails", async () => {
    for (const primary of [
      down,
      () => new Response("", { status: 429 }),
      () => {
        throw new Error("boom");
      },
      () => json({ id: "nope" }),
    ]) {
      const { result, calls } = await lookup({
        [MOJANG_ROUTE]: primary,
        [MOJANG_LEGACY_ROUTE]: () => json(fixtures.mojangProfile),
      });
      expect(result.uuid).toBe(UUID);
      expect(calls).toEqual([MOJANG_ROUTE, MOJANG_LEGACY_ROUTE]);
    }
  });

  it("falls back to playerdb when both Mojang hosts fail", async () => {
    const { result, calls } = await lookup({
      [MOJANG_ROUTE]: down,
      [MOJANG_LEGACY_ROUTE]: down,
      [PLAYERDB_ROUTE]: () => json(playerdbBody),
    });

    expect(result).toEqual({ uuid: UUID, name: "TestFarmer" });
    expect(calls).toEqual([MOJANG_ROUTE, MOJANG_LEGACY_ROUTE, PLAYERDB_ROUTE]);
  });

  it("maps a playerdb 404 to unknown_player", async () => {
    expect(
      await code({
        [MOJANG_ROUTE]: down,
        [MOJANG_LEGACY_ROUTE]: down,
        [PLAYERDB_ROUTE]: () => new Response("", { status: 404 }),
      }),
    ).toBe("unknown_player");
  });

  it("returns upstream_down only when all three fail", async () => {
    expect(
      await code({
        [MOJANG_ROUTE]: down,
        [MOJANG_LEGACY_ROUTE]: () => new Response("", { status: 429 }),
        [PLAYERDB_ROUTE]: () => json({ success: false }),
      }),
    ).toBe("upstream_down");
    // Unrouted hosts reject like a network error.
    expect(await code({})).toBe("upstream_down");
  });

  it("logs each upstream's status code but never the player name", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await lookupUuid(
      routedFetch({
        [MOJANG_ROUTE]: down,
        [MOJANG_LEGACY_ROUTE]: () => json(fixtures.mojangProfile),
      }).fetch,
      "TestFarmer",
    );

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"host":"api.minecraftservices.com"');
    expect(lines[0]).toContain('"status":503');
    expect(lines[1]).toContain('"status":200');
    expect(lines.join("")).not.toContain("TestFarmer");
  });
});

describe("lookupUuid caching", () => {
  function setup(routes: Routes) {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const net = routedFetch(routes);
    const clock = makeClock();
    const kv = new FakeKV();
    const run = (name = "TestFarmer") =>
      lookupUuid(net.fetch, name, {
        kv: kv as unknown as KVNamespace,
        now: clock.now,
      });
    return { net, clock, kv, run };
  }

  it("serves repeats from KV for 24 h (case-insensitive), then refetches", async () => {
    const { net, clock, run } = setup({
      [MOJANG_ROUTE]: () => json(fixtures.mojangProfile),
    });

    await run();
    clock.advance(24 * 60 * 60 * 1000 - 1000);
    expect((await run()).uuid).toBe(UUID);
    expect(net.calls).toHaveLength(1);

    clock.advance(2000);
    await run();
    expect(net.calls).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    const { net, run } = setup({
      [MOJANG_ROUTE]: () => new Response("", { status: 404 }),
    });

    await expect(run()).rejects.toMatchObject({ code: "unknown_player" });
    await expect(run()).rejects.toMatchObject({ code: "unknown_player" });
    expect(net.calls).toHaveLength(2);
  });
});
