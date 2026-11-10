import {
  DEFAULT_SPRITES_DIR,
  readCropIds,
  scanSprites,
} from "./sprites-plugin.ts";

const { present, issues } = scanSprites(DEFAULT_SPRITES_DIR, readCropIds());
if (issues.length > 0) {
  for (const i of issues) {
    console.error(`public/sprites/${i.file}: ${i.problem}`);
  }
  process.exit(1);
}
console.log(`OK: ${present.length} sprites present (${present.join(", ")})`);
