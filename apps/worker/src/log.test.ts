import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logUpstream, redact, redactWebhooks } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("replaces every occurrence of the secret", () => {
    expect(redact("a SECRET b SECRET", "SECRET")).toBe(
      "a [redacted] b [redacted]",
    );
  });

  it("leaves text alone when there is no secret", () => {
    expect(redact("hello", undefined)).toBe("hello");
    expect(redact("hello", "")).toBe("hello");
  });
});

describe("redactWebhooks", () => {
  it("replaces every webhook URL", () => {
    expect(
      redactWebhooks(
        "a https://discord.com/api/webhooks/1/x-y b https://discordapp.com/api/webhooks/2/z",
      ),
    ).toBe("a [redacted] b [redacted]");
  });
});

describe("logging", () => {
  it("logUpstream writes one JSON line with host, path template, status, ms", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logUpstream({
      host: "api.hypixel.net",
      path: "/v2/skyblock/garden",
      status: 200,
      ms: 12,
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({
      event: "upstream",
      host: "api.hypixel.net",
      path: "/v2/skyblock/garden",
      status: 200,
      ms: 12,
    });
  });

  it("logError writes a JSON line to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("unhandled", { name: "Error" });
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({
      event: "unhandled",
      name: "Error",
    });
  });
});
