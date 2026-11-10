/** Minimal structural views of the browser APIs, so tests need no real browser. */
export interface PushSubscriptionLike {
  endpoint: string;
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<PushSubscriptionLike>;
}

export interface PushBrowser {
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  registration(): Promise<{ pushManager: PushManagerLike }>;
}

export interface PushSupportEnv {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
}

export class PushPermissionError extends Error {
  constructor() {
    super("Notification permission was not granted");
    this.name = "PushPermissionError";
  }
}

/** No service worker is registered (dev build or failed registration). */
export class NoServiceWorkerError extends Error {
  constructor() {
    super("No service worker is registered");
    this.name = "NoServiceWorkerError";
  }
}

export const realBrowser: PushBrowser = {
  permission: () =>
    typeof Notification === "undefined" ? "denied" : Notification.permission,
  requestPermission: () => Notification.requestPermission(),
  registration: async () => {
    // getRegistration (not .ready): .ready never resolves without a worker.
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg === undefined) throw new NoServiceWorkerError();
    return { pushManager: reg.pushManager as unknown as PushManagerLike };
  },
};

export function readPushSupportEnv(): PushSupportEnv {
  return {
    serviceWorker:
      typeof navigator !== "undefined" && "serviceWorker" in navigator,
    pushManager: typeof window !== "undefined" && "PushManager" in window,
    notification: typeof Notification !== "undefined",
  };
}

export function pushSupported(
  env: PushSupportEnv = readPushSupportEnv(),
): boolean {
  return env.serviceWorker && env.pushManager && env.notification;
}

export function urlBase64ToUint8Array(b64url: string): Uint8Array<ArrayBuffer> {
  const clean = b64url.replace(/=+$/, "");
  const b64 = (clean + "=".repeat((4 - (clean.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(
  b: PushBrowser = realBrowser,
): Promise<PushSubscriptionLike | null> {
  const { pushManager } = await b.registration();
  return pushManager.getSubscription();
}

/** Asks for permission (call ONLY from a click handler) and subscribes. */
export async function subscribeThisDevice(
  publicKey: string,
  b: PushBrowser = realBrowser,
): Promise<PushSubscriptionJSON> {
  let permission = b.permission();
  if (permission !== "granted") permission = await b.requestPermission();
  if (permission !== "granted") throw new PushPermissionError();
  const { pushManager } = await b.registration();
  const sub = await pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return sub.toJSON();
}

/** Unsubscribes this device; returns the endpoint to delete server-side. */
export async function unsubscribeThisDevice(
  b: PushBrowser = realBrowser,
): Promise<string | null> {
  const sub = await currentSubscription(b);
  if (sub === null) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
