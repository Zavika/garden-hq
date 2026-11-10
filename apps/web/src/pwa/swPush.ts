export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const DEFAULT_TITLE = "Garden HQ";
const MAX_TITLE = 120;
const MAX_BODY = 300;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v !== "" ? v.slice(0, max) : null;
}

/** Tolerates missing or garbage data: a push must always yield a notification. */
export function parsePushPayload(data: unknown): PushPayload {
  const o =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  return {
    title: str(o.title, MAX_TITLE) ?? DEFAULT_TITLE,
    body: str(o.body, MAX_BODY) ?? "",
    tag: str(o.tag, 100) ?? "garden-hq",
    url: str(o.url, 500) ?? "/",
  };
}

const ICON = "/icons/icon-192.png";

export function notificationOptions(p: PushPayload): NotificationOptions {
  return {
    body: p.body,
    icon: ICON,
    badge: ICON,
    tag: p.tag,
    data: { url: p.url },
  };
}

/** Index of the window to focus: focused same-origin first, else first same-origin. */
export function pickClientToFocus(
  clients: { url: string; focused?: boolean }[],
  target: string,
): number | null {
  let origin: string;
  try {
    origin = new URL(target).origin;
  } catch {
    return null;
  }
  const same = (u: string): boolean => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  };
  const focused = clients.findIndex((c) => c.focused === true && same(c.url));
  if (focused >= 0) return focused;
  const first = clients.findIndex((c) => same(c.url));
  return first >= 0 ? first : null;
}
