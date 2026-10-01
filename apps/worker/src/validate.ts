import { AppError } from "./errors";

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const PLAIN_UUID_RE = /^[0-9a-f]{32}$/i;
const DASHED_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseName(value: string | undefined): string {
  if (value === undefined || !NAME_RE.test(value)) {
    throw new AppError(
      "bad_request",
      "name must be 1-16 characters: letters, digits or underscore",
    );
  }
  return value;
}

/** Canonical lowercase dashed form, or null if `value` is not a UUID. */
export function toDashedUuid(value: string): string | null {
  if (DASHED_UUID_RE.test(value)) return value.toLowerCase();
  if (!PLAIN_UUID_RE.test(value)) return null;

  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseUuid(value: string | undefined): string {
  const uuid = value === undefined ? null : toDashedUuid(value);
  if (uuid === null) {
    throw new AppError("bad_request", "profile must be a valid UUID");
  }
  return uuid;
}
