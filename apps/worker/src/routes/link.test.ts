import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOJANG_ROUTE,
  PROFILES_ROUTE,
  START_ISO,
  happyRoutes,
  fixtures,
  json,
  makeHarness,
} from "../../test/helpers";

afterEach(() => vi.restoreAllMocks());

function harness(routes = happyRoutes(), env = {}) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(routes, env);
}

describe("GET /api/link", () => {
  it("links a name to the selected profile", async () => {
    const { get } = harness();

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      uuid: "11111111-1111-1111-1111-111111111111",
      name: "TestFarmer",
      profileId: "33333333-3333-3333-3333-333333333333",
      profiles: [
        {
          profileId: "22222222-2222-2222-2222-222222222222",
          name: "Apple",
          selected: false,
        },
        {
          profileId: "33333333-3333-3333-3333-333333333333",
          name: "Banana",
          selected: true,
        },
      ],
      fetchedAt: START_ISO,
    });
  });

  it.each(["", "a%20b", "bad-name", "a".repeat(17)])(
    "rejects invalid name %j with bad_request and makes no upstream calls",
    async (name) => {
      const { get, net } = harness();

      const res = await get(`/api/link?name=${name}`);

      expect(res.status).toBe(400);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("bad_request");
      expect(net.calls).toEqual([]);
    },
  );

  it("rejects a missing name parameter", async () => {
    const { get } = harness();
    expect((await get("/api/link")).status).toBe(400);
  });

  it("returns 404 unknown_player for an unknown name", async () => {
    const { get } = harness(
      happyRoutes({ [MOJANG_ROUTE]: () => new Response("", { status: 404 }) }),
    );

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "unknown_player",
    );
  });

  it("links a player whose profiles response has real-world member blobs", async () => {
    const { get } = harness(
      happyRoutes({ [PROFILES_ROUTE]: () => json(fixtures.profilesRealShape) }),
    );

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(200);
    expect(((await res.json()) as { profileId: string }).profileId).toBe(
      "44444444-4444-4444-4444-444444444444",
    );
  });

  it("returns 500 bad_api_key when Hypixel rejects the key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { get } = harness(
      happyRoutes({
        [PROFILES_ROUTE]: () =>
          json({ success: false, cause: "Invalid API key" }, { status: 403 }),
      }),
    );

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "bad_api_key",
    );
  });

  it("returns 404 no_garden when the player has no SkyBlock profiles", async () => {
    const { get } = harness(
      happyRoutes({
        [PROFILES_ROUTE]: () => json({ success: true, profiles: null }),
      }),
    );

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "no_garden",
    );
  });

  it("returns 500 missing_api_key when the Worker has no key", async () => {
    const { get } = harness(happyRoutes(), { HYPIXEL_API_KEY: undefined });

    const res = await get("/api/link?name=TestFarmer");

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "missing_api_key",
    );
  });

  it("serves repeats within 60 s from cache (case-insensitive), then refetches", async () => {
    const { get, net, clock } = harness();

    await get("/api/link?name=TestFarmer");
    clock.advance(59_000);
    const hit = await get("/api/link?name=TestFarmer");
    expect(net.calls.filter((c) => c === PROFILES_ROUTE)).toHaveLength(1);
    expect(((await hit.json()) as { fetchedAt: string }).fetchedAt).toBe(
      START_ISO,
    );

    clock.advance(2_000);
    await get("/api/link?name=TestFarmer");
    expect(net.calls.filter((c) => c === PROFILES_ROUTE)).toHaveLength(2);
    // The name→uuid mapping outlives the 60 s link cache (24 h).
    expect(net.calls.filter((c) => c === MOJANG_ROUTE)).toHaveLength(1);
  });

  it("rate-limits per IP: 10 requests ok, the 11th is 429 with Retry-After; other IPs unaffected", async () => {
    const { get } = harness();
    const ip = { "CF-Connecting-IP": "1.2.3.4" };

    for (let i = 0; i < 10; i++) {
      expect((await get("/api/link?name=TestFarmer", ip)).status).toBe(200);
    }
    const limited = await get("/api/link?name=TestFarmer", ip);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(
      ((await limited.json()) as { error: { code: string } }).error.code,
    ).toBe("rate_limited");

    expect(
      (
        await get("/api/link?name=TestFarmer", {
          "CF-Connecting-IP": "5.6.7.8",
        })
      ).status,
    ).toBe(200);
  });

  it("does not spend the limiter on invalid input", async () => {
    const { get } = harness();
    const ip = { "CF-Connecting-IP": "9.9.9.9" };

    for (let i = 0; i < 15; i++) await get("/api/link?name=bad-name", ip);

    expect((await get("/api/link?name=TestFarmer", ip)).status).toBe(200);
  });
});
