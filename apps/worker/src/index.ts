import { createApp } from "./app";
import { scheduledSync } from "./cron";
import type { Env } from "./env";

export const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(scheduledSync(env));
  },
} satisfies ExportedHandler<Env>;
