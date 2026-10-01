import { normalizeContests, type Contest } from "@garden-hq/core";
import { AppError } from "./errors";
import { discardBody } from "./http";
import { logUpstream } from "./log";

export interface ContestsSource {
  name: string;
  url: string;
}

export interface ContestsResult {
  contests: Contest[];
  source: ContestsSource;
}

interface SourceConfig extends ContestsSource {
  host: string;
  path: string;
}

// VERIFY: endpoints per CLAUDE.md §2; response shapes are unconfirmed (see core/contests.ts).
// The Strassburger source requires a visible credit link — callers surface `source`.
const SOURCES: SourceConfig[] = [
  {
    name: "EliteBot",
    url: "https://elitebot.dev",
    host: "api.elitebot.dev",
    path: "/contests/at/now",
  },
  {
    name: "Jacob's Contests API (Strassburger)",
    url: "https://jacobs.strassburger.dev",
    host: "jacobs.strassburger.dev",
    path: "/api/jacobcontests",
  },
];

async function tryFetch(
  fetchFn: typeof fetch,
  source: SourceConfig,
): Promise<unknown> {
  const started = Date.now();

  let res: Response;
  try {
    res = await fetchFn(`https://${source.host}${source.path}`);
  } catch {
    logUpstream({
      host: source.host,
      path: source.path,
      status: "error",
      ms: Date.now() - started,
    });
    return undefined;
  }

  logUpstream({
    host: source.host,
    path: source.path,
    status: res.status,
    ms: Date.now() - started,
  });
  if (!res.ok) {
    discardBody(res);
    return undefined;
  }

  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function fetchContests(
  fetchFn: typeof fetch,
): Promise<ContestsResult> {
  let firstEmpty: ContestsResult | undefined;

  for (const { name, url, host, path } of SOURCES) {
    const body = await tryFetch(fetchFn, { name, url, host, path });
    if (body === undefined) continue;

    const result: ContestsResult = {
      contests: normalizeContests(body),
      source: { name, url },
    };
    if (result.contests.length > 0) return result;
    firstEmpty ??= result;
  }

  if (firstEmpty !== undefined) return firstEmpty;
  throw new AppError(
    "upstream_down",
    "No contest schedule source is available",
  );
}
