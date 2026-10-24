import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import type { Sha512 } from "@shopong/events";

/**
 * SHA-512 for `@shopong/events` on every Expo platform (ADR 0001, section 4). On web
 * expo-crypto uses `crypto.subtle`, which browsers only expose on HTTPS or localhost.
 */
export const expoSha512: Sha512 = async (bytes) =>
  // Copy first: digest() takes a BufferSource backed by a plain ArrayBuffer.
  new Uint8Array(await digest(CryptoDigestAlgorithm.SHA512, new Uint8Array(bytes)));
