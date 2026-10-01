import { normalizeMayor } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
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
      async () => normalizeMayor(await clientFor(c.env).election()),
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      mayor: value,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  });

  return route;
}
