import { normalizeProfiles } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";
import { lookupUuid } from "../mojang";
import { enforceRateLimit } from "../ratelimit";
import { parseName } from "../validate";

const CACHE_TTL_SECONDS = 60;

export function linkRoute(
  deps: AppDeps,
  clientFor: ClientFactory,
): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/link", async (c) => {
    const name = parseName(c.req.query("name"));
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);

    // Keyed by name: the uuid is unknown until Mojang answers.
    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `link:${name.toLowerCase()}`,
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        const player = await lookupUuid(deps.fetch, name, {
          kv: c.env.CACHE,
          now: deps.now,
        });
        const { profiles, selectedProfileId } = normalizeProfiles(
          await clientFor(c.env).profiles(player.uuid),
        );

        if (selectedProfileId === null) {
          throw new AppError(
            "no_garden",
            "That player has no SkyBlock profiles",
          );
        }

        return {
          uuid: player.uuid,
          name: player.name,
          profileId: selectedProfileId,
          profiles,
        };
      },
    );

    c.header("Cache-Control", "no-store");
    return c.json({ ...value, fetchedAt: new Date(fetchedAt).toISOString() });
  });

  return route;
}
