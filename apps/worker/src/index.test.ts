import { describe, expect, it } from "vitest";
import worker, { app } from "./index";
import { makeEnv } from "../test/helpers";

describe("GET /health", () => {
  it("returns ok status and the core ping", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      core: "garden-hq core is alive",
    });
  });
});

describe("scheduled", () => {
  it("is exported and runs the sync inside waitUntil", async () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");

    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
    } as unknown as ExecutionContext;
    worker.scheduled({} as ScheduledController, makeEnv(), ctx);
    expect(pending).toHaveLength(1);
    await expect(pending[0]).resolves.toMatchObject({
      due: 0,
      stoppedBecause: "done",
    });
  });
});
