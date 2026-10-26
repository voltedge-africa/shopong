// Keys for the record, all derived from the Node's master key (AD-18 spirit: the Node derives, a restore reproduces).
// Nothing here reads the clock, the environment or the network; the same master key and inputs give the same keys.

import { createHmac, createPrivateKey, createPublicKey } from "node:crypto";
import { createRequire } from "node:module";
import type { Did } from "@shopong/ports";

// The Hyper packages ship no type declarations. They are loaded here and typed by hand, for the
// few calls this package makes.
const requireCjs = createRequire(import.meta.url);
const Hypercore = requireCjs("hypercore") as {
  key(manifest: { version: number; signers: { publicKey: Buffer }[] }): Buffer;
};

/** A key pair in the libsodium layout Hypercore expects: 32-byte public key, 64-byte secret key (seed || public). */
export interface WriterKeyPair {
  readonly publicKey: Buffer;
  readonly secretKey: Buffer;
}

/** DER prefix of an Ed25519 PKCS#8 private key; the 32-byte seed follows it. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Labels keep the derivations apart: a writer key is never a corestore key, nor a key for another space. */
export const CORESTORE_LABEL = "ocn/record/v1/corestore";
export const WRITER_LABEL = "ocn/record/v1/writer";

function derive(master: Uint8Array, label: string): Buffer {
  return createHmac("sha512", master).update(label, "utf8").digest().subarray(0, 32);
}

/** The Corestore primary key. A different master key on existing storage is refused by Corestore. */
export function corestorePrimaryKey(master: Uint8Array): Buffer {
  return derive(master, CORESTORE_LABEL);
}

/**
 * The Autobase writer key pair of a member in one space: HMAC-SHA512 of the master key over the
 * space key and the member's DID, used as an Ed25519 seed. Every replica of a space derives the
 * same public key, so the admitting `apply` can name it without a secret.
 */
export function writerKeyPair(master: Uint8Array, spaceKey: string, did: Did): WriterKeyPair {
  const seed = derive(master, `${WRITER_LABEL}\n${spaceKey}\n${did}`);
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = Buffer.from(
    createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32),
  );
  return { publicKey, secretKey: Buffer.concat([seed, publicKey]) };
}

/**
 * The Hypercore key of a member's writer core in one space. Autobase boots a key pair as a core whose key
 * is the hash of its manifest (signer = the public key), so an admitting `apply` must name that hash.
 */
export function writerCoreKey(
  master: Uint8Array,
  spaceKey: string,
  did: Did,
  manifestVersion: number,
): Buffer {
  const { publicKey } = writerKeyPair(master, spaceKey, did);
  return Hypercore.key({ version: manifestVersion, signers: [{ publicKey }] });
}
