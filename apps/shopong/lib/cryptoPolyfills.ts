// What the iso-ucan adapter needs from `globalThis.crypto` and Hermes lacks. Install only what is
// missing, and record it, so a run reports exactly which polyfills it needed. Import this before the
// adapter: iso-web reads `globalThis.crypto` when it loads.
//
// The web has all of it already, so nothing is installed there.
import * as ExpoCrypto from "expo-crypto";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";

const installed: string[] = [];
const g = globalThis as { crypto?: Partial<Crypto> & { subtle?: Partial<SubtleCrypto> } };

if (g.crypto === undefined) {
  g.crypto = {};
  installed.push("globalThis.crypto");
}
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = ExpoCrypto.getRandomValues as Crypto["getRandomValues"];
  installed.push("crypto.getRandomValues (expo-crypto)");
}
if (typeof g.crypto.randomUUID !== "function") {
  g.crypto.randomUUID = ExpoCrypto.randomUUID as Crypto["randomUUID"];
  installed.push("crypto.randomUUID (expo-crypto)");
}
if (typeof g.crypto.subtle?.digest !== "function") {
  // multiformats' sha2 and @noble/ed25519's async sign and verify call `crypto.subtle.digest`. The pure
  // JS hashes give the same bytes on every runtime.
  const hashes = { "SHA-256": sha256, "SHA-384": sha384, "SHA-512": sha512 } as const;
  const digest = async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
    const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase();
    const hash = hashes[name as keyof typeof hashes];
    if (hash === undefined) throw new Error(`digest ${name} is not polyfilled`);
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return hash(bytes).slice().buffer;
  };
  const subtle = (g.crypto.subtle ?? {}) as Partial<SubtleCrypto>;
  subtle.digest = digest as SubtleCrypto["digest"];
  g.crypto.subtle = subtle as SubtleCrypto;
  installed.push("crypto.subtle.digest (@noble/hashes)");
}

export const installedPolyfills: readonly string[] = installed;
