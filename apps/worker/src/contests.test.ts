import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ELITEBOT_ROUTE,
  STRASSBURGER_ROUTE,
  fixtures,
  json,
  routedFetch,
  trackedResponse,
  type FakeHandler,
} from "../test/helpers";
import { fetchContests } from "./contests";
import { AppError } from "./errors";

afterEach(() => vi.restoreAllMocks());

const EXPECTED_FIRST = {
  startsAt: 1790812800000,
  crops: ["wheat", "cactus", "pumpkin"],
};

function run(routes: Record<string, FakeHandler>) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const net = routedFetch(routes);
  return { net, result: fetchContests(net.fetch) };
}

const down: FakeHandler = () => new Response("", { status: 500 });
const empty: FakeHandler = () => json({ contests: [] });

describe("fetchContests", () => {
  it("cancels the unread body of a failed source before using the fallback", async () => {
    const failed = trackedResponse(500);
    const { result } = run({
      [ELITEBOT_ROUTE]: () => failed.response,
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsElitebot),
    });

    await result;

    expect(failed.cancelled()).toBe(true);
  });

  it("uses EliteBot when it works and does not call the fallback", async () => {
    const { net, result } = run({
      [ELITEBOT_ROUTE]: () => json(fixtures.contestsElitebot),
    });

    const { contests, source } = await result;

    expect(source.name).toBe("EliteBot");
    expect(contests[0]).toEqual(EXPECTED_FIRST);
    expect(net.calls).toEqual([ELITEBOT_ROUTE]);
  });

  it("falls back to Strassburger when EliteBot fails, and reports that source for the credit link", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: down,
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
    });

    const { contests, source } = await result;

    expect(source.url).toBe("https://jacobs.strassburger.dev");
    expect(contests[0]).toEqual(EXPECTED_FIRST);
  });

  it("falls back when EliteBot throws a network error", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: () => {
        throw new Error("boom");
      },
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
    });

    expect((await result).contests).toHaveLength(2);
  });

  it("prefers a non-empty fallback over an empty primary", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: empty,
      [STRASSBURGER_ROUTE]: () => json(fixtures.contestsStrassburger),
    });

    expect((await result).source.name).not.toBe("EliteBot");
  });

  it("returns an empty list (primary source) when one source is empty and the other fails", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: empty,
      [STRASSBURGER_ROUTE]: down,
    });

    expect(await result).toEqual({
      contests: [],
      source: { name: "EliteBot", url: "https://elitebot.dev" },
    });
  });

  it("throws upstream_down when both sources fail", async () => {
    const { result } = run({
      [ELITEBOT_ROUTE]: down,
      [STRASSBURGER_ROUTE]: down,
    });

    const err = await result.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("upstream_down");
  });
});
