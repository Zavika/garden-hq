import { parseOpsLenient } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { authenticate } from "../auth";
import { readJsonBody } from "../body";
import type { Env } from "../env";
import { AppError } from "../errors";
import {
  MAX_OPS_PER_ACCOUNT_PER_DAY,
  secondsToNextUtcDay,
  utcDay,
} from "../limits";
import {
  applyOpsToDb,
  filterProgressOps,
  loadAccount,
  readState,
} from "../sync/db";

/** True when If-None-Match (a list, possibly weak `W/` validators) names `etag`. */
function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(",")
    .some((part) => part.trim().replace(/^W\//, "") === etag);
}

export function syncRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/sync", async (c) => {
    const account = await authenticate(c, deps.now);
    const etag = `"${account.revision}"`;
    c.header("Cache-Control", "no-store");
    c.header("ETag", etag);
    if (etagMatches(c.req.header("If-None-Match"), etag))
      return c.body(null, 304);
    return c.json(await readState(c.env.DB, account, deps.now()));
  });

  route.post("/sync", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    const parsed = parseOpsLenient(body.ops);
    if (!parsed.ok) throw new AppError("bad_request", parsed.error);
    const now = deps.now();
    const filtered = filterProgressOps(parsed.ops, now, account.tz);
    const rejected = parsed.rejected + filtered.rejected;
    const used = account.opsDay === utcDay(now) ? account.opsCount : 0;
    if (used + filtered.ops.length > MAX_OPS_PER_ACCOUNT_PER_DAY) {
      throw new AppError(
        "rate_limited",
        "Daily cloud save limit reached for this account — try again tomorrow.",
        secondsToNextUtcDay(now),
      );
    }
    await applyOpsToDb(c.env.DB, account.id, filtered.ops, now);
    // Re-read: another request may have bumped the revision in between.
    const fresh = await loadAccount(c.env.DB, account.id);
    if (fresh === null) {
      throw new AppError("unauthorized", "Account was deleted");
    }
    c.header("Cache-Control", "no-store");
    c.header("ETag", `"${fresh.revision}"`);
    const state = await readState(c.env.DB, fresh, now);
    return c.json(rejected > 0 ? { ...state, rejected } : state);
  });

  return route;
}
