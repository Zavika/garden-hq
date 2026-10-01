import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fixtures,
  json,
  routedFetch,
  trackedResponse,
  type FakeHandler,
} from "../test/helpers";
import { AppError } from "./errors";
import { lookupUuid } from "./mojang";

afterEach(() => vi.restoreAllMocks());

const ROUTE = "api.mojang.com/users/profiles/minecraft/TestFarmer";

async function lookup(handler: FakeHandler) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return lookupUuid(routedFetch({ [ROUTE]: handler }).fetch, "TestFarmer");
}

async function code(handler: FakeHandler): Promise<string | undefined> {
  const err = await lookup(handler).then(
    () => undefined,
    (e: unknown) => e,
  );
  return err instanceof AppError ? err.code : undefined;
}

describe("lookupUuid", () => {
  it("returns the dashed UUID and canonical name", async () => {
    expect(await lookup(() => json(fixtures.mojangProfile))).toEqual({
      uuid: "11111111-1111-1111-1111-111111111111",
      name: "TestFarmer",
    });
  });

  it.each([404, 429, 500])(
    "cancels the unread body of a %i",
    async (status) => {
      const tracked = trackedResponse(status);

      await code(() => tracked.response);

      expect(tracked.cancelled()).toBe(true);
    },
  );

  it("maps 404 and 204 to unknown_player", async () => {
    expect(await code(() => new Response("", { status: 404 }))).toBe(
      "unknown_player",
    );
    expect(await code(() => new Response(null, { status: 204 }))).toBe(
      "unknown_player",
    );
  });

  it("maps 429 to rate_limited", async () => {
    expect(await code(() => new Response("", { status: 429 }))).toBe(
      "rate_limited",
    );
  });

  it("maps 5xx, network errors and malformed bodies to upstream_down", async () => {
    expect(await code(() => new Response("", { status: 500 }))).toBe(
      "upstream_down",
    );
    expect(
      await code(() => {
        throw new Error("boom");
      }),
    ).toBe("upstream_down");
    expect(await code(() => json({ id: "nope" }))).toBe("upstream_down");
  });
});
