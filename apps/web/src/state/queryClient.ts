import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry } },
  });
}
