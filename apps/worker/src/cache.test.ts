import { describe, expect, it, vi } from "vitest";
import { FakeKV, makeClock } from "../test/helpers";
import { cached } from "./cache";

function setup() {
  const kv = new FakeKV();
  const clock = makeClock(1_000_000);
  return { kv: kv as unknown as KVNamespace, fake: kv, clock };
}

describe("cached", () => {
  it("produces on a miss and stores the value with fetchedAt", async () => {
    const { kv, clock } = setup();
    const produce = vi.fn(async () => ({ n: 1 }));

    const result = await cached(kv, "k", 60, clock.now, produce);

    expect(result).toEqual({ value: { n: 1 }, fetchedAt: 1_000_000 });
    expect(produce).toHaveBeenCalledOnce();
  });

  it("serves a fresh entry without calling produce, keeping the original fetchedAt", async () => {
    const { kv, clock } = setup();
    const produce = vi.fn(async () => "v");

    await cached(kv, "k", 60, clock.now, produce);
    clock.advance(59_000);
    const second = await cached(kv, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledOnce();
    expect(second.fetchedAt).toBe(1_000_000);
  });

  it("re-produces once the entry is older than the TTL", async () => {
    const { kv, clock } = setup();
    const produce = vi.fn(async () => "v");

    await cached(kv, "k", 60, clock.now, produce);
    clock.advance(60_000);
    const second = await cached(kv, "k", 60, clock.now, produce);

    expect(produce).toHaveBeenCalledTimes(2);
    expect(second.fetchedAt).toBe(1_060_000);
  });

  it("never caches a failure", async () => {
    const { kv, fake, clock } = setup();

    await expect(
      cached(kv, "k", 60, clock.now, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(fake.store.size).toBe(0);
  });

  it("falls back to producing when KV reads or writes fail", async () => {
    const clock = makeClock();
    const broken = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {
        throw new Error("kv down");
      },
    } as unknown as KVNamespace;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await cached(broken, "k", 60, clock.now, async () => 7);

    expect(result.value).toBe(7);
  });

  it("ignores a corrupt cache entry", async () => {
    const { kv, fake, clock } = setup();
    fake.store.set("k", "{not json");

    const result = await cached(kv, "k", 60, clock.now, async () => "fresh");

    expect(result.value).toBe("fresh");
  });
});
