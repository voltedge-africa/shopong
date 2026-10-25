// AD-18 at the identity level: one recovery seed -> HKDF-SHA-512 with a domain-separation label per
// purpose -> a 32-byte Ed25519 seed (and, with another label, the Corestore `primaryKey`). Pure
// @noble/hashes, so it runs the same on Hermes, the browser and Node.
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export const KDF_SALT = "ocn/kdf/v1";
export const IDENTITY_LABEL = "ocn/identity/ed25519/v1";
export const PRIMARY_KEY_LABEL = "ocn/corestore/primary-key/v1";

export const RECOVERY_SEED_BYTES = 32;

/** Derive `length` bytes for one purpose from the recovery seed. */
export function deriveKey(recoverySeed: Uint8Array, label: string, length = 32): Uint8Array {
  if (recoverySeed.length < 16) throw new RangeError("recovery seed must be at least 128 bits");
  return hkdf(sha512, recoverySeed, utf8ToBytes(KDF_SALT), utf8ToBytes(label), length);
}

/** The 32-byte Ed25519 seed for this person's DID. */
export function identitySeed(recoverySeed: Uint8Array): Uint8Array {
  return deriveKey(recoverySeed, IDENTITY_LABEL);
}

const HEX = /^[0-9a-f]+$/;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bytes from a hex string, or `null` unless it is exactly `byteLength` bytes of lowercase hex. */
export function fromHex(hex: string, byteLength: number): Uint8Array | null {
  if (hex.length !== byteLength * 2 || !HEX.test(hex)) return null;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** `did:key:z6Mkmtmq…VouVZtL`: the first 12 characters of the key part and the last 6. */
export function shortDid(did: string): string {
  const prefix = "did:key:";
  if (!did.startsWith(prefix)) return did;
  const key = did.slice(prefix.length);
  if (key.length <= 18) return did;
  return `${prefix}${key.slice(0, 12)}…${key.slice(-6)}`;
}
