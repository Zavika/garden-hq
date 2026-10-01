import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELECTION_ROUTE,
  START_ISO,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

function harness(routes = happyRoutes(), env = {}) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes, env);
}

describe("GET /api/mayor", () => {
  it("returns the current mayor and perks", async () => {
    const { get } = harness();

    const res = await get("/api/mayor");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mayor: { name: string; perks: unknown[]; minister: { name: string } };
      fetchedAt: string;
    };
    expect(body.mayor.name).toBe("Finnegan");
    expect(body.mayor.perks).toHaveLength(2);
    expect(body.mayor.minister.name).toBe("Jerry");
    expect(body.fetchedAt).toBe(START_ISO);
  });

  it("works without a Hypixel key (election is public)", async () => {
    const { get } = harness(happyRoutes(), { HYPIXEL_API_KEY: undefined });
    expect((await get("/api/mayor")).status).toBe(200);
  });

  it("returns mayor:null when the election payload has no mayor", async () => {
    const { get } = harness(
      happyRoutes({ [ELECTION_ROUTE]: () => json({ success: true }) }),
    );

    expect(await (await get("/api/mayor")).json()).toEqual({
      mayor: null,
      fetchedAt: START_ISO,
    });
  });

  it("returns 502 upstream_down when Hypixel fails", async () => {
    const { get } = harness(
      happyRoutes({
        [ELECTION_ROUTE]: () => new Response("", { status: 500 }),
      }),
    );

    expect((await get("/api/mayor")).status).toBe(502);
  });

  it("caches for 1 hour", async () => {
    const { get, net, clock } = harness();

    await get("/api/mayor");
    clock.advance(59 * 60_000);
    await get("/api/mayor");
    expect(net.calls.filter((c) => c === ELECTION_ROUTE)).toHaveLength(1);

    clock.advance(2 * 60_000);
    await get("/api/mayor");
    expect(net.calls.filter((c) => c === ELECTION_ROUTE)).toHaveLength(2);
  });
});
