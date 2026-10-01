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

  it("treats an election payload with no mayor as upstream_down", async () => {
    const { get } = harness(
      happyRoutes({ [ELECTION_ROUTE]: () => json({ success: true }) }),
    );

    const res = await get("/api/mayor");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        code: "upstream_down",
        message: "Election data is unavailable",
      },
    });
  });

  it("treats success:false as upstream_down", async () => {
    const { get } = harness(
      happyRoutes({ [ELECTION_ROUTE]: () => json({ success: false }) }),
    );

    expect((await get("/api/mayor")).status).toBe(502);
  });

  it("returns 502 upstream_down when the election endpoint answers 404", async () => {
    const { get } = harness(
      happyRoutes({
        [ELECTION_ROUTE]: () => new Response("nope", { status: 404 }),
      }),
    );

    const res = await get("/api/mayor");

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "upstream_down",
    );
  });

  it("does not cache a failure: the next call refetches and succeeds", async () => {
    let n = 0;
    const ok = happyRoutes()[ELECTION_ROUTE];
    const { get, net } = harness(
      happyRoutes({
        [ELECTION_ROUTE]: (req) =>
          n++ === 0
            ? json({ success: true })
            : (ok as (r: typeof req) => Response)(req),
      }),
    );

    expect((await get("/api/mayor")).status).toBe(502);
    const res = await get("/api/mayor");

    expect(res.status).toBe(200);
    expect(((await res.json()) as { mayor: { name: string } }).mayor.name).toBe(
      "Finnegan",
    );
    expect(net.calls.filter((c) => c === ELECTION_ROUTE)).toHaveLength(2);
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
