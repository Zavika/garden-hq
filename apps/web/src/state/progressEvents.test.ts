import { beforeEach, describe, expect, it } from "vitest";
import { useProgressEvents } from "./progressEvents";

describe("useProgressEvents", () => {
  beforeEach(() => useProgressEvents.getState().clear());

  it("ignores an event whose key is already present", () => {
    const e = {
      type: "quest_done",
      day: "2026-11-10",
      slot: 0,
      xp: 25,
    } as const;
    useProgressEvents.getState().push([e]);
    useProgressEvents.getState().push([e]);
    expect(useProgressEvents.getState().events).toHaveLength(1);
  });

  it("keeps distinct events and caps at 20", () => {
    for (let i = 0; i < 25; i++) {
      useProgressEvents
        .getState()
        .push([{ type: "achievement", id: `a${i}`, xp: 1 }]);
    }
    expect(useProgressEvents.getState().events).toHaveLength(20);
  });
});
