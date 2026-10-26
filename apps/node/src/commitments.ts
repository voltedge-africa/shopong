// The Node's `Commitments` (story 2.7). The community secrets are held here, in the process, loaded from the
// secret registry (`COMMUNITY_SECRET`, see `secrets.ts`); nothing else holds them and no response carries them.
// The HMAC is Node's built-in `crypto` (no third-party dependency), injected into the shared in-memory adapter.

import { createHmac } from "node:crypto";
import type { HmacSha512 } from "@shopong/events";
import { MemoryCommitments } from "@shopong/adapters-memory";
import type { Commitments } from "@shopong/ports";

/** HMAC-SHA512(key, message) from Node's built-in crypto module: 64 bytes. */
export const nodeHmacSha512: HmacSha512 = async (key, message) =>
  new Uint8Array(createHmac("sha512", key).update(message).digest());

/** The commitments of a Node that holds these community secrets (community key to 32-byte secret). */
export function nodeCommitments(secrets: ReadonlyMap<string, Uint8Array>): Commitments {
  const commitments = new MemoryCommitments({ hmac: nodeHmacSha512 });
  for (const [community, secret] of secrets) commitments.addCommunity(community, secret);
  return commitments;
}

/**
 * Decodes a community secret from its registry value: 64 hex characters, 32 bytes. Returns undefined for any
 * other text, so the caller can refuse it without echoing the value.
 */
export function communitySecretFromHex(hex: string): Uint8Array | undefined {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return undefined;
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
