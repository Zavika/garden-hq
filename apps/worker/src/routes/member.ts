import { findProfileMember, normalizeGardenMember } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { cached } from "../cache";
import type { Env } from "../env";
import { AppError } from "../errors";
import type { ClientFactory } from "../hypixel";
import { enforceRateLimit } from "../ratelimit";
import { parseUuid } from "../validate";

const CACHE_TTL_SECONDS = 60;

export function memberRoute(
  deps: AppDeps,
  clientFor: ClientFactory,
): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/member", async (c) => {
    const profileId = parseUuid(c.req.query("profile"));
    const uuid = parseUuid(c.req.query("uuid"));
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);

    const { value, fetchedAt } = await cached(
      c.env.CACHE,
      `member:${profileId}:${uuid}`,
      CACHE_TTL_SECONDS,
      deps.now,
      async () => {
        const member = findProfileMember(
          await clientFor(c.env).profiles(uuid),
          profileId,
          uuid,
        );
        if (member === null) {
          throw new AppError(
            "no_garden",
            "No member data found for that profile",
          );
        }
        return normalizeGardenMember(member);
      },
    );

    c.header("Cache-Control", "no-store");
    return c.json({
      member: value,
      fetchedAt: new Date(fetchedAt).toISOString(),
    });
  });

  return route;
}
