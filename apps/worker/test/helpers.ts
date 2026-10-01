import { createApp } from "../src/app";
import type { Env } from "../src/env";
import contestsElitebot from "../../../packages/core/fixtures/contests-elitebot.sample.json";
import contestsStrassburger from "../../../packages/core/fixtures/contests-strassburger.sample.json";
import electionResponse from "../../../packages/core/fixtures/election-response.sample.json";
import gardenResponse from "../../../packages/core/fixtures/garden-response.sample.json";
import mojangProfile from "../../../packages/core/fixtures/mojang-profile.sample.json";
import profilesResponse from "../../../packages/core/fixtures/profiles-response.sample.json";

export const TEST_KEY = "test-hypixel-key-123";
export const START_TIME = Date.UTC(2026, 9, 1, 12, 0, 0);
export const START_ISO = "2026-10-01T12:00:00.000Z";

export const fixtures = {
  contestsElitebot,
  contestsStrassburger,
  electionResponse,
  gardenResponse,
  mojangProfile,
  profilesResponse,
};

// Keys are `${host}${pathname}` (no query string).
export const MOJANG_ROUTE =
  "api.mojang.com/users/profiles/minecraft/TestFarmer";
export const PROFILES_ROUTE = "api.hypixel.net/v2/skyblock/profiles";
export const GARDEN_ROUTE = "api.hypixel.net/v2/skyblock/garden";
export const ELECTION_ROUTE = "api.hypixel.net/v2/resources/skyblock/election";
export const ELITEBOT_ROUTE = "api.elitebot.dev/contests/at/now";
export const STRASSBURGER_ROUTE = "jacobs.strassburger.dev/api/jacobcontests";

/** In-memory KV. Expiry is NOT simulated — code under test checks ages itself. */
export class FakeKV {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    HYPIXEL_API_KEY: TEST_KEY,
    CACHE: new FakeKV() as unknown as KVNamespace,
    WEB_ORIGIN: "https://app.example",
    ...overrides,
  };
}

export function makeClock(start = START_TIME): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

export function makeSleep(): {
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export interface FakeRequest {
  url: URL;
  headers: Headers;
}

export type FakeHandler = (req: FakeRequest) => Response | Promise<Response>;

/** Routes keyed by `${host}${pathname}`. Unmatched requests reject (a network error). */
export function routedFetch(routes: Record<string, FakeHandler>): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const key = `${url.host}${url.pathname}`;
    calls.push(key);

    const handler = routes[key];
    if (handler === undefined) throw new Error(`unexpected fetch: ${key}`);
    return handler({ url, headers: new Headers(init?.headers) });
  }) as typeof fetch;

  return { fetch: fakeFetch, calls };
}

/** Happy-path routes for every upstream, overridable per test. */
export function happyRoutes(
  overrides: Record<string, FakeHandler> = {},
): Record<string, FakeHandler> {
  return {
    [MOJANG_ROUTE]: () => json(fixtures.mojangProfile),
    [PROFILES_ROUTE]: () => json(fixtures.profilesResponse),
    [GARDEN_ROUTE]: () =>
      json({ success: true, garden: fixtures.gardenResponse }),
    [ELECTION_ROUTE]: () => json(fixtures.electionResponse),
    [ELITEBOT_ROUTE]: () => json(fixtures.contestsElitebot),
    ...overrides,
  };
}

export function makeHarness(
  routes: Record<string, FakeHandler> = happyRoutes(),
  envOverrides: Partial<Env> = {},
) {
  const clock = makeClock();
  const { sleep, sleeps } = makeSleep();
  const net = routedFetch(routes);
  const app = createApp({ fetch: net.fetch, now: clock.now, sleep });
  const env = makeEnv(envOverrides);

  return {
    app,
    env,
    clock,
    net,
    sleeps,
    get: (path: string, headers: Record<string, string> = {}) =>
      app.request(path, { headers }, env),
  };
}

/** A response whose unread body stream records whether it was cancelled. */
export function trackedResponse(
  status: number,
  init: ResponseInit = {},
): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { ...init, status }),
    cancelled: () => cancelled,
  };
}
