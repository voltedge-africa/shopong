// Install only what the runtime lacks, and record it, so a device run reports exactly which
// polyfills were needed. Must be imported before any crypto library.
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
if (typeof g.crypto.subtle?.digest !== "function") {
  // iso-ucan needs it: multiformats' sha2 (browser build) and @noble/ed25519 v3's async
  // sign/verify call crypto.subtle.digest. Pure-JS @noble/hashes, so results are identical
  // on every runtime. expo-crypto's `digest` is a native alternative.
  const impl = { "SHA-256": sha256, "SHA-384": sha384, "SHA-512": sha512 } as const;
  const digest = async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
    const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase();
    const hash = impl[name as keyof typeof impl];
    if (hash === undefined) throw new Error(`digest ${name} not polyfilled`);
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return hash(bytes).slice().buffer;
  };
  g.crypto.subtle = { ...(g.crypto.subtle ?? {}), digest } as SubtleCrypto;
  installed.push("crypto.subtle.digest (@noble/hashes)");
}
for (const name of ["TextEncoder", "TextDecoder", "structuredClone", "atob", "btoa"]) {
  if (!(name in globalThis)) installed.push(`MISSING ${name} (not polyfilled)`);
}

export const polyfills: readonly string[] = installed;

import { getRandomValues } from 'expo-crypto';
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = getRandomValues as any;
}
// Try to provide node crypto shim
try {
  const nodeCrypto = require('crypto');
  if (typeof globalThis.crypto.webcrypto === 'undefined' && nodeCrypto.webcrypto) {
    globalThis.crypto.webcrypto = nodeCrypto.webcrypto;
  }
} catch (e) {
  // ignore
}
