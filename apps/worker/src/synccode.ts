const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const SYNC_CODE_BYTES = 20; // 160 bits

/** RFC 4648 base32, no padding. */
export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function generateSyncCode(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(SYNC_CODE_BYTES)));
}

/** Lowercase hex SHA-256 of a normalized sync code. */
export async function hashSyncCode(normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
