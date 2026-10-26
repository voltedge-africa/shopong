// The outbox file's name for one identity (story 3.4, review P5). Two identities on one device get two files, so
// one never sends another's events. The name carries a hash of the DID, never the DID itself.

import { encodeUtf8 } from "@shopong/events";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The file name of an identity's outbox: `outbox-<first 32 hex of SHA-512(DID)>.json`. */
export function outboxNameFor(did: string): string {
  return `outbox-${bytesToHex(sha512(encodeUtf8(did))).slice(0, 32)}.json`;
}
