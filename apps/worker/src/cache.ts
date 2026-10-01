import { logError } from "./log";

interface Entry<T> {
  fetchedAt: number;
  value: T;
}

// KV rejects expirationTtl below 60 s.
const MIN_KV_TTL_SECONDS = 60;

function isEntry<T>(value: unknown): value is Entry<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { fetchedAt?: unknown }).fetchedAt === "number" &&
    "value" in value
  );
}

/**
 * Server-side cache of our own normalized output. Freshness is judged from the
 * stored `fetchedAt` (not KV expiry), so it is testable with a fake clock.
 * Failures from `produce` are never cached; KV outages degrade to no caching.
 */
export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  now: () => number,
  produce: () => Promise<T>,
): Promise<{ value: T; fetchedAt: number }> {
  try {
    const raw = await kv.get(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (isEntry<T>(parsed) && now() - parsed.fetchedAt < ttlSeconds * 1000) {
        return { value: parsed.value, fetchedAt: parsed.fetchedAt };
      }
    }
  } catch {
    // Unreadable or corrupt entry: treat as a miss.
  }

  const value = await produce();
  const fetchedAt = now();

  try {
    await kv.put(key, JSON.stringify({ fetchedAt, value }), {
      expirationTtl: Math.max(MIN_KV_TTL_SECONDS, ttlSeconds),
    });
  } catch {
    logError("cache_write_failed");
  }

  return { value, fetchedAt };
}
