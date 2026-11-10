// Prints a fresh VAPID key pair to the terminal. Writes nothing to disk.
// Run: pnpm vapid:generate  (node --experimental-strip-types)
// Self-contained on purpose: Node's type stripping needs explicit import extensions.

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
if (jwk.x === undefined || jwk.y === undefined || jwk.d === undefined) {
  throw new Error("key export failed");
}
const point = new Uint8Array(
  await crypto.subtle.exportKey("raw", pair.publicKey),
);

console.log(`VAPID_PUBLIC_KEY=${b64url(point)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("");
console.log("Set them with:");
console.log(
  "  pnpm --filter @garden-hq/worker exec wrangler secret put VAPID_PUBLIC_KEY   (paste the public key)",
);
console.log(
  "  pnpm --filter @garden-hq/worker exec wrangler secret put VAPID_PRIVATE_KEY  (paste the private key)",
);
console.log(
  "Never commit these. Rotating them invalidates every push subscription.",
);
