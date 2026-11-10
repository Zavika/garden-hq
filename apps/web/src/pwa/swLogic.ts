/**
 * True only for same-origin SPA route URLs: not under /api and with no file
 * extension in the last path segment. Everything else falls through to the
 * network (the service worker never serves it).
 */
export function isPrecachedNavigation(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return false;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return !last.includes(".");
}
