import type { AlertCandidate } from "@garden-hq/core";
import { discardBody } from "../http";
import { logUpstream } from "../log";

/** Anchored: blocks look-alike hosts, query strings and path suffixes (SSRF). */
export const WEBHOOK_RE =
  /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const HOST = "discord.com";
// A path TEMPLATE: the real path holds the webhook token and must never be logged.
const LOG_PATH = "/api/webhooks/:id/:token";

export function isDiscordWebhookUrl(value: unknown): value is string {
  return typeof value === "string" && WEBHOOK_RE.test(value);
}

export function webhookLast4(url: string): string {
  return url.slice(-4);
}

export interface DiscordEmbed {
  title: string;
  description: string;
  footer: { text: string };
}

export const TEST_EMBED: DiscordEmbed = {
  title: "Garden HQ test message",
  description: "Alerts for your Garden will arrive in this channel.",
  footer: { text: "Not affiliated with Hypixel or Mojang." },
};

export function alertEmbed(
  candidate: AlertCandidate,
  syncedAt: number,
  now: number,
): DiscordEmbed {
  const minutes = Math.max(0, Math.round((now - syncedAt) / 60_000));
  return {
    title: candidate.title.slice(0, 256),
    description: candidate.detail.slice(0, 2000),
    footer: { text: `Last synced ${minutes} min ago · Garden HQ` },
  };
}

export type SendResult =
  | { kind: "sent" }
  | { kind: "retry"; retryAfterSeconds: number | null }
  | { kind: "dead" }
  | { kind: "rejected"; status: number };

async function retryAfterSeconds(res: Response): Promise<number | null> {
  // VERIFY: Discord's 429 body carries `retry_after` in seconds (may be fractional).
  try {
    const body: unknown = JSON.parse((await res.text()).slice(0, 2000));
    const v = (body as { retry_after?: unknown } | null)?.retry_after;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0)
      return Math.ceil(v);
  } catch {
    // fall through to the header
  }
  const raw = res.headers.get("Retry-After");
  if (raw === null || raw.trim() === "") return null;
  const header = Number(raw);
  return Number.isFinite(header) && header >= 0 ? Math.ceil(header) : null;
}

/** Posts one embed. Redirects are not followed (workerd only supports "follow"/"manual"); a 3xx is classed rejected. The webhook is validated here too, so no caller can bypass the SSRF check. */
export async function sendDiscord(
  fetchFn: typeof fetch,
  webhook: string,
  embed: DiscordEmbed,
): Promise<SendResult> {
  if (!isDiscordWebhookUrl(webhook)) return { kind: "dead" };

  const started = Date.now();
  let res: Response;
  try {
    res = await fetchFn(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
      redirect: "manual",
    });
  } catch {
    logUpstream({
      host: HOST,
      path: LOG_PATH,
      status: "error",
      ms: Date.now() - started,
    });
    return { kind: "retry", retryAfterSeconds: null };
  }
  logUpstream({
    host: HOST,
    path: LOG_PATH,
    status: res.status,
    ms: Date.now() - started,
  });

  if (res.ok) {
    discardBody(res);
    return { kind: "sent" };
  }
  if (res.status === 429) {
    return { kind: "retry", retryAfterSeconds: await retryAfterSeconds(res) };
  }
  discardBody(res);
  if (res.status === 404 || res.status === 401) return { kind: "dead" };
  if (res.status >= 500) return { kind: "retry", retryAfterSeconds: null };
  return { kind: "rejected", status: res.status };
}
