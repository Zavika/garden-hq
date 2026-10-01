import { AppError } from "./errors";
import { logUpstream } from "./log";
import { toDashedUuid } from "./validate";

const HOST = "api.mojang.com";
const PATH = "/users/profiles/minecraft/:name";

const upstreamDown = () =>
  new AppError("upstream_down", "Mojang is unavailable right now");

/** `name` must already be validated (`parseName`). */
export async function lookupUuid(
  fetchFn: typeof fetch,
  name: string,
): Promise<{ uuid: string; name: string }> {
  const started = Date.now();

  let res: Response;
  try {
    res = await fetchFn(
      `https://${HOST}/users/profiles/minecraft/${encodeURIComponent(name)}`,
    );
  } catch {
    logUpstream({
      host: HOST,
      path: PATH,
      status: "error",
      ms: Date.now() - started,
    });
    throw upstreamDown();
  }

  logUpstream({
    host: HOST,
    path: PATH,
    status: res.status,
    ms: Date.now() - started,
  });

  if (res.status === 204 || res.status === 404) {
    throw new AppError("unknown_player", "No Minecraft account with that name");
  }
  if (res.status === 429) {
    throw new AppError("rate_limited", "Mojang rate limit reached", 60);
  }
  if (!res.ok) throw upstreamDown();

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw upstreamDown();
  }

  const data = (
    typeof body === "object" && body !== null ? body : {}
  ) as Record<string, unknown>;
  const uuid = typeof data.id === "string" ? toDashedUuid(data.id) : null;
  if (uuid === null) throw upstreamDown();

  return { uuid, name: typeof data.name === "string" ? data.name : name };
}
