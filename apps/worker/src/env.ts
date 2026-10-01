export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Secret — set with `wrangler secret put HYPIXEL_API_KEY`. */
  HYPIXEL_API_KEY?: string;
  CACHE: KVNamespace;
  /** The deployed web app origin allowed by CORS. */
  WEB_ORIGIN?: string;
  /** "dev" enables the localhost CORS origin. */
  ENVIRONMENT?: string;
  /** Cloudflare rate-limit binding; the KV counter is used when absent. */
  RATE_LIMITER?: RateLimiterBinding;
}
