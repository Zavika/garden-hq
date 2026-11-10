import type { AlertRules } from "./alerts";
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

export interface AlertsStateResponse {
  hasWebhook: boolean;
  /** Last 4 characters of the webhook token; the URL itself is never returned. */
  webhookLast4: string | null;
  /** null until a test message has been sent; false when Discord says the webhook is gone. */
  webhookOk: boolean | null;
  /** null until the first successful test message. */
  rules: AlertRules | null;
  push: {
    /** false until the server has VAPID keys configured. */
    available: boolean;
    /** VAPID public key (base64url) for subscribing; null when unavailable. */
    publicKey: string | null;
    /** Number of subscribed devices (0-3). */
    devices: number;
    /** null until a test push was sent; true once one went through. */
    pushOk: boolean | null;
  };
}

export interface AlertTestResponse extends AlertsStateResponse {
  test: "sent" | "failed" | "dead";
}

/** POST /api/alerts/push/test: "dead" means every device was gone and has been removed. */
export type PushTestResponse = AlertTestResponse;
