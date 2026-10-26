// The app's HMAC-SHA512 (AGENTS rule 6, story 2.7), injected wherever `@shopong/events` needs one. It uses the
// `@noble/hashes` already pinned for this app (no new dependency). A phone never holds a community secret: the
// OCN Node computes commitments (`POST /commitments`). This function exists so any screen that must check a
// commitment on the device gives the same bytes as the Node (the golden vectors, `hmac.test.ts`).
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import type { HmacSha512 } from "@shopong/events";

export const hmacSha512: HmacSha512 = async (key, message) => hmac(sha512, key, message);
