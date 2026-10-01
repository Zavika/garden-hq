import { describe, expect, it } from "vitest";
import { AppError, errorBody, type ErrorCode } from "./errors";

describe("AppError", () => {
  const cases: [ErrorCode, number][] = [
    ["bad_request", 400],
    ["unknown_player", 404],
    ["no_garden", 404],
    ["rate_limited", 429],
    ["missing_api_key", 500],
    ["internal", 500],
    ["upstream_down", 502],
  ];

  it.each(cases)("maps %s to HTTP %i", (code, status) => {
    expect(new AppError(code, "msg").status).toBe(status);
  });

  it("builds the uniform error body, including retryAfter when set", () => {
    expect(errorBody(new AppError("bad_request", "nope"))).toEqual({
      error: { code: "bad_request", message: "nope" },
    });
    expect(errorBody(new AppError("rate_limited", "slow down", 12))).toEqual({
      error: { code: "rate_limited", message: "slow down", retryAfter: 12 },
    });
  });
});
