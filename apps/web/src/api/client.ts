import type {
  AlertsStateResponse,
  AlertTestResponse,
  ApiErrorCode,
  BazaarPrices,
  ContestsResponse,
  GardenResponse,
  LinkResponse,
  MayorResponse,
  MemberResponse,
  AccountCreateResponse,
  StoredLink,
  SyncOp,
  SyncStateResponse,
} from "@garden-hq/core";

export interface BazaarResponse {
  prices: BazaarPrices;
  lastUpdated: number | null;
  fetchedAt: string;
}

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
  "bad_api_key",
  "unauthorized",
  "internal",
];

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
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

const REQUEST_TIMEOUT_MS = 20_000;

export type FetchFn = typeof fetch;

export function createApiClient(
  fetchFn: FetchFn = (input, init) => fetch(input, init),
  baseUrl: string = API_BASE,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
) {
  interface RequestOptions {
    params?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
  }

  async function send(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<Response> {
    const query = opts.params
      ? `?${new URLSearchParams(opts.params).toString()}`
      : "";
    const url = `${baseUrl}${path}${query}`;
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const plainGet = method === "GET" && Object.keys(headers).length === 0;
    let res: Response;
    // Plain GETs stay option-free (unchanged behaviour); everything else times out.
    const controller =
      !plainGet && typeof AbortController !== "undefined"
        ? new AbortController()
        : null;
    const timer =
      controller !== null
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    try {
      res = plainGet
        ? await fetchFn(url)
        : await fetchFn(url, {
            method,
            headers,
            ...(opts.body !== undefined
              ? { body: JSON.stringify(opts.body) }
              : {}),
            ...(controller !== null ? { signal: controller.signal } : {}),
          });
    } catch {
      throw new ApiError("network", 0, "Network request failed");
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    return res;
  }

  async function parseJson<T>(res: Response): Promise<T> {
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

  async function request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const res = await send(method, path, opts);
    if (!res.ok) throw await toApiError(res);
    return parseJson<T>(res);
  }

  function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return request<T>("GET", path, params ? { params } : {});
  }

  const bearer = (code: string): Record<string, string> => ({
    Authorization: `Bearer ${code}`,
  });

  function etagOf(res: Response): string {
    const etag = res.headers.get("ETag");
    if (etag === null) {
      throw new ApiError("bad_response", res.status, "Missing ETag");
    }
    return etag;
  }

  return {
    link: (name: string) => get<LinkResponse>("/api/link", { name }),
    garden: (profileId: string) =>
      get<GardenResponse>("/api/garden", { profile: profileId }),
    member: (profileId: string, uuid: string) =>
      get<MemberResponse>("/api/member", { profile: profileId, uuid }),
    contests: () => get<ContestsResponse>("/api/contests"),
    mayor: () => get<MayorResponse>("/api/mayor"),
    bazaar: () => get<BazaarResponse>("/api/bazaar"),
    createAccount: (link: StoredLink) =>
      request<AccountCreateResponse>("POST", "/api/account", {
        body: { link },
      }),
    getSync: async (
      code: string,
      etag: string | null,
    ): Promise<{ state: SyncStateResponse; etag: string } | null> => {
      const res = await send("GET", "/api/sync", {
        headers: {
          ...bearer(code),
          ...(etag !== null ? { "If-None-Match": etag } : {}),
        },
      });
      if (res.status === 304) return null;
      if (!res.ok) throw await toApiError(res);
      const state = await parseJson<SyncStateResponse>(res);
      return { state, etag: etagOf(res) };
    },
    postSync: async (
      code: string,
      ops: SyncOp[],
    ): Promise<{ state: SyncStateResponse; etag: string }> => {
      const res = await send("POST", "/api/sync", {
        headers: bearer(code),
        body: { ops },
      });
      if (!res.ok) throw await toApiError(res);
      const state = await parseJson<SyncStateResponse>(res);
      return { state, etag: etagOf(res) };
    },
    deleteAccount: async (code: string): Promise<void> => {
      const res = await send("DELETE", "/api/account", {
        headers: bearer(code),
      });
      if (!res.ok) throw await toApiError(res);
    },
    getAlerts: (code: string) =>
      request<AlertsStateResponse>("GET", "/api/alerts", {
        headers: bearer(code),
      }),
    putWebhook: (code: string, url: string) =>
      request<AlertsStateResponse>("PUT", "/api/alerts/webhook", {
        headers: bearer(code),
        body: { url },
      }),
    deleteWebhook: async (code: string): Promise<void> => {
      const res = await send("DELETE", "/api/alerts/webhook", {
        headers: bearer(code),
      });
      if (!res.ok) throw await toApiError(res);
    },
    testWebhook: (code: string) =>
      request<AlertTestResponse>("POST", "/api/alerts/test", {
        headers: bearer(code),
      }),
    putRules: (code: string, rules: Record<string, Record<string, unknown>>) =>
      request<AlertsStateResponse>("PUT", "/api/alerts/rules", {
        headers: bearer(code),
        body: { rules },
      }),
  };
}

export type SyncApi = Pick<
  ReturnType<typeof createApiClient>,
  "createAccount" | "getSync" | "postSync" | "deleteAccount"
>;

export type AlertsApi = Pick<
  ReturnType<typeof createApiClient>,
  "getAlerts" | "putWebhook" | "deleteWebhook" | "testWebhook" | "putRules"
>;

export const api = createApiClient();
