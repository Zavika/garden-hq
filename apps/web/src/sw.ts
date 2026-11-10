/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
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

// Push handlers are added in Phase 5E.
