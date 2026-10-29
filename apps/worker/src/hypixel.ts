import type { Env } from "./env";
import { AppError } from "./errors";
import { discardBody } from "./http";
import { logError, logUpstream, redact } from "./log";

const HOST = "api.hypixel.net";
const BASE = `https://${HOST}`;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 5000;
const BACKOFF_BASE_MS = 250;

/** Shared across requests in one isolate so RateLimit-* headers carry over. */
export interface RateLimitState {
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

export function createRateLimitState(): RateLimitState {
  return { remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
}

export interface HypixelDeps {
  fetch: typeof fetch;
  apiKey: string | undefined;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  state: RateLimitState;
}

export interface HypixelClient {
  profiles(uuid: string): Promise<unknown>;
  garden(profileId: string): Promise<unknown>;
  election(): Promise<unknown>;
}

export type ClientFactory = (env: Env) => HypixelClient;

const upstreamDown = () =>
  new AppError("upstream_down", "Hypixel is unavailable right now");

function backoffMs(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** attempt;
}

/** Best-effort `cause` from a 403 body, capped so a hostile body can't flood logs. */
async function forbiddenCause(res: Response): Promise<string> {
  try {
    const body: unknown = JSON.parse((await res.text()).slice(0, 2000));
    const cause = (body as { cause?: unknown } | null)?.cause;
    return typeof cause === "string" ? cause.slice(0, 200) : "unknown";
  } catch {
    return "unreadable";
  }
}

function headerNumber(res: Response, name: string): number | null {
  const header = res.headers.get(name);
  if (header === null) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// VERIFY: header names `RateLimit-Remaining` / `RateLimit-Reset` (seconds until
// reset) per CLAUDE.md §3; not yet checked against a live Hypixel response.
export function createHypixelClient(deps: HypixelDeps): HypixelClient {
  const { state } = deps;

  function readRateLimit(res: Response): void {
    const remaining = headerNumber(res, "RateLimit-Remaining");
    if (remaining !== null) state.remaining = remaining;

    const reset = headerNumber(res, "RateLimit-Reset");
    if (reset !== null) state.resetAt = deps.now() + reset * 1000;
  }

  /** `path` is a template with no secrets; `query` carries validated ids only. */
  async function request(
    path: string,
    query: string,
    auth: boolean,
  ): Promise<unknown> {
    // Pasted secrets often carry a trailing newline, which makes the header invalid.
    const apiKey = deps.apiKey?.trim();
    if (auth && (apiKey === undefined || apiKey === "")) {
      throw new AppError(
        "missing_api_key",
        "Server is missing its Hypixel API key",
      );
    }

    // The quota belongs to the API key; keyless calls are not subject to it.
    if (auth && state.remaining <= 0 && state.resetAt > deps.now()) {
      throw new AppError(
        "rate_limited",
        "Hypixel rate limit reached",
        Math.ceil((state.resetAt - deps.now()) / 1000),
      );
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const last = attempt === MAX_ATTEMPTS - 1;
      const started = deps.now();

      let res: Response;
      try {
        res = await deps.fetch(`${BASE}${path}${query}`, {
          headers: auth && apiKey !== undefined ? { "API-Key": apiKey } : {},
        });
      } catch {
        logUpstream({
          host: HOST,
          path,
          status: "error",
          ms: deps.now() - started,
        });
        if (last) throw upstreamDown();
        await deps.sleep(backoffMs(attempt));
        continue;
      }

      logUpstream({
        host: HOST,
        path,
        status: res.status,
        ms: deps.now() - started,
      });
      readRateLimit(res);

      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw upstreamDown();
        }
      }

      if (res.status === 401 || res.status === 403) {
        // Hypixel says why in `cause` (e.g. "Invalid API key"); log that, never the key.
        logError("hypixel_forbidden", {
          cause: redact(await forbiddenCause(res), apiKey),
        });
        throw new AppError(
          "bad_api_key",
          "Server's Hypixel API key was rejected",
        );
      }

      // Every path below ignores the body: free the connection first.
      discardBody(res);

      if (res.status === 404) return null;

      if (res.status === 429) {
        const retryAfter = headerNumber(res, "Retry-After");
        const waitMs =
          retryAfter !== null ? retryAfter * 1000 : backoffMs(attempt);
        if (last || waitMs > MAX_WAIT_MS) {
          throw new AppError(
            "rate_limited",
            "Hypixel rate limit reached",
            Math.max(1, Math.ceil(waitMs / 1000)),
          );
        }
        await deps.sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        if (last) throw upstreamDown();
        await deps.sleep(backoffMs(attempt));
        continue;
      }

      throw upstreamDown();
    }

    throw upstreamDown();
  }

  return {
    profiles: (uuid) =>
      request(
        "/v2/skyblock/profiles",
        `?uuid=${encodeURIComponent(uuid)}`,
        true,
      ),
    garden: (profileId) =>
      request(
        "/v2/skyblock/garden",
        `?profile=${encodeURIComponent(profileId)}`,
        true,
      ),
    election: () => request("/v2/resources/skyblock/election", "", false),
  };
}
