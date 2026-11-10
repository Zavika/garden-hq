import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { pwaOptions } from "./vite/pwa-config.ts";
import { spritesPlugin } from "./vite/sprites-plugin.ts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    spritesPlugin(),
    ...(process.env.VITEST ? [] : [VitePWA(pwaOptions())]),
  ],
  test: {
    environment: "jsdom",
    alias: {
      "virtual:pwa-register": fileURLToPath(
        new URL("./src/test/pwa-register-stub.ts", import.meta.url),
      ),
    },
    setupFiles: ["./src/test/setup.ts"],
  },
});
