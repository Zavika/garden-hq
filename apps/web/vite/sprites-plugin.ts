import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { fileSlot, slotsFor, SPRITE_SIZE } from "../src/sprites/slots.ts";
import type { SpriteSlot } from "../src/sprites/slots.ts";
import { readPngSize } from "./png.ts";

export interface SpriteIssue {
  file: string;
  problem: string;
}
export interface SpriteScan {
  present: SpriteSlot[];
  issues: SpriteIssue[];
}

const VIRTUAL_ID = "virtual:sprites";
const RESOLVED_ID = "\0virtual:sprites";

export const DEFAULT_SPRITES_DIR = fileURLToPath(
  new URL("../public/sprites", import.meta.url),
);

function listFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), {
    withFileTypes: true,
  })) {
    if (entry.name.startsWith(".")) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, relPath));
    else if (relPath !== "README.md") out.push(relPath);
  }
  return out;
}

export function scanSprites(
  dir: string,
  cropIds: readonly string[],
): SpriteScan {
  if (!fs.existsSync(dir)) return { present: [], issues: [] };
  const found = new Set<SpriteSlot>();
  const issues: SpriteIssue[] = [];
  for (const file of listFiles(dir)) {
    const slot = fileSlot(file, cropIds);
    if (!slot) {
      issues.push({ file, problem: "not a known sprite name" });
      continue;
    }
    const size = readPngSize(fs.readFileSync(path.join(dir, file)));
    if (!size) {
      issues.push({ file, problem: "not a PNG" });
    } else if (size.width !== SPRITE_SIZE || size.height !== SPRITE_SIZE) {
      issues.push({
        file,
        problem: `must be ${SPRITE_SIZE}x${SPRITE_SIZE}, is ${size.width}x${size.height}`,
      });
    } else {
      found.add(slot);
    }
  }
  return {
    present: slotsFor(cropIds).filter((s) => found.has(s)),
    issues,
  };
}

export function readCropIds(): string[] {
  const file = fileURLToPath(
    new URL("../../../data/crops.json", import.meta.url),
  );
  const crops = JSON.parse(fs.readFileSync(file, "utf8")) as { id: string }[];
  return crops.map((c) => c.id);
}

export function spritesPlugin(opts: { dir?: string } = {}): Plugin {
  const dir = opts.dir ?? DEFAULT_SPRITES_DIR;
  let isBuild = false;
  const cropIds = readCropIds();
  return {
    name: "garden-sprites",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    buildStart() {
      const { issues } = scanSprites(dir, cropIds);
      if (issues.length === 0) return;
      if (isBuild) {
        this.error(
          issues
            .map((i) => `public/sprites/${i.file}: ${i.problem}`)
            .join("\n"),
        );
      } else {
        for (const i of issues) {
          this.warn(`public/sprites/${i.file}: ${i.problem}`);
        }
      }
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const { present } = scanSprites(dir, cropIds);
      return `export default ${JSON.stringify(present)};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const onChange = (file: string) => {
        const rel = path.relative(dir, file);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
      server.watcher.on("change", onChange);
    },
  };
}
