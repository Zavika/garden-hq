import type { StoredData } from "./sync";
import type {
  Contest,
  GardenMemberState,
  GardenState,
  Mayor,
  ProfileSummary,
} from "./types";

export type ApiErrorCode =
  | "unknown_player"
  | "no_garden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "upstream_down"
  | "missing_api_key"
  | "bad_api_key"
  | "unauthorized"
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

export interface MemberResponse {
  member: GardenMemberState;
  fetchedAt: string;
}

export interface SyncStateResponse extends StoredData {
  revision: number;
  /** POST /api/sync only: ops the server skipped as invalid (omitted when none). */
  rejected?: number;
}

export interface AccountCreateResponse {
  syncCode: string;
}
