import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { createQueryClient } from "./queryClient";
import { useGarden } from "./queries";

describe("useGarden freshness", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not refetch on remount within staleTime", async () => {
    const spy = vi
      .spyOn(api, "garden")
      .mockResolvedValue({ garden: {}, fetchedAt: "" } as never);
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useGarden("p1"), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useGarden("p1"), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
