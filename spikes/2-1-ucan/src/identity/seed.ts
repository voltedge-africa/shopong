// AD-18 at the identity level: one recovery seed -> HKDF-SHA-512 with a domain-separation
// label per purpose -> a 32-byte Ed25519 seed (and, with another label, the Corestore
// `primaryKey`). Pure @noble/hashes, so it runs the same on Hermes, the browser and Node.
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export const KDF_SALT = "ocn/kdf/v1";
export const IDENTITY_LABEL = "ocn/identity/ed25519/v1";
export const PRIMARY_KEY_LABEL = "ocn/corestore/primary-key/v1";

/** Derive `length` bytes for one purpose from the recovery seed (BIP-39 seed bytes or raw entropy). */
export function deriveKey(recoverySeed: Uint8Array, label: string, length = 32): Uint8Array {
  if (recoverySeed.length < 16) throw new RangeError("recovery seed must be at least 128 bits");
  return hkdf(sha512, recoverySeed, utf8ToBytes(KDF_SALT), utf8ToBytes(label), length);
}

export function identitySeed(recoverySeed: Uint8Array): Uint8Array {
  return deriveKey(recoverySeed, IDENTITY_LABEL);
}
