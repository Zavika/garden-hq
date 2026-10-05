import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type ApiError } from "../api/client";

const MINUTE = 60_000;

export function useLink() {
  return useMutation<Awaited<ReturnType<typeof api.link>>, ApiError, string>({
    mutationFn: (name) => api.link(name),
  });
}

export function useGarden(profileId: string | null) {
  return useQuery({
    queryKey: ["garden", profileId],
    queryFn: () => api.garden(profileId as string),
    enabled: profileId !== null,
    refetchInterval: MINUTE,
  });
}

export function useContests() {
  return useQuery({
    queryKey: ["contests"],
    queryFn: () => api.contests(),
    refetchInterval: 15 * MINUTE,
  });
}

export function useMayor() {
  return useQuery({
    queryKey: ["mayor"],
    queryFn: () => api.mayor(),
    refetchInterval: 60 * MINUTE,
  });
}
