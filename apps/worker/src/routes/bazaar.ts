import { extractBazaar, wantedProductIds } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";

const CACHE_TTL_SECONDS = 10 * 60;

export function bazaarRoute(
  deps: AppDeps,
  clientFor: ClientFactory,
): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/bazaar", async (c) => {
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      "bazaar",
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        // Text scan, never JSON.parse: the body is ~3.4 MB. Nothing extracted
        // is an upstream failure, which keeps it out of the cache.
        const text = await clientFor(c.env).bazaar();
        const snapshot = extractBazaar(text, wantedProductIds());
        if (Object.keys(snapshot.prices).length === 0) {
          throw new AppError("upstream_down", "Bazaar data is unavailable");
        }
        return snapshot;
      },
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      prices: value.prices,
      lastUpdated: value.lastUpdated,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  });

  return route;
}
