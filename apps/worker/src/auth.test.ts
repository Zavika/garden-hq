import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEnv } from "../test/helpers";
import { authenticate } from "./auth";
import { AppError } from "./errors";
import { CODE_FAILURE_COST } from "./ratelimit";
import { hashSyncCode } from "./synccode";

afterEach(() => vi.restoreAllMocks());

const CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const now = () => 1_000_000;

function fakeLimiter(success = true) {
  const limit = vi.fn(async () => ({ success }));
  return { limit };
}

async function setup(success = true, lastSeen = 1) {
  const limiter = fakeLimiter(success);
  const env = makeEnv({ CODE_LIMITER: limiter });
  await env.DB.prepare(
    "INSERT INTO accounts (id, code_hash, mc_uuid, mc_name, profile_id, profiles, tz, revision, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
  )
    .bind(
      "acc1",
      await hashSyncCode(CODE),
      "uuid1",
      "TestFarmer",
      "prof1",
      JSON.stringify([{ profileId: "prof1", name: "Apple", selected: true }]),
      "Europe/Warsaw",
      7,
      1,
      lastSeen,
    )
    .run();
  return { env, limiter };
}

const req = (header?: string) => ({
  header: (n: string) =>
    n === "Authorization"
      ? header
      : n === "CF-Connecting-IP"
        ? "1.2.3.4"
        : undefined,
});

async function code(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected rejection");
}

describe("authenticate", () => {
  it("rejects a missing header", async () => {
    const { env } = await setup();
    const err = await code(authenticate({ env, req: req() }, now));
    expect(err.code).toBe("unauthorized");
  });

  it("rejects a malformed header without touching DB or limiter", async () => {
    const { env, limiter } = await setup();
    const prepare = vi.spyOn(env.DB, "prepare");
    for (const h of ["Bearer short", "Basic " + CODE, "Bearer " + CODE + "A"]) {
      const err = await code(authenticate({ env, req: req(h) }, now));
      expect(err.code).toBe("unauthorized");
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("charges extra limiter units for an unknown code", async () => {
    const { env, limiter } = await setup();
    const other = "A".repeat(32);
    const err = await code(
      authenticate({ env, req: req(`Bearer ${other}`) }, now),
    );
    expect(err.code).toBe("unauthorized");
    expect(limiter.limit).toHaveBeenCalledTimes(1 + CODE_FAILURE_COST);
  });

  it("returns the account for a valid code", async () => {
    const { env, limiter } = await setup();
    const row = await authenticate(
      { env, req: req(`Bearer ${CODE.toLowerCase()}`) },
      now,
    );
    expect(row).toEqual({
      id: "acc1",
      mcUuid: "uuid1",
      mcName: "TestFarmer",
      profileId: "prof1",
      profiles: [{ profileId: "prof1", name: "Apple", selected: true }],
      tz: "Europe/Warsaw",
      revision: 7,
      opsDay: 0,
      opsCount: 0,
      lastSeenAt: 1,
    });
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });

  it("returns rate_limited without a DB query when the limiter refuses", async () => {
    const { env } = await setup(false);
    const prepare = vi.spyOn(env.DB, "prepare");
    const err = await code(
      authenticate({ env, req: req(`Bearer ${CODE}`) }, now),
    );
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(60);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("never logs the code", async () => {
    const { env } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await authenticate({ env, req: req(`Bearer ${CODE}`) }, now);
    await code(
      authenticate({ env, req: req(`Bearer ${"B".repeat(32)}`) }, now),
    );
    const all = JSON.stringify([
      log.mock.calls,
      error.mock.calls,
      warn.mock.calls,
    ]);
    expect(all).not.toContain(CODE);
    expect(all).not.toContain("B".repeat(32));
  });

  it("does not write last_seen_at when it is under a day old", async () => {
    const { env } = await setup(true, now() - 1000);
    const prepare = vi.spyOn(env.DB, "prepare");
    await authenticate({ env, req: req(`Bearer ${CODE}`) }, now);
    expect(prepare.mock.calls.some(([q]) => /UPDATE/i.test(q))).toBe(false);
    const r = await env.DB.prepare(
      "SELECT last_seen_at AS t FROM accounts",
    ).first<{ t: number }>();
    expect(r?.t).toBe(now() - 1000);
  });

  it("bumps a stale last_seen_at to now once, then leaves it", async () => {
    const { env } = await setup(true, 1);
    const day = 86_400_000;
    let t = now() + day;
    const row = await authenticate(
      { env, req: req(`Bearer ${CODE}`) },
      () => t,
    );
    expect(row.lastSeenAt).toBe(t);
    const read = async () =>
      (
        await env.DB.prepare("SELECT last_seen_at AS t FROM accounts").first<{
          t: number;
        }>()
      )?.t;
    expect(await read()).toBe(t);
    const first = t;
    t += 5000;
    await authenticate({ env, req: req(`Bearer ${CODE}`) }, () => t);
    expect(await read()).toBe(first);
  });

  it("still authenticates when the last_seen_at update throws", async () => {
    const { env } = await setup(true, 1);
    const real = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((q: string) => {
      if (/UPDATE accounts/i.test(q)) throw new Error("db down");
      return real(q);
    });
    const row = await authenticate(
      { env, req: req(`Bearer ${CODE}`) },
      () => now() + 86_400_000 * 2,
    );
    expect(row.id).toBeTruthy();
    expect(row.lastSeenAt).toBe(1);
  });
});
