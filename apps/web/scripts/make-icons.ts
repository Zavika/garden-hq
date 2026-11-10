import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, renderIcon, sproutSvg, type Rgba } from "./icons.ts";

const PARCH: Rgba = [0xf4, 0xe4, 0xb5, 255];
const pub = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
mkdirSync(resolve(pub, "icons"), { recursive: true });

const targets = [
  { file: "icons/icon-192.png", size: 192, paddingRatio: 0.1 },
  { file: "icons/icon-512.png", size: 512, paddingRatio: 0.1 },
  { file: "icons/icon-maskable-512.png", size: 512, paddingRatio: 0.2 },
  { file: "icons/apple-touch-icon.png", size: 180, paddingRatio: 0.1 },
];

for (const t of targets) {
  const rgba = renderIcon({
    size: t.size,
    paddingRatio: t.paddingRatio,
    background: PARCH,
  });
  writeFileSync(resolve(pub, t.file), encodePng(t.size, t.size, rgba));
}
writeFileSync(resolve(pub, "favicon.svg"), sproutSvg());
console.log("icons written");
