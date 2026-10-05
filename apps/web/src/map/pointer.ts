/**
 * Touch pointers fire pointerout right after pointerup, which would clear the
 * tap-set hover (locked-plot cost) at once. Only mouse/pen drive hover enter/leave.
 */
export function tracksHover(pointerType: string): boolean {
  return pointerType !== "touch";
}
