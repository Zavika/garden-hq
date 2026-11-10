import type { ProgressEvent } from "@garden-hq/core";
import { create } from "zustand";

interface ProgressEventsState {
  events: ProgressEvent[];
  push: (events: ProgressEvent[]) => void;
  clear: () => void;
}

/** Stable identity of an event; used for React keys and to drop duplicates. */
export function eventKey(event: ProgressEvent): string {
  switch (event.type) {
    case "quest_done":
      return `quest_done:${event.day}:${event.slot}`;
    case "achievement":
      return `achievement:${event.id}`;
    case "backfill":
      return "backfill";
  }
}

export const useProgressEvents = create<ProgressEventsState>((set) => ({
  events: [],
  push: (events) =>
    set((s) => {
      const seen = new Set(s.events.map(eventKey));
      const fresh: ProgressEvent[] = [];
      for (const e of events) {
        const key = eventKey(e);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(e);
      }
      if (fresh.length === 0) return s;
      return { events: [...s.events, ...fresh].slice(-20) };
    }),
  clear: () => set({ events: [] }),
}));
