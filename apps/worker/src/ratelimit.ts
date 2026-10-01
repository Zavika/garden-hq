import type { Env, RateLimiterBinding } from "./env";
import { AppError } from "./errors";
import { logError } from "./log";

export interface Limiter {
  allow(key: string): Promise<{ ok: boolean; retryAfter: number }>;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Fixed-window KV counter. Approximate under concurrency (read-modify-write is
 * not atomic) — acceptable for abuse protection.
 */
export function createKvLimiter(
  kv: KVNamespace,
  now: () => number,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): Limiter {
  return {
    async allow(key) {
      const time = now();
      const window = Math.floor(time / windowMs);
      const kvKey = `rl:${key}:${window}`;

      const count = Number.parseInt((await kv.get(kvKey)) ?? "0", 10) || 0;
      if (count >= limit) {
        return {
          ok: false,
          retryAfter: Math.max(
            1,
            Math.ceil(((window + 1) * windowMs - time) / 1000),
          ),
        };
      }

      // expirationTtl must be >= 60 s; two windows is plenty for cleanup.
      try {
        await kv.put(kvKey, String(count + 1), {
          expirationTtl: Math.max(60, Math.ceil((windowMs * 2) / 1000)),
        });
      } catch {
        // A throttled write must not turn into a 500: the count was already
        // read, so allow the request. Log the event only (no error content).
        logError("ratelimit_write_failed");
      }
      return { ok: true, retryAfter: 0 };
    },
  };
}

/** Wraps the Cloudflare rate-limit binding (configured for a 60 s period). */
export function createBindingLimiter(binding: RateLimiterBinding): Limiter {
  return {
    async allow(key) {
      const { success } = await binding.limit({ key });
      return { ok: success, retryAfter: success ? 0 : 60 };
    },
  };
}

export function pickLimiter(env: Env, now: () => number): Limiter {
  return env.RATE_LIMITER !== undefined
    ? createBindingLimiter(env.RATE_LIMITER)
    : createKvLimiter(env.CACHE, now);
}

export async function enforceRateLimit(
  env: Env,
  ip: string | undefined,
  now: () => number,
): Promise<void> {
  const result = await pickLimiter(env, now).allow(ip ?? "unknown");
  if (!result.ok) {
    throw new AppError(
      "rate_limited",
      "Too many requests — slow down and retry shortly",
      result.retryAfter,
    );
  }
}
