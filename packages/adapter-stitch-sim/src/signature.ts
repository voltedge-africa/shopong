// The simulated webhook signature: HMAC-SHA512 over the raw body, as 128 lowercase hex characters, under the
// Node-only webhook key. The HMAC is injected (the Node passes its own), as the commitments are.
import type { HmacSha512 } from "@shopong/events";

/** The header a simulated delivery carries its signature in. Names are lowercased. */
export const SIGNATURE_HEADER = "x-simulated-signature";

const HEX_SHA512 = /^[0-9a-f]{128}$/u;

/** The signature for `body` under `key`, as lowercase hex. */
export async function signBody(hmac: HmacSha512, key: Uint8Array, body: string): Promise<string> {
  const mac = await hmac(key, new TextEncoder().encode(body));
  if (mac.length !== 64)
    throw new Error("simulated Stitch: the injected HMAC did not return 64 bytes");
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings in time that depends only on their length. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** True only when the delivery carries a well-formed signature that matches its raw body. */
export async function signatureValid(
  hmac: HmacSha512,
  key: Uint8Array,
  headers: { readonly [name: string]: string },
  body: string,
): Promise<boolean> {
  const given = headers[SIGNATURE_HEADER];
  if (given === undefined || !HEX_SHA512.test(given)) return false;
  return constantTimeEqual(given, await signBody(hmac, key, body));
}
