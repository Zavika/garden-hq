interface Entry {
  fetchedAt: number;
  value: unknown;
}

export interface MemoryCache {
  readonly entries: Map<string, Entry>;
  readonly maxEntries: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createMemoryCache(
  maxEntries = DEFAULT_MAX_ENTRIES,
): MemoryCache {
  return { entries: new Map(), maxEntries };
}

/**
 * Per-isolate TTL cache for per-player data. Unlike `cached()` it never touches
 * KV (free plan: 1,000 writes/day). Best effort: another isolate or a restart
 * starts empty, which only costs one more upstream call. Failures are not cached.
 */
export async function cachedInMemory<T>(
  cache: MemoryCache,
  key: string,
  ttlSeconds: number,
  now: () => number,
  produce: () => Promise<T>,
): Promise<{ value: T; fetchedAt: number }> {
  const hit = cache.entries.get(key);
  if (hit !== undefined && now() - hit.fetchedAt < ttlSeconds * 1000) {
    return { value: hit.value as T, fetchedAt: hit.fetchedAt };
  }

  const value = await produce();
  const fetchedAt = now();

  // Re-insert so the Map's insertion order is also age order.
  cache.entries.delete(key);
  cache.entries.set(key, { fetchedAt, value });
  while (cache.entries.size > cache.maxEntries) {
    const oldest = cache.entries.keys().next();
    if (oldest.done === true) break;
    cache.entries.delete(oldest.value);
  }

  return { value, fetchedAt };
}
