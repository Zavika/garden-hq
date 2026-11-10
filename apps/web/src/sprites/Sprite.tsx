import { useState, type ReactElement, type ReactNode } from "react";
import { PRESENT_SLOTS } from "./manifest";
import { SPRITE_SIZE, slotUrl, type SpriteSlot } from "./slots";

export function Sprite({
  slot,
  present = PRESENT_SLOTS,
  scale = 1,
  className,
  fallback,
}: {
  slot: SpriteSlot;
  present?: readonly SpriteSlot[];
  scale?: number;
  className?: string;
  fallback: ReactNode;
}): ReactElement {
  const [failedSlot, setFailedSlot] = useState<SpriteSlot | null>(null);
  if (failedSlot === slot || !present.includes(slot)) return <>{fallback}</>;
  const px = SPRITE_SIZE * Math.max(1, Math.round(scale));
  return (
    <img
      src={slotUrl(slot)}
      width={px}
      height={px}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className ? `sprite ${className}` : "sprite"}
      onError={() => setFailedSlot(slot)}
    />
  );
}
