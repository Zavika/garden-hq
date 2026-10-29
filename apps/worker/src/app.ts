import { pingCore } from "@garden-hq/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { allowedOriginFor } from "./cors";
import type { Env } from "./env";
import { AppError, errorBody } from "./errors";
import {
  createHypixelClient,
  createRateLimitState,
  type ClientFactory,
} from "./hypixel";
import { logError, redact } from "./log";
import { createMemoryCache } from "./memcache";
import { accountRoute } from "./routes/account";
import { alertsRoute } from "./routes/alerts";
import { contestsRoute } from "./routes/contests";
import { gardenRoute } from "./routes/garden";
import { linkRoute } from "./routes/link";
import { mayorRoute } from "./routes/mayor";
import { memberRoute } from "./routes/member";
import { syncRoute } from "./routes/sync";

export interface AppDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function createApp(
  overrides: Partial<AppDeps> = {},
): Hono<{ Bindings: Env }> {
  const deps: AppDeps = {
    // Wrapped: a bare `fetch` reference loses its binding in Workers.
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };

  // One rate-limit state per app instance (per isolate) so RateLimit-* headers carry over.
  const hypixelState = createRateLimitState();
  // Per-player responses are cached in memory, never in KV (free-plan write limit).
  const playerCache = createMemoryCache();
  const clientFor: ClientFactory = (env) =>
    createHypixelClient({
      fetch: deps.fetch,
      apiKey: env.HYPIXEL_API_KEY,
      now: deps.now,
      sleep: deps.sleep,
      state: hypixelState,
    });

  const app = new Hono<{ Bindings: Env }>();

  app.use("/api/*", (c, next) =>
    cors({
      // c.env is undefined when the app is invoked without bindings.
      origin: allowedOriginFor(c.env ?? {}),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "If-None-Match"],
      exposeHeaders: ["ETag", "Retry-After"],
      maxAge: 600,
    })(c, next),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      core: pingCore(),
    }),
  );

  app.route("/api", linkRoute(deps, clientFor, playerCache));
  app.route("/api", gardenRoute(deps, clientFor, playerCache));
  app.route("/api", memberRoute(deps, clientFor, playerCache));
  app.route("/api", contestsRoute(deps));
  app.route("/api", mayorRoute(deps, clientFor));
  app.route("/api", accountRoute(deps));
  app.route("/api", syncRoute(deps));
  app.route("/api", alertsRoute(deps));

  app.notFound((c) => {
    c.header("Cache-Control", "no-store");
    return c.json(errorBody(new AppError("not_found", "Unknown route")), 404);
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.retryAfter !== undefined)
        c.header("Retry-After", String(err.retryAfter));
      c.header("Cache-Control", "no-store");
      return c.json(errorBody(err), err.status);
    }

    logError("unhandled", {
      name: err.name,
      message: redact(err.message, c.env?.HYPIXEL_API_KEY),
    });
    c.header("Cache-Control", "no-store");
    return c.json(errorBody(new AppError("internal", "Internal error")), 500);
  });

  return app;
}
