import { Hono } from "hono";
import type { Env } from "./env";

export interface AppDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

// Temporary stub (Ruling R1) — replaced in Task 7.
export function createApp(deps: AppDeps): Hono<{ Bindings: Env }> {
  void deps;
  throw new Error("replaced in Task 7");
}
