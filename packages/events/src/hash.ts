// SHA-512 is injected so the core never imports a platform crypto module.
//
// Node >= 19, browsers (HTTPS) and Bare with WebCrypto: use `webCryptoSha512`.
// Expo / Hermes (expo-crypto, not a dependency of this package):
//
//   import * as Crypto from "expo-crypto";
//   const sha512: Sha512 = async (bytes) =>
//     new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA512, bytes));

import { canonicalBytes } from "./canonical.js";

/** Returns the 64-byte SHA-512 digest of `bytes`. */
export type Sha512 = (bytes: Uint8Array) => Promise<Uint8Array>;

/** Lowercase hex SHA-512 of the canonical bytes of an event (128 characters). */
export type EventId = string & { readonly __brand: "EventId" };

const SHA512_HEX = /^[0-9a-f]{128}$/;

export function isEventId(value: unknown): value is EventId {
  return typeof value === "string" && SHA512_HEX.test(value);
}

export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export const webCryptoSha512: Sha512 = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("crypto.subtle is not available here; inject a Sha512 for this platform");
  }
  // Copy into a fresh ArrayBuffer-backed view: digest() rejects SharedArrayBuffer views.
  return new Uint8Array(await subtle.digest("SHA-512", new Uint8Array(bytes)));
};

/** Hex SHA-512 of `bytes`, checking that the injected function really returned 64 bytes. */
export async function sha512Hex(bytes: Uint8Array, sha512: Sha512): Promise<string> {
  const digest = await sha512(bytes);
  if (digest.length !== 64) {
    throw new Error(`injected Sha512 returned ${digest.length} bytes, expected 64`);
  }
  return toHex(digest);
}

/**
 * The event id: lowercase hex SHA-512 of the canonical UTF-8 bytes of the whole
 * envelope, `proof` included. The id is never stored inside the hashed object.
 */
export async function eventIdOf(event: unknown, sha512: Sha512): Promise<EventId> {
  return (await sha512Hex(canonicalBytes(event), sha512)) as EventId;
}
