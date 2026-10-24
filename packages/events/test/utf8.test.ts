import { describe, expect, it } from "vite-plus/test";
import { Utf8Error, decodeUtf8, encodeUtf8 } from "../src/index.js";

describe("utf8", () => {
  const samples = [
    "",
    "abc",
    "\u00e9",
    "\u20ac",
    "\uffff",
    "\ud83d\ude00",
    "\ud834\udd1e Sawubona",
    "\u0000\u007f\u0080\u07ff\u0800",
  ];

  it("matches TextEncoder and round-trips", () => {
    for (const s of samples) {
      expect(encodeUtf8(s)).toEqual(new TextEncoder().encode(s));
      expect(decodeUtf8(encodeUtf8(s))).toBe(s);
    }
  });

  it("rejects lone surrogates instead of replacing them", () => {
    for (const s of ["\ud800", "a\udc00", "\udc00\ud800"])
      expect(() => encodeUtf8(s)).toThrow(Utf8Error);
  });

  it("rejects malformed byte sequences", () => {
    const bad = [
      [0xff],
      [0x80],
      [0xc0, 0xaf],
      [0xe0, 0x80, 0xaf],
      [0xed, 0xa0, 0x80],
      [0xf0, 0x80, 0x80, 0xaf],
      [0xf4, 0x90, 0x80, 0x80],
      [0xe2, 0x82],
    ];
    for (const b of bad)
      expect(() => decodeUtf8(Uint8Array.from(b)), b.join(",")).toThrow(Utf8Error);
  });

  it("decodes long input", () => {
    const long = "ab\ud83d\ude00".repeat(5000);
    expect(decodeUtf8(encodeUtf8(long))).toBe(long);
  });
});
