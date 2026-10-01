import { normalizeMayor } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";

const CACHE_TTL_SECONDS = 60 * 60;

export function mayorRoute(
  deps: AppDeps,
  clientFor: ClientFactory,
): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/mayor", async (c) => {
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      "mayor",
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        // A missing mayor (404, success:false, malformed) is an upstream
        // failure: throwing keeps it out of the 1 h cache.
        const mayor = normalizeMayor(await clientFor(c.env).election());
        if (mayor === null) {
          throw new AppError("upstream_down", "Election data is unavailable");
        }
        return mayor;
      },
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      mayor: value,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  });

  return route;
}
