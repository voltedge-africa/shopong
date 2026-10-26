// Test-only HMAC-SHA512 via Web Crypto. Production code injects an audited HMAC (AGENTS rule 6).
import type { HmacSha512 } from "@shopong/events";

export const webCryptoHmac: HmacSha512 = async (key, message) => {
  const k = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array(message)));
};
