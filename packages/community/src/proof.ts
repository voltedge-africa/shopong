import { decodeUtf8, encodeUtf8 } from "@shopong/events";
import type { CapabilityToken } from "@shopong/ports";
import { toHex } from "./space.js";

/** Proofs travel in the envelope as hex of the token's UTF-8 bytes (the envelope allows `[A-Za-z0-9_.-]`). */
export function encodeProof(token: string): string {
  return toHex(encodeUtf8(token));
}

export function decodeProof(proof: string): CapabilityToken | undefined {
  if (proof.length % 2 !== 0 || !/^[0-9a-f]*$/.test(proof)) return undefined;
  const bytes = new Uint8Array(proof.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(proof.slice(i * 2, i * 2 + 2), 16);
  try {
    return decodeUtf8(bytes) as CapabilityToken;
  } catch {
    return undefined;
  }
}
