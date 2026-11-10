/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
  notificationOptions,
  parsePushPayload,
  pickClientToFocus,
} from "./pwa/swPush";
import { isPrecachedNavigation } from "./pwa/swLogic";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Only the build-time precache is ever served. No runtime caching routes:
// /api and cross-origin requests always go to the network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA routes get the precached app shell; everything else falls through.
registerRoute(
  ({ request, url }) =>
    request.mode === "navigate" &&
    isPrecachedNavigation(url, self.location.origin),
  createHandlerBoundToURL("/index.html"),
);

// Prompt mode: the page asks us to activate after the user clicks Reload.
// No skipWaiting at install and no clientsClaim, so code is never swapped
// under an in-flight sync.
self.addEventListener("message", (event) => {
  const data: unknown = event.data;
  if (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "SKIP_WAITING"
  ) {
    void self.skipWaiting();
  }
});

// Web push. Browsers require a visible notification for every push, so a
// push with no or invalid data still shows a generic one.
self.addEventListener("push", (event) => {
  let data: unknown;
  try {
    data = event.data?.json();
  } catch {
    data = undefined;
  }
  const payload = parsePushPayload(data);
  event.waitUntil(
    self.registration.showNotification(
      payload.title,
      notificationOptions(payload),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw: unknown = (event.notification.data as { url?: unknown } | null)
    ?.url;
  let target: URL;
  try {
    target = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
  } catch {
    target = new URL("/", self.location.origin);
  }
  // Only same-origin URLs are ever opened.
  if (target.origin !== self.location.origin) {
    target = new URL("/", self.location.origin);
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const i = pickClientToFocus(
        windows.map((w) => ({ url: w.url, focused: w.focused })),
        self.location.origin,
      );
      if (i !== null) {
        const focused = await windows[i]?.focus();
        if (focused !== undefined && focused.url !== target.href) {
          try {
            await focused.navigate(target.href);
          } catch {
            // Focus alone is fine if navigation is refused.
          }
        }
      } else {
        await self.clients.openWindow(target.href);
      }
    })(),
  );
});
