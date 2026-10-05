import type { Contest, GardenState, Mayor, ProfileSummary } from "./types";

export type ApiErrorCode =
  | "unknown_player"
  | "no_garden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "upstream_down"
  | "missing_api_key"
  | "bad_api_key"
  | "internal";

export interface ContestsSource {
  name: string;
  url: string;
}

export interface LinkResponse {
  uuid: string;
  name: string;
  profileId: string;
  profiles: ProfileSummary[];
  fetchedAt: string;
}

export interface GardenResponse {
  garden: GardenState;
  fetchedAt: string;
}

export interface ContestsResponse {
  contests: Contest[];
  source: ContestsSource;
  fetchedAt: string;
}

export interface MayorResponse {
  mayor: Mayor;
  fetchedAt: string;
}
