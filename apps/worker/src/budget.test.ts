import { describe, expect, it } from "vitest";
import { Budget, countingFetch } from "./budget";

describe("Budget", () => {
  it("tracks spend and what is affordable", () => {
    const b = new Budget(5);
    expect(b.canAfford(5)).toBe(true);
    b.charge(3);
    expect(b.used).toBe(3);
    expect(b.canAfford(2)).toBe(true);
    expect(b.canAfford(3)).toBe(false);
  });
  it("can overspend by charging (the real fetch happened); canAfford is the guard", () => {
    const b = new Budget(1);
    b.charge(4);
    expect(b.used).toBe(4);
    expect(b.canAfford(0)).toBe(false);
  });
});

describe("countingFetch", () => {
  it("charges one per call and passes the call through", async () => {
    const b = new Budget(10);
    const seen: string[] = [];
    const f = countingFetch(
      (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response("ok");
      }) as typeof fetch,
      b,
    );
    await f("https://a.test/");
    await f("https://b.test/");
    expect(b.used).toBe(2);
    expect(seen).toEqual(["https://a.test/", "https://b.test/"]);
  });
  it("counts a call even when it rejects", async () => {
    const b = new Budget(10);
    const f = countingFetch(
      (async () => {
        throw new Error("down");
      }) as typeof fetch,
      b,
    );
    await expect(f("https://a.test/")).rejects.toThrow("down");
    expect(b.used).toBe(1);
  });
});
