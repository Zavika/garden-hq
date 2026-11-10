import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANIFEST, pwaOptions } from "./pwa-config.ts";

describe("MANIFEST", () => {
  it("has the required values", () => {
    expect(MANIFEST).toMatchObject({
      name: "Garden HQ",
      short_name: "Garden HQ",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#f4e4b5",
      background_color: "#f4e4b5",
    });
  });
  it("declares 192, 512 and maskable 512 png icons that exist", () => {
    expect(MANIFEST.icons.map((i) => i.sizes)).toEqual([
      "192x192",
      "512x512",
      "512x512",
    ]);
    for (const i of MANIFEST.icons) {
      expect(i.type).toBe("image/png");
      const file = resolve(import.meta.dirname, "../public", i.src.slice(1));
      expect(existsSync(file)).toBe(true);
    }
    expect(MANIFEST.icons.filter((i) => i.purpose === "maskable")).toHaveLength(
      1,
    );
  });
});

describe("pwaOptions", () => {
  it("uses injectManifest with prompt registration and ignores the sprites README", () => {
    expect(pwaOptions()).toMatchObject({
      strategies: "injectManifest",
      registerType: "prompt",
      injectRegister: false,
      srcDir: "src",
      filename: "sw.ts",
      manifestFilename: "manifest.webmanifest",
      includeManifestIcons: false,
      devOptions: { enabled: false },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/README.md"],
      },
    });
  });
});
