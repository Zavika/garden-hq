import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wantedProductIds } from "@garden-hq/core";
import {
  happyRoutes,
  json,
  makeHarness,
  TEST_KEY,
  type FakeKV,
} from "../../test/helpers";

const BAZAAR_ROUTE = "api.hypixel.net/v2/skyblock/bazaar";
const fixtureText = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../packages/core/fixtures/bazaar-response.sample.json",
      import.meta.url,
    ),
  ),
  "utf8",
);

afterEach(() => vi.restoreAllMocks());

function harness(
  handler: (req: { headers: Headers }) => Response = () =>
    new Response(fixtureText),
) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return makeHarness(happyRoutes({ [BAZAAR_ROUTE]: handler }));
}

const bazaarCalls = (calls: string[]) =>
  calls.filter((c) => c === BAZAAR_ROUTE).length;

describe("GET /api/bazaar", () => {
  it("serves extracted prices from the upstream text", async () => {
    const { get } = harness();

    const res = await get("/api/bazaar");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prices: Record<string, { sellOffer: number | null }>;
      lastUpdated: number | null;
      fetchedAt: string;
    };
    expect(Object.keys(body.prices).length).toBeGreaterThan(0);
    expect(body.prices["ENCHANTED_CARROT"]?.sellOffer).toBeTypeOf("number");
    expect(body.lastUpdated).toBeTypeOf("number");
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("returns only wanted ids, not the upstream body", async () => {
    const { get } = harness();

    const body = (await (await get("/api/bazaar")).json()) as {
      prices: Record<string, unknown>;
    };

    expect(body.prices["ENCHANTED_CARROT_ON_A_STICK"]).toBeUndefined();
    const wanted = new Set(wantedProductIds());
    for (const key of Object.keys(body.prices)) {
      expect(wanted.has(key)).toBe(true);
    }
  });

  it("sets Cache-Control public, max-age=60", async () => {
    const { get } = harness();
    const res = await get("/api/bazaar");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("sends no API key or authorization to the public endpoint", async () => {
    let seen: Headers | undefined;
    const { get } = harness((req) => {
      seen = req.headers;
      return new Response(fixtureText);
    });

    await get("/api/bazaar");

    expect(seen).toBeDefined();
    expect(seen?.get("API-Key")).toBeNull();
    expect(seen?.get("Authorization")).toBeNull();
    expect([...(seen?.values() ?? [])].join(" ")).not.toContain(TEST_KEY);
  });

  it("caches for 10 minutes", async () => {
    const { get, net, clock } = harness();

    await get("/api/bazaar");
    clock.advance(9 * 60_000);
    await get("/api/bazaar");
    expect(bazaarCalls(net.calls)).toBe(1);

    clock.advance(2 * 60_000);
    await get("/api/bazaar");
    expect(bazaarCalls(net.calls)).toBe(2);
  });

  it("returns 502 upstream_down on upstream failure and caches nothing", async () => {
    let down = true;
    const { get, net } = harness(() =>
      down ? new Response("", { status: 500 }) : new Response(fixtureText),
    );

    const res = await get("/api/bazaar");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "upstream_down",
    );

    const failedCalls = bazaarCalls(net.calls);
    down = false;
    expect((await get("/api/bazaar")).status).toBe(200);
    expect(bazaarCalls(net.calls)).toBe(failedCalls + 1);
  });

  it("treats a body with zero extractable products as upstream_down, uncached", async () => {
    let good = false;
    const { get, net, env } = harness(() =>
      good
        ? new Response(fixtureText)
        : json({ success: true, lastUpdated: 1, products: {} }),
    );

    const res = await get("/api/bazaar");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "upstream_down",
    );
    expect(bazaarCalls(net.calls)).toBe(1);
    expect((env.CACHE as unknown as FakeKV).store.has("bazaar")).toBe(false);

    good = true;
    expect((await get("/api/bazaar")).status).toBe(200);
  });
});
