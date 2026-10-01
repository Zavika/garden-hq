import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELITEBOT_ROUTE,
  START_ISO,
  STRASSBURGER_ROUTE,
  fixtures,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

function harness(routes = happyRoutes()) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes);
}

const down = () => new Response("", { status: 500 });

describe("GET /api/contests", () => {
  it("returns normalized contests, the credited source and fetchedAt", async () => {
    const { get } = harness();

    const res = await get("/api/contests");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      contests: [
        { startsAt: 1790812800000, crops: ["wheat", "cactus", "pumpkin"] },
        {
          startsAt: 1790819300000,
          crops: ["cocoa_beans", "sugar_cane", "nether_wart"],
        },
      ],
      source: { name: "EliteBot", url: "https://elitebot.dev" },
      fetchedAt: START_ISO,
    });
  });

  it("is public: works without a Hypixel key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { app, env } = makeHarness(happyRoutes(), {
      HYPIXEL_API_KEY: undefined,
    });
    expect((await app.request("/api/contests", {}, env)).status).toBe(200);
  });

  it("falls back to Strassburger and exposes it as the source", async () => {
    const { get } = harness(
      happyRoutes({
        [ELITEBOT_ROUTE]: down,
        [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
      }),
    );

    const body = (await (await get("/api/contests")).json()) as {
      source: { url: string };
    };

    expect(body.source.url).toBe("https://jacobs.strassburger.dev");
  });

  it("returns 502 upstream_down when every source fails", async () => {
    const { get } = harness(
      happyRoutes({ [ELITEBOT_ROUTE]: down, [STRASSBURGER_ROUTE]: down }),
    );

    const res = await get("/api/contests");

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "upstream_down",
    );
  });

  it("caches for 15 minutes", async () => {
    const { get, net, clock } = harness();

    await get("/api/contests");
    clock.advance(14 * 60_000);
    await get("/api/contests");
    expect(net.calls.filter((c) => c === ELITEBOT_ROUTE)).toHaveLength(1);

    clock.advance(2 * 60_000);
    await get("/api/contests");
    expect(net.calls.filter((c) => c === ELITEBOT_ROUTE)).toHaveLength(2);
  });
});
