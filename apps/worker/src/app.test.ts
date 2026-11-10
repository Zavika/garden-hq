import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_KEY, makeEnv, makeHarness } from "../test/helpers";
import { createApp } from "./app";
import { DEV_ORIGIN } from "./cors";

afterEach(() => vi.restoreAllMocks());

describe("GET /health", () => {
  it("returns ok status and the core ping", async () => {
    const res = await createApp().request("/health", {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      core: "garden-hq core is alive",
    });
  });
});

describe("CORS", () => {
  // /api/__cors-probe has no route, so these exercise middleware only.
  const probe = (origin: string, env = makeEnv()) =>
    createApp().request(
      "/api/__cors-probe",
      { headers: { Origin: origin } },
      env,
    );

  it("allows the configured web origin", async () => {
    const res = await probe("https://app.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
  });

  it("does not allow other origins", async () => {
    const res = await probe("https://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows localhost only when ENVIRONMENT=dev", async () => {
    const prod = await probe(DEV_ORIGIN);
    expect(prod.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const dev = await probe(DEV_ORIGIN, makeEnv({ ENVIRONMENT: "dev" }));
    expect(dev.headers.get("Access-Control-Allow-Origin")).toBe(DEV_ORIGIN);
  });

  it("answers preflight for writes and allows the Authorization header", async () => {
    const preflight = (origin: string) =>
      createApp().request(
        "/api/sync",
        {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
          },
        },
        makeEnv(),
      );

    const ok = await preflight("https://app.example");
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
    expect(
      ok.headers.get("Access-Control-Allow-Headers")?.toLowerCase(),
    ).toContain("authorization");
    expect(ok.headers.get("Access-Control-Allow-Methods")).toContain("POST");

    const bad = await preflight("https://evil.example");
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers preflight with the allowed methods and no credentials", async () => {
    const res = await createApp().request(
      "/api/link",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      makeEnv(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,POST,PUT,DELETE,OPTIONS",
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not grant a disallowed origin on preflight", async () => {
    const res = await createApp().request(
      "/api/link",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      makeEnv(),
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("not found", () => {
  const body = { error: { code: "not_found", message: "Unknown route" } };

  it.each(["/api/nope", "/api/link/", "/nope", "/api/garden/x/y"])(
    "returns the uniform JSON 404 for %s",
    async (path) => {
      const res = await createApp().request(path, {}, makeEnv());

      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual(body);
    },
  );

  it("keeps CORS headers for an allowed origin", async () => {
    const res = await createApp().request(
      "/api/nope",
      { headers: { Origin: "https://app.example" } },
      makeEnv(),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
  });
});

describe("error handling", () => {
  it("never logs or returns the API key when an unexpected error occurs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingKv = {
      get: async () => {
        throw new Error(`kv down ${TEST_KEY}`);
      },
      put: async () => {},
    } as unknown as KVNamespace;

    const app = createApp();
    // Force an unexpected (non-AppError) throw through the app's onError.
    app.get("/api/boom", async (c) => {
      await c.env.CACHE.get("x");
      return c.text("unreachable");
    });
    const res = await app.request(
      "/api/boom",
      { headers: { Origin: "https://app.example" } },
      makeEnv({ CACHE: throwingKv }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Internal error" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );

    const everything = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .join("\n");
    expect(everything).toContain("[redacted]");
    expect(everything).not.toContain(TEST_KEY);
  });
});

describe("error handling webhook redaction", () => {
  it("never logs a Discord webhook URL from an error message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp();
    app.get("/api/boom", () => {
      throw new Error(
        "D1 failed: https://discord.com/api/webhooks/123/abc-def end",
      );
    });
    const res = await app.request("/api/boom", {}, makeEnv());
    expect(res.status).toBe(500);
    const everything = error.mock.calls.flat().join(" ");
    expect(everything).toContain("[redacted]");
    expect(everything).not.toContain("abc-def");
  });
});

describe("error handling without bindings", () => {
  it("still returns the 500 internal body when no env is bound", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp();
    app.get("/api/boom", () => {
      throw new Error("kaboom");
    });

    const res = await app.request("/api/boom", {
      headers: { Origin: "https://app.example" },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Internal error" },
    });
  });
});

describe("harness wiring", () => {
  it("makeHarness builds an app that serves /health", async () => {
    const { get } = makeHarness();
    expect((await get("/health")).status).toBe(200);
  });
});
