import { normalizeGarden } from "@garden-hq/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GARDEN_ROUTE,
  START_ISO,
  fixtures,
  happyRoutes,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

const PROFILE = "33333333-3333-3333-3333-333333333333";

function harness(routes = happyRoutes()) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes);
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("GET /api/garden", () => {
  it("returns the normalized GardenState with fetchedAt", async () => {
    const { get } = harness();

    const res = await get(`/api/garden?profile=${PROFILE}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      garden: normalizeGarden(fixtures.gardenResponse),
      fetchedAt: START_ISO,
    });
  });

  it("also accepts a flat (un-nested) upstream response", async () => {
    const { get } = harness(
      happyRoutes({ [GARDEN_ROUTE]: () => json(fixtures.gardenResponse) }),
    );

    const res = await get(`/api/garden?profile=${PROFILE}`);

    expect(
      ((await res.json()) as { garden: { level: number } }).garden.level,
    ).toBe(15);
  });

  it.each(["", "not-a-uuid", "3333333-3333-3333-3333-333333333333"])(
    "rejects invalid profile %j with bad_request and no upstream calls",
    async (profile) => {
      const { get, net } = harness();

      const res = await get(`/api/garden?profile=${profile}`);

      expect(res.status).toBe(400);
      expect(await code(res)).toBe("bad_request");
      expect(net.calls).toEqual([]);
    },
  );

  it("returns 404 no_garden for garden:null, a 404 upstream, and success:false", async () => {
    for (const handler of [
      () => json({ success: true, garden: null }),
      () => new Response("", { status: 404 }),
      () => json({ success: false, cause: "No garden" }),
    ]) {
      const { get } = harness(happyRoutes({ [GARDEN_ROUTE]: handler }));
      const res = await get(`/api/garden?profile=${PROFILE}`);
      expect(res.status).toBe(404);
      expect(await code(res)).toBe("no_garden");
    }
  });

  it("returns 502 upstream_down when Hypixel keeps failing", async () => {
    const { get } = harness(
      happyRoutes({ [GARDEN_ROUTE]: () => new Response("", { status: 500 }) }),
    );

    const res = await get(`/api/garden?profile=${PROFILE}`);

    expect(res.status).toBe(502);
    expect(await code(res)).toBe("upstream_down");
  });

  it("caches 60 s per profile; dashed and undashed forms share one entry", async () => {
    const { get, net, clock } = harness();

    await get(`/api/garden?profile=${PROFILE}`);
    clock.advance(30_000);
    await get(
      `/api/garden?profile=${PROFILE.replaceAll("-", "").toUpperCase()}`,
    );
    expect(net.calls.filter((c) => c === GARDEN_ROUTE)).toHaveLength(1);

    clock.advance(31_000);
    await get(`/api/garden?profile=${PROFILE}`);
    expect(net.calls.filter((c) => c === GARDEN_ROUTE)).toHaveLength(2);
  });

  it("shares the per-IP bucket with /api/link", async () => {
    const { get } = harness();
    const ip = { "CF-Connecting-IP": "4.4.4.4" };

    for (let i = 0; i < 5; i++) await get("/api/link?name=TestFarmer", ip);
    for (let i = 0; i < 5; i++) await get(`/api/garden?profile=${PROFILE}`, ip);

    const limited = await get(`/api/garden?profile=${PROFILE}`, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });
});
