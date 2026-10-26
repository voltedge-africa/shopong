// Standard base64 (RFC 4648, with `=` padding), written here so the phone and the Node share one strict reader.
// It is used for file bytes inside a JSON body (story 3.7). Pure: no Buffer, no platform module.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CODE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) CODE[ALPHABET.charCodeAt(i)] = i;

/** The base64 text of `bytes`, padded. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += b === undefined ? "=" : ALPHABET[(n >> 6) & 63];
    out += c === undefined ? "=" : ALPHABET[n & 63];
  }
  return out;
}

/** The bytes of a base64 text, or undefined when the text is not exactly base64 (length, alphabet, padding). */
export function fromBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0) return undefined;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const body = text.slice(0, text.length - pad);
  if (body.includes("=")) return undefined;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const values = [0, 1, 2, 3].map((k) => {
      const ch = text[i + k]!;
      if (ch === "=") return 0;
      const code = ch.charCodeAt(0);
      return code < 128 ? CODE[code]! : -1;
    });
    if (values.some((v) => v < 0)) return undefined;
    const n = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let k = 0; k < 3 && at < out.length; k++) out[at++] = bytes[k]!;
  }
  return out;
}
