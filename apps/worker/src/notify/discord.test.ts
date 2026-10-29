import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertEmbed,
  isDiscordWebhookUrl,
  sendDiscord,
  TEST_EMBED,
  webhookLast4,
} from "./discord";

const HOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123";

function fakeFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (res instanceof Error) throw res;
    return res;
  }) as typeof fetch;
  return { fn, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("isDiscordWebhookUrl", () => {
  it.each([HOOK, HOOK.replace("discord.com", "discordapp.com")])(
    "accepts %s",
    (url) => {
      expect(isDiscordWebhookUrl(url)).toBe(true);
    },
  );
  it.each([
    "http://discord.com/api/webhooks/1/abc",
    "https://discord.com.evil.com/api/webhooks/1/abc",
    "https://evil.com/api/webhooks/1/abc",
    "https://discord.com/api/webhooks/abc/def",
    `${HOOK}?wait=true`,
    `${HOOK}/extra`,
    "https://discord.com@evil.com/api/webhooks/1/abc",
    "",
    42,
    null,
  ])("rejects %s", (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(false);
  });
});

describe("webhookLast4", () => {
  it("returns the last 4 characters of the token", () => {
    expect(webhookLast4(HOOK)).toBe("-123");
  });
});

describe("alertEmbed", () => {
  it("carries the title, detail and how stale the data is", () => {
    const e = alertEmbed(
      { type: "contest_soon", key: "k", title: "T", detail: "D", dueAt: null },
      1_000_000,
      1_000_000 + 3 * 60_000,
    );
    expect(e).toEqual({
      title: "T",
      description: "D",
      footer: { text: "Last synced 3 min ago · Garden HQ" },
    });
  });
});

describe("sendDiscord", () => {
  it("posts one embed that can never ping, without following redirects", async () => {
    const { fn, calls } = fakeFetch(new Response(null, { status: 204 }));
    expect(await sendDiscord(fn, HOOK, TEST_EMBED)).toEqual({ kind: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HOOK);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      embeds: [TEST_EMBED],
      allowed_mentions: { parse: [] },
    });
  });
  it("a redirect is rejected, never followed", async () => {
    const { fn, calls } = fakeFetch(
      new Response(null, {
        status: 301,
        headers: { Location: "https://evil.com/x" },
      }),
    );
    expect(await sendDiscord(fn, HOOK, TEST_EMBED)).toEqual({
      kind: "rejected",
      status: 301,
    });
    expect(calls).toHaveLength(1);
  });
  it("Retry-After: 0 and body retry_after: 0 both give 0", async () => {
    const header = fakeFetch(
      new Response("{}", { status: 429, headers: { "Retry-After": "0" } }),
    );
    expect(await sendDiscord(header.fn, HOOK, TEST_EMBED)).toEqual({
      kind: "retry",
      retryAfterSeconds: 0,
    });
    const body = fakeFetch(
      new Response(JSON.stringify({ retry_after: 0 }), { status: 429 }),
    );
    expect(await sendDiscord(body.fn, HOOK, TEST_EMBED)).toEqual({
      kind: "retry",
      retryAfterSeconds: 0,
    });
  });
  it("never calls out for a URL that is not a Discord webhook", async () => {
    const { fn, calls } = fakeFetch(new Response(null, { status: 204 }));
    expect(await sendDiscord(fn, "https://evil.com/x", TEST_EMBED)).toEqual({
      kind: "dead",
    });
    expect(calls).toHaveLength(0);
  });
  it("429 asks to retry, honouring retry_after from the body or the header", async () => {
    const body = fakeFetch(
      new Response(JSON.stringify({ retry_after: 1.2 }), { status: 429 }),
    );
    expect(await sendDiscord(body.fn, HOOK, TEST_EMBED)).toEqual({
      kind: "retry",
      retryAfterSeconds: 2,
    });
    const header = fakeFetch(
      new Response("{}", { status: 429, headers: { "Retry-After": "7" } }),
    );
    expect(await sendDiscord(header.fn, HOOK, TEST_EMBED)).toEqual({
      kind: "retry",
      retryAfterSeconds: 7,
    });
    const neither = fakeFetch(new Response("nope", { status: 429 }));
    expect(await sendDiscord(neither.fn, HOOK, TEST_EMBED)).toEqual({
      kind: "retry",
      retryAfterSeconds: null,
    });
  });
  it("5xx and network errors are retryable", async () => {
    expect(
      await sendDiscord(
        fakeFetch(new Response(null, { status: 503 })).fn,
        HOOK,
        TEST_EMBED,
      ),
    ).toEqual({ kind: "retry", retryAfterSeconds: null });
    expect(
      await sendDiscord(fakeFetch(new Error("down")).fn, HOOK, TEST_EMBED),
    ).toEqual({
      kind: "retry",
      retryAfterSeconds: null,
    });
  });
  it("404 and 401 mean the webhook is gone", async () => {
    expect(
      await sendDiscord(
        fakeFetch(new Response(null, { status: 404 })).fn,
        HOOK,
        TEST_EMBED,
      ),
    ).toEqual({ kind: "dead" });
    expect(
      await sendDiscord(
        fakeFetch(new Response(null, { status: 401 })).fn,
        HOOK,
        TEST_EMBED,
      ),
    ).toEqual({ kind: "dead" });
  });
  it("another 4xx is rejected, not retried", async () => {
    expect(
      await sendDiscord(
        fakeFetch(new Response(null, { status: 400 })).fn,
        HOOK,
        TEST_EMBED,
      ),
    ).toEqual({ kind: "rejected", status: 400 });
  });
  it("never logs the webhook URL or token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sendDiscord(
      fakeFetch(new Response(null, { status: 500 })).fn,
      HOOK,
      TEST_EMBED,
    );
    await sendDiscord(fakeFetch(new Error("boom")).fn, HOOK, TEST_EMBED);
    const all = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(all).not.toContain("abcDEF_ghi-123");
    expect(all).not.toContain("123456789012345678");
  });
});
