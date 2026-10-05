import type { GardenState } from "@garden-hq/core";

export interface MapSectionProps {
  garden: GardenState;
  assignments: Record<string, string>;
}

/** Stub: replaced by the PixiJS map in Task 12. */
export function MapSection(props: MapSectionProps) {
  void props;
  return null;
}
