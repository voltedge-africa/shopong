// Turn a 32-byte Ed25519 seed into each library's signer. Both must give the same did:key.
import * as ed from "@noble/ed25519";
import * as stablelib from "@stablelib/ed25519";
import { EdKeypair } from "@ucans/ucans";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { base58 } from "@scure/base";

export function tsUcanKeypairFromSeed(seed: Uint8Array): EdKeypair {
  const pair = stablelib.generateKeyPairFromSeed(seed);
  return new EdKeypair(pair.secretKey, pair.publicKey, false);
}

export function isoUcanSignerFromSeed(seed: Uint8Array): Promise<EdDSASigner> {
  return EdDSASigner.generate(seed);
}

/** Independent did:key encoding: multicodec ed25519-pub (0xed 0x01) + base58btc. */
export function didKeyFromPublicKey(publicKey: Uint8Array): string {
  return `did:key:z${base58.encode(new Uint8Array([0xed, 0x01, ...publicKey]))}`;
}

export async function inhouseDidFromSeed(seed: Uint8Array): Promise<string> {
  return didKeyFromPublicKey(await ed.getPublicKeyAsync(seed));
}
