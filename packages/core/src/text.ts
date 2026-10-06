// Minecraft formatting codes: the section sign followed by a colour/format
// character (0-9, a-f, k-o, r). A dangling trailing section sign is dropped too.
const FORMAT_CODE = /§[0-9a-fk-or]|§$/gi;

/** Removes Minecraft `§x` colour/format codes from text the API sends. */
export function stripFormatting(text: string): string {
  return text.replace(FORMAT_CODE, "");
}

/** "sugar_cane" -> "Sugar Cane". */
export function prettifyId(id: string): string {
  return id
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
