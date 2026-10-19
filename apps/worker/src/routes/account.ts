import { parseOps, type AccountCreateResponse } from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { authenticate } from "../auth";
import { readJsonBody } from "../body";
import type { Env } from "../env";
import { AppError } from "../errors";
import { MAX_ACCOUNTS_CREATED_PER_DAY, MS_PER_DAY } from "../limits";
import { enforceRateLimit } from "../ratelimit";
import { createAccount, deleteAccount } from "../sync/db";
import { generateSyncCode, hashSyncCode } from "../synccode";

export function accountRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.post("/account", async (c) => {
    await enforceRateLimit(c.env, c.req.header("CF-Connecting-IP"), deps.now);
    const body = await readJsonBody(c);
    const parsed = parseOps([{ t: "setLink", link: body.link }]);
    if (!parsed.ok) throw new AppError("bad_request", parsed.error);
    const op = parsed.ops[0];
    if (op === undefined || op.t !== "setLink") {
      throw new AppError("bad_request", "Invalid link");
    }
    const since = deps.now() - MS_PER_DAY;
    const created = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM account_creations WHERE created_at > ?1",
    )
      .bind(since)
      .first<{ n: number }>();
    if ((created?.n ?? 0) >= MAX_ACCOUNTS_CREATED_PER_DAY) {
      throw new AppError(
        "rate_limited",
        "Cloud save is temporarily full today — try again tomorrow.",
        3600,
      );
    }
    const code = generateSyncCode();
    await createAccount(c.env.DB, {
      id: crypto.randomUUID(),
      codeHash: await hashSyncCode(code),
      link: op.link,
      now: deps.now(),
    });
    c.header("Cache-Control", "no-store");
    return c.json({ syncCode: code } satisfies AccountCreateResponse, 201);
  });

  route.delete("/account", async (c) => {
    const account = await authenticate(c, deps.now);
    await deleteAccount(c.env.DB, account.id);
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });

  return route;
}
