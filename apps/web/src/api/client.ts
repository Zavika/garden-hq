import type {
  ApiErrorCode,
  ContestsResponse,
  GardenResponse,
  LinkResponse,
  MayorResponse,
} from "@garden-hq/core";

export type ClientErrorCode = ApiErrorCode | "network" | "bad_response";

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly retryAfter: number | undefined;

  constructor(
    code: ClientErrorCode,
    status: number,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const API_BASE: string =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:8787" : "");

const KNOWN_CODES: readonly ApiErrorCode[] = [
  "unknown_player",
  "no_garden",
  "not_found",
  "bad_request",
  "rate_limited",
  "upstream_down",
  "missing_api_key",
  "internal",
];

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 502) return "upstream_down";
  return "internal";
}

function parseRetryAfter(
  value: unknown,
  header: string | null,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds;
  }
  return undefined;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: Record<string, unknown> }).error
      : null;

  const rawCode = error?.code;
  const code =
    typeof rawCode === "string" &&
    (KNOWN_CODES as readonly string[]).includes(rawCode)
      ? (rawCode as ApiErrorCode)
      : codeFromStatus(res.status);
  const message =
    typeof error?.message === "string" ? error.message : `HTTP ${res.status}`;

  return new ApiError(
    code,
    res.status,
    message,
    parseRetryAfter(error?.retryAfter, res.headers.get("Retry-After")),
  );
}

export type FetchFn = typeof fetch;

export function createApiClient(
  fetchFn: FetchFn = (input, init) => fetch(input, init),
  baseUrl: string = API_BASE,
) {
  async function get<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}${query}`);
    } catch {
      throw new ApiError("network", 0, "Network request failed");
    }

    if (!res.ok) throw await toApiError(res);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError("bad_response", res.status, "Response was not JSON");
    }
    if (typeof body !== "object" || body === null) {
      throw new ApiError(
        "bad_response",
        res.status,
        "Unexpected response shape",
      );
    }
    return body as T;
  }

  return {
    link: (name: string) => get<LinkResponse>("/api/link", { name }),
    garden: (profileId: string) =>
      get<GardenResponse>("/api/garden", { profile: profileId }),
    contests: () => get<ContestsResponse>("/api/contests"),
    mayor: () => get<MayorResponse>("/api/mayor"),
  };
}

export const api = createApiClient();
