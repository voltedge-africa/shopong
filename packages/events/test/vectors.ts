// The only module that loads the golden vectors. Every expected canonical
// string, SHA-512 and event id used by the tests comes from here; the file is
// produced by scripts/gen_vectors.py, an independent Python implementation.
import golden from "../vectors/golden.json" with { type: "json" };

export const vectors = golden;

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
