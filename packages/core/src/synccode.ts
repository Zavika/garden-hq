export const SYNC_CODE_LENGTH = 32;
const CODE_RE = /^[A-Z2-7]{32}$/;

/** Uppercases and drops everything outside the base32 alphabet (spaces, dashes, 0/1/8/9). */
export function normalizeSyncCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function isSyncCode(normalized: string): boolean {
  return CODE_RE.test(normalized);
}

export function formatSyncCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join("-") ?? "";
}
