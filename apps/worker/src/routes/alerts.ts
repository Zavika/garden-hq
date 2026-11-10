import {
  defaultAlertRules,
  parseAlertRules,
  type AlertsStateResponse,
  type AlertTestResponse,
  type PushTestResponse,
} from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import {
  countAlertingAccounts,
  loadAlertSettings,
  markWebhookDeadStmt,
  removeAlertSettings,
  saveRules,
  saveWebhook,
  verifyWebhookStmt,
} from "../alerts/db";
import {
  countSubscriptions,
  deleteSubscription,
  listSubscriptions,
  parsePushSubscription,
  upsertSubscription,
  verifyPushStmt,
} from "../alerts/push";
import { authenticate } from "../auth";
import { readJsonBody } from "../body";
import type { Env } from "../env";
import { AppError } from "../errors";
import { MAX_ALERTING_ACCOUNTS } from "../limits";
import {
  isDiscordWebhookUrl,
  sendDiscord,
  TEST_EMBED,
  webhookLast4,
} from "../notify/discord";
import { pushPayload, sendPush, vapidFromEnv } from "../notify/webpush";

// The webhook URL and push endpoints/keys are secrets: only hasWebhook, its last
// 4 characters and a device count leave the server.
async function loadState(
  env: Env,
  accountId: string,
): Promise<AlertsStateResponse> {
  const settings = await loadAlertSettings(env.DB, accountId);
  const devices = await countSubscriptions(env.DB, accountId);
  const vapid = vapidFromEnv(env);
  const webhook = settings?.webhook ?? null;
  return {
    hasWebhook: webhook !== null,
    webhookLast4: webhook === null ? null : webhookLast4(webhook),
    webhookOk: settings?.webhookOk ?? null,
    rules: settings?.rules ?? null,
    push: {
      available: vapid !== null,
      publicKey: vapid?.publicKey ?? null,
      devices,
      pushOk: settings?.pushOk ?? null,
    },
  };
}

const FULL_MESSAGE =
  "Alerts are full right now — the free server only handles a few players.";

/** Throws when this account has no channel yet and the free plan's alerting slots are taken. */
async function assertCapacity(
  db: D1Database,
  accountId: string,
): Promise<void> {
  const existing = await loadAlertSettings(db, accountId);
  if (
    existing?.webhook == null &&
    (await countSubscriptions(db, accountId)) === 0 &&
    (await countAlertingAccounts(db)) >= MAX_ALERTING_ACCOUNTS
  ) {
    throw new AppError("rate_limited", FULL_MESSAGE, 3600);
  }
}

export function alertsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/alerts", async (c) => {
    const account = await authenticate(c, deps.now);
    c.header("Cache-Control", "no-store");
    return c.json(await loadState(c.env, account.id));
  });

  route.put("/alerts/push", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    // There is no "unavailable" error code; bad_request is the closest (the UI reads push.available).
    if (vapidFromEnv(c.env) === null) {
      throw new AppError(
        "bad_request",
        "Push alerts aren't set up on this server yet",
      );
    }
    const sub = parsePushSubscription(body.subscription);
    if (sub === null) {
      throw new AppError(
        "bad_request",
        "That is not a valid push subscription",
      );
    }
    await assertCapacity(c.env.DB, account.id);
    await upsertSubscription(c.env.DB, account.id, sub, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(await loadState(c.env, account.id));
  });

  route.delete("/alerts/push", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    if (typeof body.endpoint !== "string" || body.endpoint.length === 0) {
      throw new AppError("bad_request", "Missing endpoint");
    }
    await deleteSubscription(c.env.DB, account.id, body.endpoint);
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });

  route.post("/alerts/push/test", async (c) => {
    const account = await authenticate(c, deps.now);
    const vapid = vapidFromEnv(c.env);
    if (vapid === null) {
      throw new AppError(
        "bad_request",
        "Push alerts aren't set up on this server yet",
      );
    }
    const subs = await listSubscriptions(c.env.DB, account.id);
    if (subs.length === 0) {
      throw new AppError("bad_request", "Turn on push for a device first");
    }
    const payload = pushPayload(
      {
        title: "Garden HQ test notification",
        detail: "Push alerts are working on this device.",
      },
      "test",
    );
    let sent = 0;
    let dead = 0;
    for (const sub of subs) {
      const result = await sendPush(
        deps.fetch,
        sub,
        payload,
        vapid,
        deps.now(),
      );
      if (result.kind === "sent") {
        sent++;
      } else if (result.kind === "dead") {
        dead++;
        await deleteSubscription(c.env.DB, account.id, sub.endpoint);
      }
      // retry/rejected: keep the device; the player can try again.
    }
    if (sent > 0) {
      await verifyPushStmt(
        c.env.DB,
        account.id,
        JSON.stringify(defaultAlertRules(true)),
        deps.now(),
      ).run();
    }
    const test: PushTestResponse["test"] =
      sent > 0 ? "sent" : dead === subs.length ? "dead" : "failed";
    c.header("Cache-Control", "no-store");
    return c.json({
      ...(await loadState(c.env, account.id)),
      test,
    } satisfies PushTestResponse);
  });

  route.put("/alerts/webhook", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    if (!isDiscordWebhookUrl(body.url)) {
      throw new AppError(
        "bad_request",
        "That is not a Discord webhook URL (https://discord.com/api/webhooks/…)",
      );
    }
    await assertCapacity(c.env.DB, account.id);
    await saveWebhook(c.env.DB, account.id, body.url, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(await loadState(c.env, account.id));
  });

  route.delete("/alerts/webhook", async (c) => {
    const account = await authenticate(c, deps.now);
    await removeAlertSettings(c.env.DB, account.id, deps.now());
    c.header("Cache-Control", "no-store");
    return c.body(null, 204);
  });

  route.post("/alerts/test", async (c) => {
    const account = await authenticate(c, deps.now);
    const settings = await loadAlertSettings(c.env.DB, account.id);
    if (settings?.webhook == null) {
      throw new AppError("bad_request", "Add a webhook first");
    }
    const result = await sendDiscord(deps.fetch, settings.webhook, TEST_EMBED);
    const now = deps.now();
    let test: AlertTestResponse["test"] = "failed";
    if (result.kind === "sent") {
      test = "sent";
      await verifyWebhookStmt(
        c.env.DB,
        account.id,
        JSON.stringify(defaultAlertRules(true)),
        now,
      ).run();
    } else if (result.kind === "dead") {
      test = "dead";
      await markWebhookDeadStmt(c.env.DB, account.id, now).run();
    }
    c.header("Cache-Control", "no-store");
    return c.json({
      ...(await loadState(c.env, account.id)),
      test,
    } satisfies AlertTestResponse);
  });

  route.put("/alerts/rules", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    const settings = await loadAlertSettings(c.env.DB, account.id);
    if (
      (settings?.webhookOk !== true && settings?.pushOk !== true) ||
      settings.rules === null
    ) {
      throw new AppError(
        "bad_request",
        "Send a test message or test notification first so we know the channel works",
      );
    }
    const parsed = parseAlertRules(body.rules, settings.rules);
    if (!parsed.ok) throw new AppError("bad_request", parsed.error);
    await saveRules(c.env.DB, account.id, parsed.rules, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(await loadState(c.env, account.id));
  });

  return route;
}
