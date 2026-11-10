import type { AlertsStateResponse } from "@garden-hq/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, type PushApi } from "../api/client";
import { applyUpdate, getPwaState, subscribePwa } from "../pwa/register";
import {
  IOS_PUSH_NOTE,
  isIos,
  isStandalone,
  readPlatformEnv,
  type PlatformEnv,
} from "../pwa/platform";
import {
  currentSubscription,
  NoServiceWorkerError,
  PushPermissionError,
  pushSupported,
  readPushSupportEnv,
  realBrowser,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushBrowser,
  type PushSupportEnv,
} from "../pwa/pushClient";

type PushState = AlertsStateResponse["push"];

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "network") {
      return "Can't reach the server. Try again when you're online.";
    }
    if ((e.code === "rate_limited" || e.code === "bad_request") && e.message) {
      return e.message;
    }
  }
  return "Something went wrong. Try again.";
}

function toServerSubscription(
  json: PushSubscriptionJSON,
): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const { endpoint, keys } = json;
  if (
    typeof endpoint !== "string" ||
    typeof keys?.p256dh !== "string" ||
    typeof keys.auth !== "string"
  ) {
    return null;
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export interface PushSectionProps {
  code: string;
  push: PushState;
  client: PushApi;
  onState: (state: AlertsStateResponse) => void;
  env?: PlatformEnv;
  supportEnv?: PushSupportEnv;
  browser?: PushBrowser;
}

export function PushSection({
  code,
  push,
  client,
  onState,
  env,
  supportEnv,
  browser = realBrowser,
}: PushSectionProps) {
  const platform = env ?? readPlatformEnv();
  const iosNotInstalled = isIos(platform) && !isStandalone(platform);
  const supported = pushSupported(supportEnv ?? readPushSupportEnv());
  const usable = push.available && !iosNotInstalled && supported;

  const [subscribed, setSubscribed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    supported ? browser.permission() : "default",
  );
  const [noSw, setNoSw] = useState(false);
  const { needRefresh } = useSyncExternalStore(subscribePwa, getPwaState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Keep the latest callbacks without re-running the mount effect.
  const latest = useRef({ client, onState, code });
  useEffect(() => {
    latest.current = { client, onState, code };
  });

  // Mount: look for an existing local subscription and, when permission is
  // already granted, silently re-register it (idempotent). Never prompts.
  useEffect(() => {
    if (!usable) return;
    let live = true;
    (async () => {
      try {
        const sub = await currentSubscription(browser);
        if (!live) return;
        setSubscribed(sub !== null);
        if (sub !== null && browser.permission() === "granted") {
          const server = toServerSubscription(sub.toJSON());
          if (server !== null) {
            const next = await latest.current.client.putPush(
              latest.current.code,
              server,
            );
            if (live) latest.current.onState(next);
          }
        }
      } catch (e) {
        // Otherwise silent: a failed resync must not bother the player.
        if (live && e instanceof NoServiceWorkerError) setNoSw(true);
      } finally {
        if (live) setChecked(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [usable, browser]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const turnOn = () =>
    run(async () => {
      if (push.publicKey === null) return;
      let json: PushSubscriptionJSON;
      try {
        json = await subscribeThisDevice(push.publicKey, browser);
      } catch (e) {
        if (e instanceof NoServiceWorkerError) {
          setNoSw(true);
          return;
        }
        if (e instanceof PushPermissionError) {
          setPermission(browser.permission());
          setMessage("Notifications weren't allowed, so push stays off.");
          return;
        }
        throw e;
      }
      setPermission(browser.permission());
      const server = toServerSubscription(json);
      if (server === null) {
        setMessage("This browser returned an unusable subscription.");
        return;
      }
      try {
        onState(await client.putPush(code, server));
      } catch (e) {
        // Don't leave a local subscription the server never heard about.
        try {
          await unsubscribeThisDevice(browser);
        } catch {
          // Best effort.
        }
        throw e;
      }
      setSubscribed(true);
    });

  const turnOff = () =>
    run(async () => {
      const endpoint = await unsubscribeThisDevice(browser);
      setSubscribed(false);
      if (endpoint !== null) {
        await client.deletePush(code, endpoint);
        onState(await client.getAlerts(code));
      }
    });

  const sendTest = () =>
    run(async () => {
      const { test, ...next } = await client.testPush(code);
      onState(next);
      if (test === "sent") {
        setMessage("Test notification sent. It should arrive in a moment.");
      } else if (test === "dead") {
        try {
          await unsubscribeThisDevice(browser);
        } catch {
          // Already gone locally.
        }
        setSubscribed(false);
        setMessage(
          "This device's push registration has expired. Turn push on again.",
        );
      } else {
        setMessage("Couldn't send the notification. Try again in a minute.");
      }
    });

  let body;
  if (!push.available) {
    body = (
      <p className="muted">
        Push alerts aren&apos;t set up on this server yet.
      </p>
    );
  } else if (iosNotInstalled) {
    body = (
      <>
        <p>
          <strong>Add to Home Screen first</strong>
        </p>
        <p className="muted">{IOS_PUSH_NOTE}</p>
        <p className="muted">See the Install section above.</p>
      </>
    );
  } else if (!supported) {
    body = (
      <p className="muted">
        This browser doesn&apos;t support push notifications.
      </p>
    );
  } else if (noSw) {
    body = (
      <p className="muted">
        Push needs the installed app or a production build. Reload the page and
        try again.
      </p>
    );
  } else if (permission === "denied") {
    body = (
      <>
        <p role="alert">
          Notifications are blocked for this site. Allow them in your browser or
          system settings, then try again.
        </p>
        {subscribed ? (
          <button type="button" disabled={busy} onClick={() => void turnOff()}>
            Turn off
          </button>
        ) : null}
      </>
    );
  } else if (needRefresh && !subscribed) {
    body = (
      <>
        <p>Reload to update first</p>
        <p className="muted">
          A new version is waiting. Push alerts need it before they can be
          turned on.
        </p>
        <button type="button" onClick={() => void applyUpdate()}>
          Reload
        </button>
      </>
    );
  } else if (subscribed) {
    body = (
      <>
        <p>Push is on for this device</p>
        <p className="muted">
          {push.devices} {push.devices === 1 ? "device" : "devices"} will get
          alerts
        </p>
        {push.pushOk !== true ? (
          <p className="muted">
            Press Send test notification to turn alerts on.
          </p>
        ) : null}
        <div className="push-actions">
          <button type="button" disabled={busy} onClick={() => void sendTest()}>
            Send test notification
          </button>
          <button type="button" disabled={busy} onClick={() => void turnOff()}>
            Turn off
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <button
        type="button"
        disabled={busy || !checked}
        onClick={() => void turnOn()}
      >
        Turn on push on this device
      </button>
    );
  }

  return (
    <div className="push-section">
      <h3>Push notifications</h3>
      {body}
      {message !== null ? <p role="status">{message}</p> : null}
    </div>
  );
}
