import { cached } from "./cache";
import { AppError } from "./errors";
import { discardBody } from "./http";
import { logUpstream } from "./log";
import { toDashedUuid } from "./validate";

const CACHE_TTL_SECONDS = 24 * 60 * 60;

type Player = { uuid: string; name: string };

interface Provider {
  host: string;
  /** Path template for logs; never contains the player name. */
  path: string;
  url: (name: string) => string;
  /** Pull the raw id and canonical name out of a 200 body. */
  parse: (body: unknown) => { id?: unknown; name?: unknown };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

// Order matters: Mojang's own hosts first, community mirror last.
const PROVIDERS: Provider[] = [
  {
    host: "api.minecraftservices.com",
    path: "/minecraft/profile/lookup/name/:name",
    url: (name) =>
      `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`,
    parse: (body) => asRecord(body),
  },
  {
    host: "api.mojang.com",
    path: "/users/profiles/minecraft/:name",
    url: (name) =>
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    parse: (body) => asRecord(body),
  },
  {
    host: "playerdb.co",
    path: "/api/player/minecraft/:name",
    url: (name) =>
      `https://playerdb.co/api/player/minecraft/${encodeURIComponent(name)}`,
    parse: (body) => {
      const player = asRecord(asRecord(asRecord(body).data).player);
      return { id: player.id, name: player.username };
    },
  },
];

const unknownPlayer = () =>
  new AppError("unknown_player", "No Minecraft account with that name");

/** A provider answered but we can't use it: try the next one. */
class ProviderFailed extends Error {}

async function queryProvider(
  fetchFn: typeof fetch,
  provider: Provider,
  name: string,
): Promise<Player> {
  const started = Date.now();
  const log = (status: number | "error") =>
    logUpstream({
      host: provider.host,
      path: provider.path,
      status,
      ms: Date.now() - started,
    });

  let res: Response;
  try {
    res = await fetchFn(provider.url(name));
  } catch {
    log("error");
    throw new ProviderFailed();
  }
  log(res.status);

  if (!res.ok || res.status === 204) discardBody(res);

  if (res.status === 204 || res.status === 404) throw unknownPlayer();
  if (!res.ok) throw new ProviderFailed();

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ProviderFailed();
  }

  const raw = provider.parse(body);
  const uuid = typeof raw.id === "string" ? toDashedUuid(raw.id) : null;
  if (uuid === null) throw new ProviderFailed();

  return { uuid, name: typeof raw.name === "string" ? raw.name : name };
}

async function lookupUncached(
  fetchFn: typeof fetch,
  name: string,
): Promise<Player> {
  for (const provider of PROVIDERS) {
    try {
      return await queryProvider(fetchFn, provider, name);
    } catch (err) {
      if (!(err instanceof ProviderFailed)) throw err;
    }
  }
  throw new AppError("upstream_down", "Mojang is unavailable right now");
}

/**
 * `name` must already be validated (`parseName`). A 404 from any provider is
 * authoritative (`unknown_player`); other failures fall through to the next
 * provider, and only all of them failing yields `upstream_down`. Successful
 * lookups are cached in KV for 24 h when `cache` is given.
 */
export async function lookupUuid(
  fetchFn: typeof fetch,
  name: string,
  cache?: { kv: KVNamespace; now: () => number },
): Promise<Player> {
  if (cache === undefined) return lookupUncached(fetchFn, name);

  const { value } = await cached(
    cache.kv,
    `mojang:${name.toLowerCase()}`,
    CACHE_TTL_SECONDS,
    cache.now,
    () => lookupUncached(fetchFn, name),
  );
  return value;
}
