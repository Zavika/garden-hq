import type { ApiErrorCode } from "@garden-hq/core";

export type ErrorCode = ApiErrorCode;

type ErrorStatus = 400 | 404 | 429 | 500 | 502;

const STATUS: Record<ErrorCode, ErrorStatus> = {
  bad_request: 400,
  unknown_player: 404,
  no_garden: 404,
  not_found: 404,
  rate_limited: 429,
  missing_api_key: 500,
  bad_api_key: 500,
  internal: 500,
  upstream_down: 502,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter: number | undefined;

  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryAfter = retryAfter;
  }

  get status(): ErrorStatus {
    return STATUS[this.code];
  }
}

export function errorBody(err: AppError): {
  error: { code: ErrorCode; message: string; retryAfter?: number };
} {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
    },
  };
}
