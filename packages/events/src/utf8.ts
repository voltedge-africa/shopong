// Dependency-free UTF-8, so the core does not rely on TextEncoder/TextDecoder
// behaving the same on Hermes, browsers, Node and Bare.

export class Utf8Error extends Error {
  override name = "Utf8Error";
}

/** Encode a well-formed UTF-16 string. Lone surrogates are rejected, never replaced with U+FFFD. */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const low = text.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new Utf8Error(`lone surrogate at index ${i}`);
      cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
      i++;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      throw new Utf8Error(`lone surrogate at index ${i}`);
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * Strict decoder: rejects truncated sequences, overlong encodings, encoded
 * surrogates and code points above U+10FFFF (RFC 3629).
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const units: number[] = [];
  let i = 0;
  const cont = (at: number): number => {
    const b = bytes[at];
    if (b === undefined || (b & 0xc0) !== 0x80)
      throw new Utf8Error(`invalid continuation byte at ${at}`);
    return b & 0x3f;
  };
  while (i < bytes.length) {
    const b0 = bytes[i] as number;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = ((b0 & 0x1f) << 6) | cont(i + 1);
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      cp = ((b0 & 0x0f) << 12) | (cont(i + 1) << 6) | cont(i + 2);
      if (cp < 0x800) throw new Utf8Error(`overlong encoding at ${i}`);
      if (cp >= 0xd800 && cp <= 0xdfff) throw new Utf8Error(`encoded surrogate at ${i}`);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      cp = ((b0 & 0x07) << 18) | (cont(i + 1) << 12) | (cont(i + 2) << 6) | cont(i + 3);
      if (cp < 0x10000) throw new Utf8Error(`overlong encoding at ${i}`);
      if (cp > 0x10ffff) throw new Utf8Error(`code point above U+10FFFF at ${i}`);
      i += 4;
    } else {
      throw new Utf8Error(`invalid leading byte 0x${b0.toString(16)} at ${i}`);
    }
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(cp);
    }
  }
  let text = "";
  for (let at = 0; at < units.length; at += 4096) {
    text += String.fromCharCode(...units.slice(at, at + 4096));
  }
  return text;
}
