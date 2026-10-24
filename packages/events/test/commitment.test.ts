import { describe, expect, it } from "vite-plus/test";
import {
  NormalisationError,
  commitPhoneNumber,
  isCommitment,
  keyedCommitment,
  normalisePhoneNumber,
  type HmacSha512,
} from "../src/index.js";
import { hexToBytes, vectors } from "./vectors.js";

// Test-only HMAC via WebCrypto. Production devices inject an audited library (story 2.7).
const webCryptoHmac: HmacSha512 = async (key, message) => {
  const k = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array(message)));
};

describe("normalisePhoneNumber", () => {
  for (const v of vectors.phone.accept) {
    it(`${JSON.stringify(v.input)} -> ${v.normalised}`, () => {
      expect(normalisePhoneNumber(v.input)).toBe(v.normalised);
    });
  }
  for (const input of vectors.phone.reject) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(() => normalisePhoneNumber(input)).toThrow(NormalisationError);
    });
  }
  it("is idempotent", () => {
    for (const v of vectors.phone.accept)
      expect(normalisePhoneNumber(v.normalised)).toBe(v.normalised);
  });
});

describe("keyed commitments", () => {
  for (const v of vectors.commitments) {
    it(`HMAC-SHA512 vector for ${v.value}`, async () => {
      const c = await keyedCommitment(hexToBytes(v.secretHex), v.value, webCryptoHmac);
      expect(c).toBe(v.commitment);
      expect(isCommitment(c)).toBe(true);
    });
  }

  it("commits to the normalised phone number, so spellings of one number match", async () => {
    const v = vectors.commitments[0];
    if (!v) throw new Error("missing vector");
    const secret = hexToBytes(v.secretHex);
    for (const spelling of ["082 123 4567", "+27 (0)82 123 4567", "0027821234567"]) {
      expect(await commitPhoneNumber(secret, spelling, webCryptoHmac)).toBe(v.commitment);
    }
  });

  it("differs per community secret", async () => {
    const a = await keyedCommitment(new Uint8Array(32).fill(1), "+27821234567", webCryptoHmac);
    const b = await keyedCommitment(new Uint8Array(32).fill(2), "+27821234567", webCryptoHmac);
    expect(a).not.toBe(b);
  });

  it("refuses short secrets, empty values and wrong-length MACs", async () => {
    await expect(
      keyedCommitment(new Uint8Array(16), "+27821234567", webCryptoHmac),
    ).rejects.toThrow(RangeError);
    await expect(keyedCommitment(new Uint8Array(32), "", webCryptoHmac)).rejects.toThrow(
      RangeError,
    );
    await expect(
      keyedCommitment(new Uint8Array(32), "x", async () => new Uint8Array(32)),
    ).rejects.toThrow("expected 64");
  });
});
