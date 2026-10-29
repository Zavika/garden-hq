import {
  isSyncCode,
  normalizeSyncCode,
  type ProfileSummary,
} from "@garden-hq/core";
import type { Env } from "./env";
import { AppError } from "./errors";
import { MS_PER_DAY } from "./limits";
import { CODE_FAILURE_COST, pickCodeLimiter } from "./ratelimit";
import { hashSyncCode } from "./synccode";

export interface AccountRow {
  id: string;
  mcUuid: string;
  mcName: string;
  profileId: string;
  profiles: ProfileSummary[];
  tz: string;
  revision: number;
  /** UTC day number of the last write-budget bump. */
  opsDay: number;
  /** Ops applied on `opsDay`. */
  opsCount: number;
  /** Last authenticated activity (bumped at most once per day). */
  lastSeenAt: number;
}

export interface DbAccount {
  id: string;
  mc_uuid: string;
  mc_name: string;
  profile_id: string;
  profiles: string;
  tz: string;
  revision: number;
  ops_day: number;
  ops_count: number;
  last_seen_at: number;
}

export const ACCOUNT_COLUMNS =
  "id, mc_uuid, mc_name, profile_id, profiles, tz, revision, ops_day, ops_count, last_seen_at";

export function toAccountRow(row: DbAccount): AccountRow {
  return {
    id: row.id,
    mcUuid: row.mc_uuid,
    mcName: row.mc_name,
    profileId: row.profile_id,
    profiles: parseProfiles(row.profiles),
    tz: row.tz,
    revision: row.revision,
    opsDay: row.ops_day,
    opsCount: row.ops_count,
    lastSeenAt: row.last_seen_at,
  };
}

function isProfileSummary(v: unknown): v is ProfileSummary {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.profileId === "string" &&
    typeof o.name === "string" &&
    typeof o.selected === "boolean"
  );
}

function parseProfiles(json: string): ProfileSummary[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isProfileSummary) : [];
  } catch {
    return [];
  }
}

/**
 * Resolves the account for a `Authorization: Bearer <sync code>` header.
 * The code is never logged or echoed. A malformed value is not a code, so it
 * is rejected before the limiter and DB are touched.
 */
export async function authenticate(
  c: { env: Env; req: { header(n: string): string | undefined } },
  now: () => number,
): Promise<AccountRow> {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const code = match?.[1] === undefined ? "" : normalizeSyncCode(match[1]);
  if (!isSyncCode(code)) {
    throw new AppError("unauthorized", "Missing or malformed sync code");
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const limiter = pickCodeLimiter(c.env, now);
  const first = await limiter.allow(`code:${ip}`);
  if (!first.ok) {
    throw new AppError(
      "rate_limited",
      "Too many sync attempts — retry shortly",
      first.retryAfter,
    );
  }

  const row = await c.env.DB.prepare(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE code_hash = ?1`,
  )
    .bind(await hashSyncCode(code))
    .first<DbAccount>();

  if (row === null) {
    for (let i = 0; i < CODE_FAILURE_COST; i++) {
      await limiter.allow(`code:${ip}`);
    }
    throw new AppError("unauthorized", "Unknown sync code");
  }
  const t = now();
  if (t - row.last_seen_at >= MS_PER_DAY) {
    // Any authenticated request is activity; at most one write per account per day.
    try {
      await c.env.DB.prepare(
        "UPDATE accounts SET last_seen_at = ?2 WHERE id = ?1",
      )
        .bind(row.id, t)
        .run();
      row.last_seen_at = t;
    } catch {
      // Best effort: a failed activity bump must not fail the request.
    }
  }
  return toAccountRow(row);
}
