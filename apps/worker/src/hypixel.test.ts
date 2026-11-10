import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEST_KEY,
  json,
  makeClock,
  makeSleep,
  routedFetch,
  trackedResponse,
  type FakeHandler,
} from "../test/helpers";
import { AppError } from "./errors";
import { createHypixelClient, createRateLimitState } from "./hypixel";

afterEach(() => vi.restoreAllMocks());

const GARDEN = "api.hypixel.net/v2/skyblock/garden";

function setup(
  handler: FakeHandler,
  options: { apiKey?: string | undefined } = {},
) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const clock = makeClock();
  const { sleep, sleeps } = makeSleep();
  const net = routedFetch({ [GARDEN]: handler });
  const client = createHypixelClient({
    fetch: net.fetch,
    apiKey: "apiKey" in options ? options.apiKey : TEST_KEY,
    now: clock.now,
    sleep,
    state: createRateLimitState(),
  });
  return { client, net, clock, sleeps };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe("createHypixelClient", () => {
  it("sends the key in the API-Key header and returns the parsed body", async () => {
    let seen: string | null = null;
    const { client } = setup(({ headers, url }) => {
      seen = headers.get("API-Key");
      expect(url.searchParams.get("profile")).toBe("p1");
      expect(url.toString()).not.toContain(TEST_KEY);
      return json({ success: true });
    });

    expect(await client.garden("p1")).toEqual({ success: true });
    expect(seen).toBe(TEST_KEY);
  });

  it("throws missing_api_key without fetching when there is no key", async () => {
    const { client, net } = setup(() => json({}), { apiKey: undefined });

    expect((await failure(client.garden("p1"))).code).toBe("missing_api_key");
    expect((await failure(client.profiles("u1"))).code).toBe("missing_api_key");
    expect(net.calls).toEqual([]);
  });

  it("calls election without any key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let seen: string | null = "unset";
    const net = routedFetch({
      "api.hypixel.net/v2/resources/skyblock/election": ({ headers }) => {
        seen = headers.get("API-Key");
        return json({ success: true });
      },
    });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: undefined,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    expect(await client.election()).toEqual({ success: true });
    expect(seen).toBeNull();
  });

  it("returns the raw bazaar body as text, without a key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const raw = '{"success":true,"products":{}}';
    let seen: string | null = "unset";
    const net = routedFetch({
      "api.hypixel.net/v2/skyblock/bazaar": ({ headers }) => {
        seen = headers.get("API-Key");
        return new Response(raw);
      },
    });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: undefined,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    expect(await client.bazaar()).toBe(raw);
    expect(seen).toBeNull();
  });

  it("maps a bazaar 404 to upstream_down", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const net = routedFetch({
      "api.hypixel.net/v2/skyblock/bazaar": () =>
        new Response("nope", { status: 404 }),
    });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: undefined,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    expect((await failure(client.bazaar())).code).toBe("upstream_down");
  });

  it("returns null on 404", async () => {
    const { client } = setup(() => new Response("nope", { status: 404 }));
    expect(await client.garden("p1")).toBeNull();
  });

  it("retries a 429 after Retry-After seconds, then succeeds", async () => {
    let n = 0;
    const { client, sleeps } = setup(() =>
      n++ === 0
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : json({ ok: true }),
    );

    expect(await client.garden("p1")).toEqual({ ok: true });
    expect(sleeps).toEqual([2000]);
  });

  it("gives up on a persistent 429 with rate_limited + retryAfter (3 attempts)", async () => {
    const { client, net, sleeps } = setup(
      () => new Response("", { status: 429, headers: { "Retry-After": "1" } }),
    );

    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(1);
    expect(net.calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("does not wait when Retry-After exceeds the 5 s cap", async () => {
    const { client, net, sleeps } = setup(
      () => new Response("", { status: 429, headers: { "Retry-After": "30" } }),
    );

    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(30);
    expect(net.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("backs off 250 ms then 500 ms on 5xx and recovers", async () => {
    let n = 0;
    const { client, sleeps } = setup(() =>
      n++ < 2 ? new Response("", { status: 503 }) : json({ ok: true }),
    );

    expect(await client.garden("p1")).toEqual({ ok: true });
    expect(sleeps).toEqual([250, 500]);
  });

  it("maps a persistent 5xx to upstream_down", async () => {
    const { client, net } = setup(() => new Response("", { status: 500 }));

    expect((await failure(client.garden("p1"))).code).toBe("upstream_down");
    expect(net.calls).toHaveLength(3);
  });

  it("trims whitespace and newlines from the API key before sending it", async () => {
    let sent: string | null = null;
    const { client } = setup(
      (req) => {
        sent = req.headers.get("API-Key");
        return json({ success: true });
      },
      { apiKey: `${TEST_KEY}\r\n` },
    );

    await client.garden("p1");

    expect(sent).toBe(TEST_KEY);
  });

  it("treats a whitespace-only API key as missing", async () => {
    const { client, net } = setup(() => json({}), {
      apiKey: " \r\n",
    });

    expect((await failure(client.garden("p1"))).code).toBe("missing_api_key");
    expect(net.calls).toHaveLength(0);
  });

  it("maps 403 to bad_api_key with no retry and logs Hypixel's cause", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, net } = setup(() =>
      json({ success: false, cause: "Invalid API key" }, { status: 403 }),
    );

    expect((await failure(client.garden("p1"))).code).toBe("bad_api_key");
    expect(net.calls).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: "hypixel_forbidden", cause: "Invalid API key" }),
    );
  });

  it("maps 401 to bad_api_key with no retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, net } = setup(() =>
      json({ success: false, cause: "Invalid API key" }, { status: 401 }),
    );
    expect((await failure(client.garden("p1"))).code).toBe("bad_api_key");
    expect(net.calls).toHaveLength(1);
  });

  it("still returns bad_api_key for an unreadable 403 body, and never logs the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = setup(
      () => new Response(`denied ${TEST_KEY}`, { status: 403 }),
    );

    expect((await failure(client.garden("p1"))).code).toBe("bad_api_key");
    const logged = String(error.mock.calls[0]?.[0]);
    expect(logged).toContain("unreadable");
    expect(logged).not.toContain(TEST_KEY);
  });

  it("maps invalid JSON to upstream_down", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));
    expect((await failure(client.garden("p1"))).code).toBe("upstream_down");
  });

  it("retries network errors and never leaks the key in the error", async () => {
    const { client, net } = setup(() => {
      throw new Error(`connect failed ${TEST_KEY}`);
    });

    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("upstream_down");
    expect(err.message).not.toContain(TEST_KEY);
    expect(net.calls).toHaveLength(3);
  });

  it("short-circuits when RateLimit-Remaining is 0 until RateLimit-Reset elapses", async () => {
    let n = 0;
    const { client, net, clock } = setup(() => {
      n++;
      return json(
        { ok: true },
        { headers: { "RateLimit-Remaining": "0", "RateLimit-Reset": "30" } },
      );
    });

    await client.garden("p1");
    const err = await failure(client.garden("p1"));

    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBe(30);
    expect(net.calls).toHaveLength(1);

    clock.advance(31_000);
    await client.garden("p1");
    expect(n).toBe(2);
  });

  it("does not block keyless election calls with the key's exhausted quota", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const net = routedFetch({
      [GARDEN]: () =>
        json(
          { ok: true },
          { headers: { "RateLimit-Remaining": "0", "RateLimit-Reset": "30" } },
        ),
      "api.hypixel.net/v2/resources/skyblock/election": () =>
        json({ success: true }),
    });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: TEST_KEY,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    await client.garden("p1");

    expect((await failure(client.garden("p1"))).code).toBe("rate_limited");
    expect(await client.election()).toEqual({ success: true });
  });

  it("cancels the unread body of a failed attempt before retrying", async () => {
    const first = trackedResponse(500);
    let n = 0;
    const { client } = setup(() => (n++ === 0 ? first.response : json({})));

    await client.garden("p1");

    expect(first.cancelled()).toBe(true);
  });

  it.each([429, 404])(
    "cancels the unread body of a %i response",
    async (status) => {
      const tracked = trackedResponse(status, {
        headers: { "Retry-After": "60" },
      });
      const { client } = setup(() => tracked.response);

      await client.garden("p1").catch(() => undefined);

      expect(tracked.cancelled()).toBe(true);
    },
  );

  it("is unaffected when cancelling the body fails", async () => {
    const response = new Response("", { status: 500 });
    Object.defineProperty(response, "body", {
      value: {
        cancel: () => {
          throw new Error("cancel blew up");
        },
      },
    });
    let n = 0;
    const { client } = setup(() => (n++ === 0 ? response : json({ ok: 1 })));

    expect(await client.garden("p1")).toEqual({ ok: 1 });
  });

  it("logs host + path template + status only", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const net = routedFetch({ [GARDEN]: () => json({}) });
    const client = createHypixelClient({
      fetch: net.fetch,
      apiKey: TEST_KEY,
      now: makeClock().now,
      sleep: makeSleep().sleep,
      state: createRateLimitState(),
    });

    await client.garden("p1");

    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "upstream",
      host: "api.hypixel.net",
      path: "/v2/skyblock/garden",
      status: 200,
    });
    expect(line).not.toContain(TEST_KEY);
    expect(line).not.toContain("p1");
  });
});
