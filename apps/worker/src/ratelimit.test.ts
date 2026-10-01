import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeKV, makeClock, makeEnv } from "../test/helpers";
import { AppError } from "./errors";
import {
  createBindingLimiter,
  createKvLimiter,
  enforceRateLimit,
  pickLimiter,
} from "./ratelimit";

afterEach(() => vi.restoreAllMocks());

describe("createKvLimiter", () => {
  it("allows 10 requests per window and denies the 11th with a retryAfter", async () => {
    const clock = makeClock(120_000 + 15_000); // 15 s into a 60 s window
    const limiter = createKvLimiter(
      new FakeKV() as unknown as KVNamespace,
      clock.now,
    );

    for (let i = 0; i < 10; i++) {
      expect((await limiter.allow("1.1.1.1")).ok).toBe(true);
    }
    expect(await limiter.allow("1.1.1.1")).toEqual({
      ok: false,
      retryAfter: 45,
    });
  });

  it("tracks keys independently and resets in the next window", async () => {
    const clock = makeClock(0);
    const limiter = createKvLimiter(
      new FakeKV() as unknown as KVNamespace,
      clock.now,
      1,
    );

    expect((await limiter.allow("a")).ok).toBe(true);
    expect((await limiter.allow("a")).ok).toBe(false);
    expect((await limiter.allow("b")).ok).toBe(true);

    clock.advance(60_000);
    expect((await limiter.allow("a")).ok).toBe(true);
  });
});

describe("createKvLimiter KV failures", () => {
  it("allows the request and logs when kv.put is throttled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const kv = {
      get: async () => null,
      put: async () => {
        throw new Error("KV put() limit exceeded secret-xyz");
      },
    } as unknown as KVNamespace;
    const limiter = createKvLimiter(kv, makeClock().now);

    expect(await limiter.allow("1.1.1.1")).toEqual({ ok: true, retryAfter: 0 });

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("ratelimit_write_failed");
    expect(logged).not.toContain("secret-xyz");
  });

  it("fails closed when kv.get throws", async () => {
    const kv = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {},
    } as unknown as KVNamespace;
    const limiter = createKvLimiter(kv, makeClock().now);

    await expect(limiter.allow("1.1.1.1")).rejects.toThrow("kv down");
  });

  it("fails closed when the binding limiter throws", async () => {
    const limiter = createBindingLimiter({
      limit: async () => {
        throw new Error("binding down");
      },
    });

    await expect(limiter.allow("k")).rejects.toThrow("binding down");
  });
});

describe("createBindingLimiter", () => {
  it("maps the binding result to allow()", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const limiter = createBindingLimiter({ limit });

    expect(await limiter.allow("k")).toEqual({ ok: false, retryAfter: 60 });
    expect(limit).toHaveBeenCalledWith({ key: "k" });
  });
});

describe("pickLimiter / enforceRateLimit", () => {
  it("prefers the binding when present", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = makeEnv({ RATE_LIMITER: { limit } });

    await enforceRateLimit(env, "9.9.9.9", makeClock().now);

    expect(limit).toHaveBeenCalledWith({ key: "9.9.9.9" });
  });

  it("uses the KV counter otherwise and throws rate_limited when exceeded", async () => {
    const env = makeEnv();
    const clock = makeClock();
    const limiter = pickLimiter(env, clock.now);
    expect(typeof limiter.allow).toBe("function");

    for (let i = 0; i < 10; i++)
      await enforceRateLimit(env, "2.2.2.2", clock.now);

    const err = await enforceRateLimit(env, "2.2.2.2", clock.now).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("rate_limited");
    expect((err as AppError).retryAfter).toBeGreaterThan(0);
  });

  it("buckets a missing IP under 'unknown'", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = makeEnv({ RATE_LIMITER: { limit } });

    await enforceRateLimit(env, undefined, makeClock().now);

    expect(limit).toHaveBeenCalledWith({ key: "unknown" });
  });
});
