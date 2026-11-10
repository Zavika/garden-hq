export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Secret — set with `wrangler secret put HYPIXEL_API_KEY`. */
  HYPIXEL_API_KEY?: string;
  CACHE: KVNamespace;
  /** D1 database holding player cloud saves. */
  DB: D1Database;
  /** The deployed web app origin allowed by CORS. */
  WEB_ORIGIN?: string;
  /** "dev" enables the localhost CORS origin. */
  ENVIRONMENT?: string;
  /** Cloudflare rate-limit binding; the KV counter is used when absent. */
  RATE_LIMITER?: RateLimiterBinding;
  /** Stricter limiter for requests presenting a sync code; KV counter used when absent (dev only). */
  CODE_LIMITER?: RateLimiterBinding;
  /** Secret — base64url 65-byte VAPID public point (Web Push). */
  VAPID_PUBLIC_KEY?: string;
  /** Secret — base64url 32-byte VAPID private scalar (Web Push). */
  VAPID_PRIVATE_KEY?: string;
  /** Plain var — https: URL (or mailto:) identifying the sender; defaults to WEB_ORIGIN. */
  VAPID_SUBJECT?: string;
}
