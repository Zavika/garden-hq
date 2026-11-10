import { describe, expect, it } from "vitest";
import { isPrecachedNavigation } from "./swLogic";

const ORIGIN = "https://garden.example";
const u = (path: string, origin = ORIGIN) => new URL(path, origin);

describe("isPrecachedNavigation", () => {
  it.each(["/", "/settings", "/privacy", "/greenhouse/"])(
    "accepts SPA route %s",
    (p) => {
      expect(isPrecachedNavigation(u(p), ORIGIN)).toBe(true);
    },
  );
  it.each(["/api/sync", "/api/", "/api"])("rejects %s", (p) => {
    expect(isPrecachedNavigation(u(p), ORIGIN)).toBe(false);
  });
  it.each(["/sprites/soil.png", "/manifest.webmanifest", "/sw.js"])(
    "rejects file path %s",
    (p) => {
      expect(isPrecachedNavigation(u(p), ORIGIN)).toBe(false);
    },
  );
  it.each([
    ["/settings?x=1.2", true],
    ["/a.b/c", true],
    ["/index.html", false],
    ["/privacy.html", false],
  ])("handles %s -> %s", (p, expected) => {
    expect(isPrecachedNavigation(u(p), ORIGIN)).toBe(expected);
  });
  it("rejects another origin", () => {
    expect(isPrecachedNavigation(u("/", "https://other.example"), ORIGIN)).toBe(
      false,
    );
  });
});
