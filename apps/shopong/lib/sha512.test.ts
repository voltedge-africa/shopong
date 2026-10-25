import { describe, expect, it } from "vite-plus/test";

import { sha512Hex } from "./sha512";

/** Web Crypto's SHA-512, which Node and every browser provide. */
async function reference(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("sha512Hex", () => {
  it("gives the standard answers", () => {
    expect(sha512Hex("")).toBe(
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    );
    expect(sha512Hex("abc")).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });

  it("matches Web Crypto's SHA-512 on inputs around every block boundary", async () => {
    for (let length = 0; length <= 300; length++) {
      const text = "x".repeat(length);
      expect(sha512Hex(text), `${length} bytes`).toBe(await reference(text));
    }
  });

  it("matches on text with accents, emoji and line breaks", async () => {
    for (const text of [
      "Café é ñ",
      "😀 emoji",
      'root = Screen("a")\nlist = List([])\n',
      "\u0000\u007f",
    ]) {
      expect(sha512Hex(text)).toBe(await reference(text));
    }
  });
});
