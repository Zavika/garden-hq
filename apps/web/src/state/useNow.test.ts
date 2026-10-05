import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time and ticks once per interval", () => {
    const { result } = renderHook(() => useNow(1000));
    const start = result.current;
    expect(start).toBe(Date.parse("2026-10-05T10:00:00Z"));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(start + 3000);
  });

  it("stops ticking after unmount", () => {
    const { result, unmount } = renderHook(() => useNow(1000));
    unmount();
    const frozen = result.current;
    vi.advanceTimersByTime(5000);
    expect(result.current).toBe(frozen);
  });
});
