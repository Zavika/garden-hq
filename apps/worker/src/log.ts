/** Replace every occurrence of `secret` in `text`. */
export function redact(text: string, secret: string | undefined): string {
  if (secret === undefined || secret === "") return text;
  return text.split(secret).join("[redacted]");
}

/**
 * `path` must be a path *template* (e.g. "/users/profiles/minecraft/:name"),
 * never a full URL — and never anything containing the API key.
 */
export function logUpstream(entry: {
  host: string;
  path: string;
  status: number | "error";
  ms: number;
}): void {
  console.log(JSON.stringify({ event: "upstream", ...entry }));
}

export function logError(
  event: string,
  detail: Record<string, string | number> = {},
): void {
  console.error(JSON.stringify({ event, ...detail }));
}
