import { describe, expect, it, vi } from "vitest";
import { makeClock } from "../test/helpers";
import { cachedInMemory, createMemoryCache } from "./memcache";

describe("cachedInMemory", () => {
  it("produces on a miss and returns fetchedAt", async () => {
    const clock = makeClock(1_000_000);
    const produce = vi.fn(async () => ({ n: 1 }));

    const result = await cachedInMemory(
      createMemoryCache(),
      "k",
      60,
      clock.now,
      produce,
    );

    expect(result).toEqual({ value: { n: 1 }, fetchedAt: 1_000_000 });
    expect(produce).toHaveBeenCalledOnce();
  });

  it("serves a fresh entry without producing, keeping the original fetchedAt", async () => {
    const cache = createMemoryCache();
    const clock = makeClock(1_000_000);
    const produce = vi.fn(async () => "v");

    await cachedInMemory(cache, "k", 60, clock.now, produce);
    clock.advance(59_000);
    const second = await cachedInMemory(cache, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledOnce();
    expect(second.fetchedAt).toBe(1_000_000);
  });

  it("re-produces once the entry is as old as the TTL", async () => {
    const cache = createMemoryCache();
    const clock = makeClock(1_000_000);
    const produce = vi.fn(async () => "v");

    await cachedInMemory(cache, "k", 60, clock.now, produce);
    clock.advance(60_000);
    const second = await cachedInMemory(cache, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(second.fetchedAt).toBe(1_060_000);
  });

  it("never caches a failure", async () => {
    const cache = createMemoryCache();
    const clock = makeClock();

    await expect(
      cachedInMemory(cache, "k", 60, clock.now, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(cache.entries.size).toBe(0);
  });

  it("evicts the oldest entry beyond maxEntries", async () => {
    const cache = createMemoryCache(2);
    const clock = makeClock();

    for (const key of ["a", "b", "c"]) {
      await cachedInMemory(cache, key, 60, clock.now, async () => key);
    }

    expect([...cache.entries.keys()]).toEqual(["b", "c"]);
  });
});
