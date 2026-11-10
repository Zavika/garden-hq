import type { ManifestOptions, VitePWAOptions } from "vite-plugin-pwa";

export const MANIFEST = {
  name: "Garden HQ",
  short_name: "Garden HQ",
  description:
    "A companion for the Hypixel SkyBlock Garden: plots, composter, visitors and contests.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  theme_color: "#f4e4b5",
  background_color: "#f4e4b5",
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
} as const satisfies Partial<ManifestOptions>;

export function pwaOptions(): Partial<VitePWAOptions> {
  return {
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.ts",
    registerType: "prompt",
    injectRegister: false,
    manifest: MANIFEST,
    manifestFilename: "manifest.webmanifest",
    // Icons are already precached by the glob below.
    includeManifestIcons: false,
    injectManifest: {
      globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      globIgnores: ["**/README.md"],
    },
    devOptions: { enabled: false },
  };
}
