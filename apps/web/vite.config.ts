import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { spritesPlugin } from "./vite/sprites-plugin.ts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), spritesPlugin()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
