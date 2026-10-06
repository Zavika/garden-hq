import { cropColor } from "../map/palette";

/** Renders a tiny sprite from a character grid. "." (or an unknown char) is transparent. */
export function PixelArt({
  rows,
  palette,
  size = 2,
  className,
}: {
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
  /** CSS pixels per sprite pixel. */
  size?: number;
  className?: string;
}) {
  const width = Math.max(...rows.map((row) => row.length));
  const cells: { x: number; y: number; fill: string }[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((char, x) => {
      const fill = palette[char];
      if (fill !== undefined) cells.push({ x, y, fill });
    }),
  );

  return (
    <svg
      className={className}
      width={width * size}
      height={rows.length * size}
      viewBox={`0 0 ${width} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x},${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          fill={cell.fill}
        />
      ))}
    </svg>
  );
}

const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

function lighten(value: number, amount: number): string {
  const channel = (shift: number) =>
    Math.min(255, ((value >> shift) & 255) + amount);
  return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
}

const SUN = [
  "....y....",
  ".y..y..y.",
  "..y.o.y..",
  "...ooo...",
  "yyooooyyy",
  "...ooo...",
  "..y.o.y..",
  ".y..y..y.",
  "....y....",
];

const MOON = [
  "..mmmm...",
  ".mmm.....",
  "mmm......",
  "mmm......",
  "mmm......",
  "mmmm.....",
  ".mmmmm..m",
  "..mmmmmmm",
  "....mmm..",
];

const SPRING = [
  "...p.p...",
  "..ppwpp..",
  "...pwp...",
  "..ppwpp..",
  "...p.p...",
  "....g....",
  "..g.g.g..",
  "...ggg...",
  "....g....",
];

const SUMMER = [
  "..y.y.y..",
  ".y.yyy.y.",
  "..yyyyy..",
  "yyybbbyyy",
  "..ybbby..",
  "..yyyyy..",
  "...ggg...",
  "..g.g.g..",
  "....g....",
];

const AUTUMN = [
  "....r....",
  "...rrr...",
  "..rrorr..",
  ".rroorrr.",
  "rrooorrrr",
  ".rrorrr..",
  "..rrrr...",
  "...rr....",
  "...b.....",
];

const WINTER = [
  "....i....",
  ".i..i..i.",
  "..i.i.i..",
  "...iii...",
  "iiiiiiiii",
  "...iii...",
  "..i.i.i..",
  ".i..i..i.",
  "....i....",
];

const ICON_PALETTE = {
  y: "#f6d544",
  o: "#e8a317",
  m: "#cfd6ff",
  p: "#f08bb4",
  w: "#fff3b0",
  g: "#4f9a35",
  b: "#5a3a1c",
  r: "#c8501f",
  i: "#bfe6ff",
};

export function DayNightIcon({ isDay }: { isDay: boolean }) {
  return (
    <PixelArt
      rows={isDay ? SUN : MOON}
      palette={ICON_PALETTE}
      className="icon"
    />
  );
}

export function SeasonIcon({ season }: { season: string }) {
  const name = season.toLowerCase();
  const rows = name.includes("spring")
    ? SPRING
    : name.includes("summer")
      ? SUMMER
      : name.includes("autumn")
        ? AUTUMN
        : WINTER;
  return <PixelArt rows={rows} palette={ICON_PALETTE} className="icon" />;
}

const CROP = [
  "..hcc...",
  ".hcccc..",
  ".cccccc.",
  "..cccc..",
  "g..cc..g",
  ".gg.g.g.",
  "..gggg..",
  "....g...",
];

export function CropIcon({
  cropId,
  size = 2,
}: {
  cropId: string;
  size?: number;
}) {
  const base = cropColor(cropId);
  return (
    <PixelArt
      rows={CROP}
      size={size}
      className="icon"
      palette={{ c: hex(base), h: lighten(base, 60), g: "#4f9a35" }}
    />
  );
}

const SKINS = ["#f1c9a0", "#d9a273", "#a8744a", "#7a4e2d"];
const HAIRS = ["#3a2412", "#b5651d", "#e0b040", "#222222", "#8c3b2a"];
const SHIRTS = ["#3f7fbf", "#c8501f", "#4f9a35", "#8a56b8", "#d9a21e"];

function hashOf(text: string): number {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

const FACE = [
  "..HHHH..",
  ".HHHHHH.",
  ".HSSSSH.",
  ".SESSES.",
  ".SSSSSS.",
  "..SSMS..",
  ".TTTTTT.",
  "TTTTTTTT",
];

/** A tiny original character portrait, coloured deterministically from the name. */
export function VisitorAvatar({
  name,
  size = 3,
}: {
  name: string;
  size?: number;
}) {
  const h = hashOf(name);
  return (
    <PixelArt
      rows={FACE}
      size={size}
      className="avatar"
      palette={{
        H: HAIRS[h % HAIRS.length] ?? "#3a2412",
        S: SKINS[(h >> 4) % SKINS.length] ?? "#f1c9a0",
        T: SHIRTS[(h >> 8) % SHIRTS.length] ?? "#3f7fbf",
        E: "#2b1a0e",
        M: "#a24b3b",
      }}
    />
  );
}
