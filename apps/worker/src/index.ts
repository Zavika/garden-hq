import { Hono } from "hono";
import { pingCore } from "@garden-hq/core";

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    status: "ok",
    core: pingCore(),
  }),
);

export default app;
