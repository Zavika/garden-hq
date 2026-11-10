import { describe, expect, it } from "vitest";
import {
  notificationOptions,
  parsePushPayload,
  pickClientToFocus,
} from "./swPush";

describe("parsePushPayload", () => {
  it("reads a well-formed payload", () => {
    expect(
      parsePushPayload({ title: "T", body: "B", tag: "x", url: "/contests" }),
    ).toEqual({ title: "T", body: "B", tag: "x", url: "/contests" });
  });

  it.each([null, undefined, "text", 42, [], [1, 2]])(
    "falls back to safe defaults for %j",
    (garbage) => {
      expect(parsePushPayload(garbage)).toEqual({
        title: "Garden HQ",
        body: "",
        tag: "garden-hq",
        url: "/",
      });
    },
  );

  it("ignores non-string fields", () => {
    const p = parsePushPayload({ title: 5, body: {}, tag: null, url: 1 });
    expect(p.title).toBe("Garden HQ");
    expect(p.body).toBe("");
    expect(p.url).toBe("/");
  });

  it("truncates huge title and body", () => {
    const p = parsePushPayload({
      title: "a".repeat(500),
      body: "b".repeat(900),
    });
    expect(p.title).toHaveLength(120);
    expect(p.body).toHaveLength(300);
  });

  it("uses the default title for an empty title", () => {
    expect(parsePushPayload({ title: "" }).title).toBe("Garden HQ");
  });
});

describe("notificationOptions", () => {
  it("has icon, badge, tag and the target url", () => {
    const opts = notificationOptions({
      title: "T",
      body: "B",
      tag: "tg",
      url: "/x",
    });
    expect(opts).toEqual({
      body: "B",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "tg",
      data: { url: "/x" },
    });
  });
});

describe("pickClientToFocus", () => {
  const target = "https://garden.example/";
  it("prefers a focused same-origin client", () => {
    expect(
      pickClientToFocus(
        [
          { url: "https://garden.example/a" },
          { url: "https://garden.example/b", focused: true },
        ],
        target,
      ),
    ).toBe(1);
  });
  it("falls back to the first same-origin client", () => {
    expect(
      pickClientToFocus(
        [
          { url: "https://other.example/", focused: true },
          { url: "https://garden.example/a" },
        ],
        target,
      ),
    ).toBe(1);
  });
  it("returns null when none match or urls are invalid", () => {
    expect(pickClientToFocus([], target)).toBeNull();
    expect(
      pickClientToFocus(
        [{ url: "https://other.example/" }, { url: "x" }],
        target,
      ),
    ).toBeNull();
  });
});
