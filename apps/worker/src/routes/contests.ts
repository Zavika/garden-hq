import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import { fetchContests } from "../contests";
import type { Env } from "../env";

const CACHE_TTL_SECONDS = 15 * 60;

export function contestsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/contests", async (c) => {
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      "contests",
      CACHE_TTL_SECONDS,
      deps.now,
      () => fetchContests(deps.fetch),
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({ ...value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
