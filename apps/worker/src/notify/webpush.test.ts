import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import {
  encryptPayload,
  fromBase64Url,
  generateVapidKeys,
  pushPayload,
  sendPush,
  toBase64Url,
  vapidAuthorization,
  vapidFromEnv,
  type VapidKeys,
} from "./webpush";

// RFC 8291 Appendix A: public documentation vectors, not secrets.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

function bytes(b64: string): Uint8Array {
  const out = fromBase64Url(b64);
  if (out === null) throw new Error("bad base64url");
  return out;
}

async function jwkPair(pub: string, priv: string): Promise<CryptoKeyPair> {
  const p = bytes(pub);
  const x = toBase64Url(p.slice(1, 33));
  const y = toBase64Url(p.slice(33));
  return {
    publicKey: await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y },
      ECDH,
      true,
      [],
    ),
    privateKey: await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x, y, d: priv },
      ECDH,
      true,
      ["deriveBits"],
    ),
  };
}

/** Test-side user agent: RFC 8291 section 3.4 decryption. */
async function decrypt(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublic: Uint8Array,
  auth: Uint8Array,
): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idlen = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, ECDH, false, []);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: asKey,
      } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      uaPrivate,
      256,
    ),
  );
  const te = new TextEncoder();
  const derive = async (
    s: Uint8Array,
    ikm: Uint8Array,
    info: Uint8Array,
    n: number,
  ) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
          "deriveBits",
        ]),
        n * 8,
      ),
    );
  const keyInfo = new Uint8Array([
    ...te.encode("WebPush: info\0"),
    ...uaPublic,
    ...asPublic,
  ]);
  const ikm = await derive(auth, ecdh, keyInfo, 32);
  const cek = await derive(
    salt,
    ikm,
    te.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await derive(
    salt,
    ikm,
    te.encode("Content-Encoding: nonce\0"),
    12,
  );
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher),
  );
  expect(record[record.length - 1]).toBe(0x02);
  return record.slice(0, -1);
}

describe("encryptPayload", () => {
  it("reproduces the RFC 8291 Appendix A example byte for byte", async () => {
    const out = await encryptPayload(
      {
        endpoint: "https://fcm.googleapis.com/x",
        p256dh: RFC.uaPublic,
        auth: RFC.auth,
      },
      new TextEncoder().encode(RFC.plaintext),
      {
        ephemeral: await jwkPair(RFC.asPublic, RFC.asPrivate),
        salt: bytes(RFC.salt),
      },
    );
    expect(toBase64Url(out)).toBe(RFC.body);
  });

  it("round-trips with a random ephemeral key and rejects tampering", async () => {
    const ua = await jwkPair(RFC.uaPublic, RFC.uaPrivate);
    const target = {
      endpoint: "https://fcm.googleapis.com/x",
      p256dh: RFC.uaPublic,
      auth: RFC.auth,
    };
    const plain = new TextEncoder().encode("hello garden");
    const body = await encryptPayload(target, plain);
    const back = await decrypt(
      body,
      ua.privateKey,
      bytes(RFC.uaPublic),
      bytes(RFC.auth),
    );
    expect(new TextDecoder().decode(back)).toBe("hello garden");
    for (let i = 86; i < body.length; i++) {
      const bad = body.slice();
      bad[i] = (bad[i] ?? 0) ^ 1;
      await expect(
        decrypt(bad, ua.privateKey, bytes(RFC.uaPublic), bytes(RFC.auth)),
      ).rejects.toBeDefined();
    }
  });

  const T = {
    endpoint: "https://fcm.googleapis.com/x",
    p256dh: RFC.uaPublic,
    auth: RFC.auth,
  };

  it("accepts 3993 plaintext bytes and rejects 3994", async () => {
    const ok = await encryptPayload(T, new Uint8Array(3993));
    expect(ok.length).toBeLessThanOrEqual(4096);
    await expect(encryptPayload(T, new Uint8Array(3994))).rejects.toThrow();
  });

  it("rejects a salt that is not 16 bytes and bad subscription keys", async () => {
    await expect(
      encryptPayload(T, new Uint8Array(1), { salt: new Uint8Array(17) }),
    ).rejects.toThrow();
    await expect(
      encryptPayload(
        { ...T, auth: toBase64Url(new Uint8Array(15)) },
        new Uint8Array(1),
      ),
    ).rejects.toThrow();
    const notUncompressed = new Uint8Array(65).fill(1);
    await expect(
      encryptPayload(
        { ...T, p256dh: toBase64Url(notUncompressed) },
        new Uint8Array(1),
      ),
    ).rejects.toThrow();
  });
});

async function testVapid(
  subject = "https://garden.example",
): Promise<VapidKeys> {
  return { ...(await generateVapidKeys()), subject };
}

describe("generateVapidKeys", () => {
  it("makes a 65-byte public and 32-byte private key that sign and verify", async () => {
    const k = await generateVapidKeys();
    expect(bytes(k.publicKey)).toHaveLength(65);
    expect(bytes(k.publicKey)[0]).toBe(0x04);
    expect(bytes(k.privateKey)).toHaveLength(32);
    const v = { ...k, subject: "https://garden.example" };
    const auth = await vapidAuthorization(v, "https://a.example", 1_000_000);
    expect(auth).toContain(`k=${k.publicKey}`);
  });
});

describe("vapidAuthorization", () => {
  it("signs a valid ES256 JWT, caches per audience and re-signs after the horizon", async () => {
    const v = await testVapid();
    const now = 1_700_000_000_000;
    const aud = "https://fcm.googleapis.com";
    const header = await vapidAuthorization(v, aud, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m ?? [];
    expect(k).toBe(v.publicKey);
    const dec = (x: string | undefined) =>
      JSON.parse(new TextDecoder().decode(bytes(x ?? ""))) as Record<
        string,
        unknown
      >;
    expect(dec(h)).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = dec(c);
    expect(claims.aud).toBe(aud);
    expect(claims.sub).toBe("https://garden.example");
    const exp = Number(claims.exp);
    expect(exp * 1000).toBeGreaterThan(now);
    expect(exp * 1000).toBeLessThanOrEqual(now + 24 * 3600_000);
    const pub = bytes(v.publicKey);
    const key = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: toBase64Url(pub.slice(1, 33)),
        y: toBase64Url(pub.slice(33)),
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(bytes(s ?? "")).toHaveLength(64);
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        bytes(s ?? ""),
        new TextEncoder().encode(`${h}.${c}`),
      ),
    ).toBe(true);

    expect(await vapidAuthorization(v, aud, now + 3600_000)).toBe(header);
    const later = await vapidAuthorization(
      v,
      aud,
      now + 12 * 3600_000 - 3600_000,
    );
    expect(later).not.toBe(header);
    expect(await vapidAuthorization(v, "https://other.example", now)).not.toBe(
      header,
    );
  });
});

describe("sendPush", () => {
  afterEach(() => vi.restoreAllMocks());

  const ENDPOINT = "https://fcm.googleapis.com/fcm/send/secret-token-123";

  async function setup(res: Response | Error) {
    const ua = await jwkPair(RFC.uaPublic, RFC.uaPrivate);
    void ua;
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (res instanceof Error) throw res;
      return res;
    }) as typeof fetch;
    return {
      fn,
      calls,
      target: { endpoint: ENDPOINT, p256dh: RFC.uaPublic, auth: RFC.auth },
      vapid: await testVapid(),
    };
  }

  it("sends on 201 with exactly the specified headers and an encrypted body", async () => {
    const s = await setup(new Response(null, { status: 201 }));
    const r = await sendPush(
      s.fn,
      s.target,
      { title: "t" },
      s.vapid,
      1_700_000_000_000,
    );
    expect(r).toEqual({ kind: "sent" });
    const init = s.calls[0]?.init;
    expect(s.calls[0]?.url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    const h = init?.headers as Record<string, string>;
    expect(Object.keys(h).sort()).toEqual(
      ["Authorization", "Content-Encoding", "TTL", "Urgency"].sort(),
    );
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe("3600");
    expect(h.Urgency).toBe("normal");
    expect(h.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect((init?.body as Uint8Array).length).toBeGreaterThan(86);
  });

  it("any 2xx counts as sent", async () => {
    for (const status of [200, 202]) {
      const s = await setup(new Response(null, { status }));
      expect(await sendPush(s.fn, s.target, {}, s.vapid, 1)).toEqual({
        kind: "sent",
      });
    }
  });

  it("classifies local failures without fetching", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = await setup(new Response(null, { status: 201 }));
    const offCurve = toBase64Url(
      new Uint8Array([4, ...new Uint8Array(64).fill(1)]),
    );
    expect(
      await sendPush(s.fn, { ...s.target, p256dh: offCurve }, {}, s.vapid, 1),
    ).toEqual({ kind: "dead" });
    expect(
      await sendPush(s.fn, s.target, { x: "a".repeat(5000) }, s.vapid, 1),
    ).toEqual({ kind: "dead" });
    const badKey = {
      ...s.vapid,
      privateKey: toBase64Url(new Uint8Array(32).fill(255)),
    };
    expect(await sendPush(s.fn, s.target, {}, badKey, 1)).toEqual({
      kind: "rejected",
      status: 0,
    });
    expect(err.mock.calls.join(" ")).toContain("vapid_sign_failed");
    expect(err.mock.calls.join(" ")).not.toContain(badKey.privateKey);
    expect(s.calls).toHaveLength(0);
  });

  it.each([404, 410])("%i is dead", async (status) => {
    const s = await setup(new Response(null, { status }));
    expect(await sendPush(s.fn, s.target, {}, s.vapid, 1)).toEqual({
      kind: "dead",
    });
  });

  it("429 honours Retry-After", async () => {
    const s = await setup(
      new Response(null, { status: 429, headers: { "Retry-After": "30" } }),
    );
    expect(await sendPush(s.fn, s.target, {}, s.vapid, 1)).toEqual({
      kind: "retry",
      retryAfterSeconds: 30,
    });
  });

  it("5xx and network errors retry", async () => {
    const a = await setup(new Response(null, { status: 500 }));
    expect(await sendPush(a.fn, a.target, {}, a.vapid, 1)).toEqual({
      kind: "retry",
      retryAfterSeconds: null,
    });
    const b = await setup(new Error("boom " + ENDPOINT));
    expect(await sendPush(b.fn, b.target, {}, b.vapid, 1)).toEqual({
      kind: "retry",
      retryAfterSeconds: null,
    });
  });

  it.each([400, 401, 403, 413])("%i is rejected", async (status) => {
    const s = await setup(new Response(null, { status }));
    expect(await sendPush(s.fn, s.target, {}, s.vapid, 1)).toEqual({
      kind: "rejected",
      status,
    });
  });

  it("a disallowed endpoint is dead and never fetched", async () => {
    const s = await setup(new Response(null, { status: 201 }));
    const r = await sendPush(
      s.fn,
      { ...s.target, endpoint: "https://evil.example/x" },
      {},
      s.vapid,
      1,
    );
    expect(r).toEqual({ kind: "dead" });
    expect(s.calls).toHaveLength(0);
  });

  it("never logs the endpoint", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = await setup(new Error("boom " + ENDPOINT));
    const r = await sendPush(s.fn, s.target, {}, s.vapid, 1);
    expect(r.kind).toBe("retry");
    for (const status of [201, 400, 429, 500]) {
      const x = await setup(new Response(null, { status }));
      await sendPush(x.fn, x.target, {}, x.vapid, 1);
    }
    const out = JSON.stringify([log.mock.calls, err.mock.calls]);
    expect(out).not.toContain("secret-token-123");
  });
});

describe("vapidFromEnv", () => {
  async function env(extra: Partial<Env> = {}): Promise<Env> {
    const k = await generateVapidKeys();
    return {
      VAPID_PUBLIC_KEY: k.publicKey,
      VAPID_PRIVATE_KEY: k.privateKey,
      WEB_ORIGIN: "https://garden.example",
      ...extra,
    } as Env;
  }

  it("defaults the subject to WEB_ORIGIN", async () => {
    expect(vapidFromEnv(await env())?.subject).toBe("https://garden.example");
  });

  it("falls back to WEB_ORIGIN for an empty subject and trims keys", async () => {
    const e = await env({ VAPID_SUBJECT: "  " });
    expect(vapidFromEnv(e)?.subject).toBe("https://garden.example");
    const padded = {
      ...e,
      VAPID_PUBLIC_KEY: ` ${e.VAPID_PUBLIC_KEY ?? ""}
`,
    };
    expect(vapidFromEnv(padded)?.publicKey).toBe(e.VAPID_PUBLIC_KEY);
  });

  it("accepts an https subject and rejects garbage", async () => {
    expect(
      vapidFromEnv(await env({ VAPID_SUBJECT: "https://me.example/contact" }))
        ?.subject,
    ).toBe("https://me.example/contact");
    expect(vapidFromEnv(await env({ VAPID_SUBJECT: "not a url" }))).toBeNull();
    expect(
      vapidFromEnv(await env({ VAPID_SUBJECT: "http://x.example" })),
    ).toBeNull();
  });

  it("is null for missing, short, long or non-base64url keys", async () => {
    const e = await env();
    expect(vapidFromEnv({ ...e, VAPID_PUBLIC_KEY: undefined })).toBeNull();
    expect(vapidFromEnv({ ...e, VAPID_PRIVATE_KEY: undefined })).toBeNull();
    expect(vapidFromEnv({ ...e, VAPID_PRIVATE_KEY: "abc" })).toBeNull();
    expect(
      vapidFromEnv({
        ...e,
        VAPID_PRIVATE_KEY: `${e.VAPID_PRIVATE_KEY ?? ""}AA`,
      }),
    ).toBeNull();
    expect(
      vapidFromEnv({ ...e, VAPID_PUBLIC_KEY: `${e.VAPID_PUBLIC_KEY ?? ""}AA` }),
    ).toBeNull();
    expect(
      vapidFromEnv({ ...e, VAPID_PUBLIC_KEY: "!!".repeat(44) }),
    ).toBeNull();
  });
});

describe("pushPayload", () => {
  it("truncates and keeps the tag within 64 chars", () => {
    const p = pushPayload(
      { title: "t".repeat(500), detail: "d".repeat(2000) },
      "x".repeat(200),
    );
    expect(p.title).toHaveLength(80);
    expect(p.body).toHaveLength(200);
    expect(p.tag).toHaveLength(64);
    expect(p.url).toBe("/");
  });
});
