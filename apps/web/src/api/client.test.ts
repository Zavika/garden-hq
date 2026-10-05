import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function clientWith(response: Response | Error) {
  const fetchFn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  return { fetchFn, client: createApiClient(fetchFn, "http://api.test") };
}

describe("api client", () => {
  it("GETs /api/link with the encoded name and returns the body", async () => {
    const body = {
      uuid: "u",
      name: "Steve",
      profileId: "p",
      profiles: [],
      fetchedAt: "2026-10-05T10:00:00.000Z",
    };
    const { client, fetchFn } = clientWith(jsonResponse(body));
    await expect(client.link("Steve 1")).resolves.toEqual(body);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit?,
    ];
    expect(url).toBe("http://api.test/api/link?name=Steve+1");
    expect(init?.credentials).toBeUndefined();
  });

  it("GETs /api/garden, /api/contests and /api/mayor", async () => {
    const { client, fetchFn } = clientWith(jsonResponse({ ok: 1 }));
    await client.garden("abc");
    await client.contests();
    await client.mayor();
    const urls = fetchFn.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      "http://api.test/api/garden?profile=abc",
      "http://api.test/api/contests",
      "http://api.test/api/mayor",
    ]);
  });

  it.each([
    ["bad_request", 400],
    ["unknown_player", 404],
    ["no_garden", 404],
    ["not_found", 404],
    ["missing_api_key", 500],
    ["internal", 500],
    ["upstream_down", 502],
  ] as const)("maps a %s error body (HTTP %i)", async (code, status) => {
    const { client } = clientWith(
      jsonResponse({ error: { code, message: "boom" } }, { status }),
    );
    const err = await client.mayor().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code, status, retryAfter: undefined });
  });

  it("maps rate_limited with retryAfter from the body", async () => {
    const { client } = clientWith(
      jsonResponse(
        {
          error: { code: "rate_limited", message: "slow down", retryAfter: 12 },
        },
        { status: 429 },
      ),
    );
    await expect(client.mayor()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfter: 12,
    });
  });

  it("falls back to the Retry-After header", async () => {
    const { client } = clientWith(
      jsonResponse(
        { error: { code: "rate_limited", message: "x" } },
        { status: 429, headers: { "Retry-After": "30" } },
      ),
    );
    await expect(client.mayor()).rejects.toMatchObject({ retryAfter: 30 });
  });

  it("maps a non-JSON error to a code derived from the status", async () => {
    const { client } = clientWith(new Response("oops", { status: 502 }));
    await expect(client.mayor()).rejects.toMatchObject({
      code: "upstream_down",
      status: 502,
    });
  });

  it("maps a network failure to code 'network' with status 0", async () => {
    const { client } = clientWith(new TypeError("Failed to fetch"));
    await expect(client.mayor()).rejects.toMatchObject({
      code: "network",
      status: 0,
    });
  });

  it("maps a 200 with a non-object body to 'bad_response'", async () => {
    const { client } = clientWith(jsonResponse("hello"));
    await expect(client.mayor()).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});
