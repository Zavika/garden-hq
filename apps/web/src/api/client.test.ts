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
    ["bad_api_key", 500],
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

  it("GETs /api/member with profile and uuid", async () => {
    const body = {
      member: {
        discoveredMutations: ["dustgrain"],
        analyzedMutations: [],
        chips: { cropshot: 5 },
        hasGreenhouse: true,
      },
      fetchedAt: "2026-10-06T10:00:00.000Z",
    };
    const { client, fetchFn } = clientWith(jsonResponse(body));
    await expect(client.member("p1", "u1")).resolves.toEqual(body);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://api.test/api/member?profile=p1&uuid=u1",
    );
  });
  describe("sync endpoints", () => {
    const CODE = "abcdefghjkmnpqrstuvwxyz234567892";
    const state = {
      link: null,
      assignments: {},
      greenhouses: {},
      timeZone: "Europe/Warsaw",
      revision: 3,
    };
    const callOf = (fetchFn: ReturnType<typeof vi.fn>, i = 0) =>
      fetchFn.mock.calls[i] as unknown as [string, RequestInit];

    it("getSync sends the bearer code and If-None-Match, returns state and ETag", async () => {
      const { client, fetchFn } = clientWith(
        jsonResponse(state, { headers: { ETag: '"r3"' } }),
      );
      await expect(client.getSync(CODE, '"r2"')).resolves.toEqual({
        state,
        etag: '"r3"',
      });
      const [url, init] = callOf(fetchFn);
      expect(url).toBe("http://api.test/api/sync");
      expect(url).not.toContain(CODE);
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${CODE}`);
      expect(headers.get("If-None-Match")).toBe('"r2"');
      expect(init.method).toBe("GET");
    });

    it("getSync omits If-None-Match without an etag", async () => {
      const { client, fetchFn } = clientWith(
        jsonResponse(state, { headers: { ETag: '"r3"' } }),
      );
      await client.getSync(CODE, null);
      expect(new Headers(callOf(fetchFn)[1].headers).has("If-None-Match")).toBe(
        false,
      );
    });

    it("getSync returns null on 304 without parsing a body", async () => {
      const { client } = clientWith(new Response(null, { status: 304 }));
      await expect(client.getSync(CODE, '"r3"')).resolves.toBeNull();
    });

    it("getSync maps 401 to unauthorized", async () => {
      const { client } = clientWith(
        jsonResponse(
          { error: { code: "unauthorized", message: "no" } },
          { status: 401 },
        ),
      );
      await expect(client.getSync(CODE, null)).rejects.toMatchObject({
        code: "unauthorized",
        status: 401,
      });
    });

    it("maps a bare 401 to unauthorized", async () => {
      const { client } = clientWith(new Response("x", { status: 401 }));
      await expect(client.getSync(CODE, null)).rejects.toMatchObject({
        code: "unauthorized",
      });
    });

    it("postSync sends JSON { ops } with the bearer code", async () => {
      const { client, fetchFn } = clientWith(
        jsonResponse(state, { headers: { ETag: '"r4"' } }),
      );
      const ops = [{ t: "setTimeZone", timeZone: "UTC" }] as const;
      await expect(client.postSync(CODE, [...ops])).resolves.toEqual({
        state,
        etag: '"r4"',
      });
      const [url, init] = callOf(fetchFn);
      expect(url).toBe("http://api.test/api/sync");
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Authorization")).toBe(`Bearer ${CODE}`);
      expect(JSON.parse(init.body as string)).toEqual({ ops });
    });

    it("createAccount POSTs { link } without Authorization", async () => {
      const { client, fetchFn } = clientWith(
        jsonResponse({ syncCode: CODE }, { status: 201 }),
      );
      const link = { name: "Steve", uuid: "u", profileId: "p", profiles: [] };
      await expect(client.createAccount(link)).resolves.toEqual({
        syncCode: CODE,
      });
      const [url, init] = callOf(fetchFn);
      expect(url).toBe("http://api.test/api/account");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).has("Authorization")).toBe(false);
      expect(JSON.parse(init.body as string)).toEqual({ link });
    });

    it("deleteAccount accepts 204", async () => {
      const { client, fetchFn } = clientWith(
        new Response(null, { status: 204 }),
      );
      await expect(client.deleteAccount(CODE)).resolves.toBeUndefined();
      const [url, init] = callOf(fetchFn);
      expect(url).toBe("http://api.test/api/account");
      expect(url).not.toContain(CODE);
      expect(init.method).toBe("DELETE");
    });

    it("a hung request is aborted and mapped to a network error", async () => {
      const fetchFn = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const client = createApiClient(
        fetchFn as unknown as typeof fetch,
        "http://api.test",
        10,
      );
      await expect(client.postSync(CODE, [])).rejects.toMatchObject({
        code: "network",
        status: 0,
      });
    });

    it("postSync without an ETag header is a bad_response", async () => {
      const { client } = clientWith(jsonResponse(state));
      await expect(client.postSync(CODE, [])).rejects.toMatchObject({
        code: "bad_response",
      });
    });
  });
});

describe("alerts client", () => {
  it("sends the sync code as a bearer token and the right verbs", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          hasWebhook: false,
          webhookLast4: null,
          webhookOk: null,
          rules: null,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const c = createApiClient(fetchFn, "https://api.test");

    await c.getAlerts("CODE");
    await c.putWebhook("CODE", "https://discord.com/api/webhooks/1/a");
    await c.testWebhook("CODE");
    await c.putRules("CODE", { contest_soon: { enabled: false } });

    expect(calls.map((x) => [x.init?.method, x.url])).toEqual([
      ["GET", "https://api.test/api/alerts"],
      ["PUT", "https://api.test/api/alerts/webhook"],
      ["POST", "https://api.test/api/alerts/test"],
      ["PUT", "https://api.test/api/alerts/rules"],
    ]);
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer CODE",
      );
    }
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      url: "https://discord.com/api/webhooks/1/a",
    });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      rules: { contest_soon: { enabled: false } },
    });
  });

  it("deleteWebhook accepts a 204", async () => {
    const c = createApiClient(
      (async () => new Response(null, { status: 204 })) as typeof fetch,
      "https://api.test",
    );
    await expect(c.deleteWebhook("CODE")).resolves.toBeUndefined();
  });
});
