import { normalizeGarden, unwrapGardenResponse } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";
import { enforceRateLimit } from "../ratelimit";
import { parseUuid } from "../validate";

const CACHE_TTL_SECONDS = 60;

export function gardenRoute(
  deps: AppDeps,
  clientFor: ClientFactory,
): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/garden", async (c) => {
    const profileId = parseUuid(c.req.query("profile"));
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);

    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `garden:${profileId}`,
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        const raw = unwrapGardenResponse(
          await clientFor(c.env).garden(profileId),
        );
        if (raw === null) {
          throw new AppError("no_garden", "No Garden found for that profile");
        }
        return normalizeGarden(raw);
      },
    );

    c.header("Cache-Control", "no-store");
    return c.json({
      garden: value,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  });

  return route;
}
