import { describe, expect, it } from "vitest";
import { pingCore } from "./index";

describe("pingCore", () => {
  it("returns a confirmation string", () => {
    expect(pingCore()).toBe("garden-hq core is alive");
  });
});
