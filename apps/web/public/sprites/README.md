# Sprites

Drop 16x16 PNG files here to replace the built-in programmatic art in the map and the crop icons. Any sprite you do not provide keeps the built-in drawing, so you can add them one at a time. Run `pnpm --filter @garden-hq/web sprites:check` to validate this folder; a wrong-size, non-PNG or unknown-name file fails `vite build` (and logs a warning in dev).

## Expected files

| File                    | Size  | Transparent? | Replaces                | Notes                                                                     |
| ----------------------- | ----- | ------------ | ----------------------- | ------------------------------------------------------------------------- |
| `soil.png`              | 16x16 | No (opaque)  | Plot soil tile          | Must tile seamlessly. Crops are drawn over it.                            |
| `locked.png`            | 16x16 | No (opaque)  | Locked plot tile        | The padlock and the gold "buyable" glow are drawn over it.                |
| `greenhouse.png`        | 16x16 | Yes          | Greenhouse plot overlay | Drawn over soil.                                                          |
| `barn.png`              | 16x16 | Yes          | Barn tile (centre)      | Fills one tile. Visitor dots are drawn over it.                           |
| `crops/wheat.png`       | 16x16 | Yes          | Wheat sprite            | Drawn over `soil.png`. Keep the top-left ~6 px quiet (plot-number badge). |
| `crops/carrot.png`      | 16x16 | Yes          | Carrot sprite           | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/potato.png`      | 16x16 | Yes          | Potato sprite           | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/pumpkin.png`     | 16x16 | Yes          | Pumpkin sprite          | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/sugar_cane.png`  | 16x16 | Yes          | Sugar Cane sprite       | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/melon.png`       | 16x16 | Yes          | Melon sprite            | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/cactus.png`      | 16x16 | Yes          | Cactus sprite           | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/cocoa_beans.png` | 16x16 | Yes          | Cocoa Beans sprite      | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/mushroom.png`    | 16x16 | Yes          | Mushroom sprite         | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/nether_wart.png` | 16x16 | Yes          | Nether Wart sprite      | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/sunflower.png`   | 16x16 | Yes          | Sunflower sprite        | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/moonflower.png`  | 16x16 | Yes          | Moonflower sprite       | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |
| `crops/wild_rose.png`   | 16x16 | Yes          | Wild Rose sprite        | Drawn over `soil.png`. Keep the top-left ~6 px quiet.                     |

## Not replaced

These stay programmatic and are always drawn by the app: the grass base tile, the selection outline, the buyable glow, the padlock, the plot-number badge and the visitor dots.

## Export tips

- Aseprite: File > Export (or Export As), PNG, no scaling.
- Piskel: Export > PNG, scale 1x.
- Export as RGBA, exactly 16x16, one frame per file (no spritesheets).
- Only nearest-neighbour scaling is ever applied by the app; do not pre-blur or anti-alias.
- Use original art only. Do not copy Hypixel or Minecraft textures.
