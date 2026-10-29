import { Hono } from "hono";
import type { AppDeps } from "../app";
import { getCachedContests } from "../contests";
import type { Env } from "../env";

export function contestsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/contests", async (c) => {
    const { value, fetchedAt } = await getCachedContests(
      c.env.CACHE,
      deps.fetch,
      deps.now,
    );

    c.header("Cache-Control", "public, max-age=60");
    return c.json({ ...value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
