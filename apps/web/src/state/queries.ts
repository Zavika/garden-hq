import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type ApiError } from "../api/client";

const MINUTE = 60_000;

export function useLink() {
  return useMutation<Awaited<ReturnType<typeof api.link>>, ApiError, string>({
    mutationFn: (name) => api.link(name),
  });
}

export function useMember(profileId: string | null, uuid: string | null) {
  return useQuery({
    queryKey: ["member", profileId, uuid],
    queryFn: () => api.member(profileId as string, uuid as string),
    enabled: profileId !== null && uuid !== null,
    refetchInterval: 5 * MINUTE,
    staleTime: 5 * MINUTE,
    // Shares the Worker's per-IP limit with link + garden.
    refetchOnWindowFocus: false,
  });
}

export function useGarden(profileId: string | null) {
  return useQuery({
    queryKey: ["garden", profileId],
    queryFn: () => api.garden(profileId as string),
    enabled: profileId !== null,
    refetchInterval: MINUTE,
    staleTime: MINUTE,
    // Worker per-IP limit is shared with link; cache hits count.
    refetchOnWindowFocus: false,
  });
}

export function useContests() {
  return useQuery({
    queryKey: ["contests"],
    queryFn: () => api.contests(),
    refetchInterval: 15 * MINUTE,
    staleTime: 15 * MINUTE,
  });
}

export function useMayor() {
  return useQuery({
    queryKey: ["mayor"],
    queryFn: () => api.mayor(),
    refetchInterval: 60 * MINUTE,
    staleTime: 60 * MINUTE,
  });
}
