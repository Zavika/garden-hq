import { decodeBase64Url } from "../base64url";
import { isAllowedPushEndpoint } from "../alerts/push";
import type { Env } from "../env";
import { logError, logUpstream } from "../log";
import { discardBody } from "../http";
import type { SendResult } from "./discord";

/** WebCrypto only: RFC 8291 (message encryption) and RFC 8292 (VAPID). */

const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 86; // salt 16 + rs 4 + idlen 1 + keyid 65
/** RFC 8291 section 4: push services accept at least 4096 octets of body. */
const MAX_PLAINTEXT = RECORD_SIZE - HEADER_LENGTH - TAG_LENGTH - 1; // 3993
const MAX_JWT_CACHE = 64;
const JWT_LIFETIME_MS = 12 * 60 * 60 * 1000;
const JWT_REFRESH_MARGIN_MS = 60 * 60 * 1000;
const PUSH_TTL_SECONDS = 3600;
const MAX_TITLE = 80;
const MAX_BODY = 200;
const MAX_TAG = 64;

const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array | null {
  return decodeBase64Url(value, Infinity);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte scalar d. */
  privateKey: string;
  subject: string;
}

function hasLength(value: string | undefined, length: number): boolean {
  if (value === undefined) return false;
  const bytes = fromBase64Url(value);
  return bytes !== null && bytes.length === length;
}

function isValidSubject(value: string): boolean {
  if (value.startsWith("mailto:"))
    return /^mailto:[^\s@]+@[^\s@]+$/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
}

/** null when the keys are missing or malformed, or no valid subject exists. */
export function vapidFromEnv(env: Env): VapidKeys | null {
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return null;
  if (!hasLength(pub, 65) || !hasLength(priv, 32)) return null;
  if (fromBase64Url(pub)?.[0] !== 0x04) return null;
  const subject = env.VAPID_SUBJECT?.trim() || env.WEB_ORIGIN?.trim();
  if (!subject || !isValidSubject(subject)) return null;
  return { publicKey: pub, privateKey: priv, subject };
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Test hooks only. */
export interface EncryptOptions {
  ephemeral?: CryptoKeyPair;
  salt?: Uint8Array;
}

/** workers-types names this field `$public`; the runtime (and the spec) call it `public`. */
function ecdhParams(peer: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  return {
    name: "ECDH",
    public: peer,
  } as unknown as SubtleCryptoDeriveKeyAlgorithm;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** RFC 8291 aes128gcm body: salt(16) || rs(4) || idlen(1) || keyid(65) || ciphertext. */
export async function encryptPayload(
  target: PushTarget,
  plaintext: Uint8Array,
  opts: EncryptOptions = {},
): Promise<Uint8Array> {
  const uaPublic = fromBase64Url(target.p256dh);
  const authSecret = fromBase64Url(target.auth);
  if (
    uaPublic === null ||
    uaPublic.length !== 65 ||
    uaPublic[0] !== 0x04 ||
    authSecret === null ||
    authSecret.length !== 16
  ) {
    throw new Error("bad subscription keys");
  }
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new Error("payload too large");
  }
  if (opts.salt !== undefined && opts.salt.length !== 16) {
    throw new Error("bad salt");
  }
  const ephemeral =
    opts.ephemeral ??
    ((await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    )) as CryptoKeyPair);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      ecdhParams(uaKey),
      ephemeral.privateKey,
      256,
    ),
  );
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(
    salt,
    ikm,
    enc.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    enc.encode("Content-Encoding: nonce\0"),
    12,
  );
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  const record = concat(plaintext, new Uint8Array([0x02]));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record),
  );
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

const jwtCache = new Map<string, { token: string; expMs: number }>();

async function importVapidPrivate(vapid: VapidKeys): Promise<CryptoKey> {
  const point = fromBase64Url(vapid.publicKey);
  if (point === null || point.length !== 65) throw new Error("bad vapid key");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: toBase64Url(point.slice(1, 33)),
      y: toBase64Url(point.slice(33, 65)),
      d: vapid.privateKey,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** "vapid t=<jwt>, k=<publicKey>", cached per audience until 1 h before expiry. */
export async function vapidAuthorization(
  vapid: VapidKeys,
  audience: string,
  nowMs: number,
): Promise<string> {
  const cacheKey = `${vapid.publicKey}|${vapid.subject}|${audience}`;
  const hit = jwtCache.get(cacheKey);
  if (hit !== undefined && nowMs < hit.expMs - JWT_REFRESH_MARGIN_MS) {
    return `vapid t=${hit.token}, k=${vapid.publicKey}`;
  }
  const expMs = nowMs + JWT_LIFETIME_MS;
  const part = (v: object) => toBase64Url(enc.encode(JSON.stringify(v)));
  const signingInput = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: audience,
    exp: Math.floor(expMs / 1000),
    sub: vapid.subject,
  })}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      await importVapidPrivate(vapid),
      enc.encode(signingInput),
    ),
  );
  const token = `${signingInput}.${toBase64Url(sig)}`;
  for (const [k, v] of jwtCache) if (v.expMs <= nowMs) jwtCache.delete(k);
  while (jwtCache.size >= MAX_JWT_CACHE) {
    const oldest = jwtCache.keys().next();
    if (oldest.done) break;
    jwtCache.delete(oldest.value);
  }
  jwtCache.set(cacheKey, { token, expMs });
  return `vapid t=${token}, k=${vapid.publicKey}`;
}

export function pushPayload(
  text: { title: string; detail: string },
  tag: string,
): { title: string; body: string; tag: string; url: string } {
  return {
    title: text.title.slice(0, MAX_TITLE),
    body: text.detail.slice(0, MAX_BODY),
    tag: tag.slice(0, MAX_TAG),
    url: "/",
  };
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get("Retry-After");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}

/** One encrypted push. Never logs the endpoint (it is a capability URL). */
export async function sendPush(
  fetchFn: typeof fetch,
  target: PushTarget,
  payload: object,
  vapid: VapidKeys,
  nowMs: number,
): Promise<SendResult> {
  if (!isAllowedPushEndpoint(target.endpoint)) return { kind: "dead" };
  const url = new URL(target.endpoint);
  let body: Uint8Array;
  try {
    body = await encryptPayload(target, enc.encode(JSON.stringify(payload)));
  } catch {
    // Bad stored keys or an oversized payload never get better: drop the subscription.
    return { kind: "dead" };
  }
  let authorization: string;
  try {
    authorization = await vapidAuthorization(vapid, url.origin, nowMs);
  } catch {
    logError("vapid_sign_failed");
    return { kind: "rejected", status: 0 };
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchFn(target.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: "normal",
        Authorization: authorization,
      },
      body,
      redirect: "manual",
    });
  } catch {
    logUpstream({
      host: url.hostname,
      path: "/push/:subscription",
      status: "error",
      ms: Date.now() - started,
    });
    return { kind: "retry", retryAfterSeconds: null };
  }
  logUpstream({
    host: url.hostname,
    path: "/push/:subscription",
    status: res.status,
    ms: Date.now() - started,
  });
  discardBody(res);
  if (res.ok) return { kind: "sent" };
  if (res.status === 404 || res.status === 410) return { kind: "dead" };
  if (res.status === 429) {
    return { kind: "retry", retryAfterSeconds: retryAfter(res) };
  }
  if (res.status >= 500) return { kind: "retry", retryAfterSeconds: null };
  return { kind: "rejected", status: res.status };
}

export async function generateVapidKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  const x = fromBase64Url(jwk.x ?? "");
  const y = fromBase64Url(jwk.y ?? "");
  if (x === null || y === null || jwk.d === undefined) {
    throw new Error("key export failed");
  }
  return {
    publicKey: toBase64Url(concat(new Uint8Array([0x04]), x, y)),
    privateKey: jwk.d,
  };
}
