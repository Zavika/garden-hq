import {
  defaultAlertRules,
  parseAlertRules,
  type AlertsStateResponse,
  type AlertTestResponse,
} from "@garden-hq/core";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import {
  countWebhooks,
  loadAlertSettings,
  markWebhookDeadStmt,
  removeAlertSettings,
  saveRules,
  saveWebhook,
  verifyWebhookStmt,
  type AlertSettingsRow,
} from "../alerts/db";
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

// The webhook URL is a secret: only hasWebhook and its last 4 characters leave the server.
function toState(settings: AlertSettingsRow | null): AlertsStateResponse {
  const webhook = settings?.webhook ?? null;
  return {
    hasWebhook: webhook !== null,
    webhookLast4: webhook === null ? null : webhookLast4(webhook),
    webhookOk: settings?.webhookOk ?? null,
    rules: settings?.rules ?? null,
  };
}

export function alertsRoute(deps: AppDeps): Hono<{ Bindings: Env }> {
  const route = new Hono<{ Bindings: Env }>();

  route.get("/alerts", async (c) => {
    const account = await authenticate(c, deps.now);
    c.header("Cache-Control", "no-store");
    return c.json(toState(await loadAlertSettings(c.env.DB, account.id)));
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
    const existing = await loadAlertSettings(c.env.DB, account.id);
    if (
      existing?.webhook == null &&
      (await countWebhooks(c.env.DB)) >= MAX_ALERTING_ACCOUNTS
    ) {
      throw new AppError(
        "rate_limited",
        "Alerts are full right now — the free server only handles a few players.",
        3600,
      );
    }
    await saveWebhook(c.env.DB, account.id, body.url, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(toState(await loadAlertSettings(c.env.DB, account.id)));
  });

  route.delete("/alerts/webhook", async (c) => {
    const account = await authenticate(c, deps.now);
    await removeAlertSettings(c.env.DB, account.id);
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
      ...toState(await loadAlertSettings(c.env.DB, account.id)),
      test,
    } satisfies AlertTestResponse);
  });

  route.put("/alerts/rules", async (c) => {
    const account = await authenticate(c, deps.now);
    const body = await readJsonBody(c);
    const settings = await loadAlertSettings(c.env.DB, account.id);
    if (settings?.webhookOk !== true || settings.rules === null) {
      throw new AppError(
        "bad_request",
        "Send a test message first so we know the webhook works",
      );
    }
    const parsed = parseAlertRules(body.rules, settings.rules);
    if (!parsed.ok) throw new AppError("bad_request", parsed.error);
    await saveRules(c.env.DB, account.id, parsed.rules, deps.now());
    c.header("Cache-Control", "no-store");
    return c.json(toState(await loadAlertSettings(c.env.DB, account.id)));
  });

  return route;
}
