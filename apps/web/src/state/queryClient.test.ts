import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { shouldRetry } from "./queryClient";

describe("shouldRetry", () => {
  it("never retries rate_limited or other 4xx", () => {
    expect(shouldRetry(0, new ApiError("rate_limited", 429, "x", 10))).toBe(
      false,
    );
    expect(shouldRetry(0, new ApiError("unknown_player", 404, "x"))).toBe(
      false,
    );
    expect(shouldRetry(0, new ApiError("bad_request", 400, "x"))).toBe(false);
  });

  it("retries 5xx and network errors once", () => {
    expect(shouldRetry(0, new ApiError("upstream_down", 502, "x"))).toBe(true);
    expect(shouldRetry(1, new ApiError("upstream_down", 502, "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError("network", 0, "x"))).toBe(true);
  });
});
