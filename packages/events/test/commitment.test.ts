import { describe, expect, it } from "vite-plus/test";
import {
  NormalisationError,
  commitIdNumber,
  commitPersonal,
  commitPhoneNumber,
  isCommitment,
  keyedCommitment,
  normaliseIdNumber,
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
    await expect(
      keyedCommitment(new Uint8Array(16), "+27821234567", webCryptoHmac),
    ).rejects.toThrow("This community's secret is too short.");
    await expect(keyedCommitment(new Uint8Array(32), "", webCryptoHmac)).rejects.toThrow(
      RangeError,
    );
    await expect(
      keyedCommitment(new Uint8Array(32), "x", async () => new Uint8Array(32)),
    ).rejects.toThrow("expected 64");
  });
});

// The golden vector for one value under one community's secret, looked up by the secret's hex.
const SECRET_A = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const SECRET_B = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
function vectorFor(value: string, secretHex: string): { secret: Uint8Array; commitment: string } {
  const found = vectors.commitments.find((c) => c.value === value && c.secretHex === secretHex);
  if (!found) throw new Error(`no golden vector for ${value}`);
  return { secret: hexToBytes(found.secretHex), commitment: found.commitment };
}

describe("ID number normalisation (matrix: commit an ID)", () => {
  for (const v of vectors.id.accept) {
    it(`${JSON.stringify(v.input)} -> ${v.normalised}`, () => {
      expect(normaliseIdNumber(v.input)).toBe(v.normalised);
    });
  }
  for (const input of vectors.id.reject) {
    it(`refuses ${JSON.stringify(input)} with the plain reason`, () => {
      expect(() => normaliseIdNumber(input)).toThrow(NormalisationError);
      expect(() => normaliseIdNumber(input)).toThrow("That doesn't look like an ID number.");
    });
  }
});

describe("ID number commitments", () => {
  it("the same 13 digits give the golden commitment, however they are spaced", async () => {
    const { secret, commitment } = vectorFor("8001015009087", SECRET_A);
    for (const v of vectors.id.accept) {
      expect(await commitIdNumber(secret, v.input, webCryptoHmac)).toBe(commitment);
    }
  });

  it("another community's secret gives the other golden commitment", async () => {
    const { secret, commitment } = vectorFor("8001015009087", SECRET_B);
    expect(await commitIdNumber(secret, "8001015009087", webCryptoHmac)).toBe(commitment);
    const first = vectorFor("8001015009087", SECRET_A).commitment;
    expect(commitment).not.toBe(first);
  });

  it("is refused with the plain reason for a bad check digit", async () => {
    await expect(
      commitIdNumber(new Uint8Array(32), "8001015009088", webCryptoHmac),
    ).rejects.toThrow("That doesn't look like an ID number.");
  });
});

describe("commitPersonal (the port's rules without the port)", () => {
  it("returns the golden commitment for a phone number", async () => {
    const { secret, commitment } = vectorFor("+27821234567", SECRET_A);
    const result = await commitPersonal(secret, "phone", "082 123 4567", webCryptoHmac);
    expect(result).toEqual({ ok: true, commitment });
  });

  it("returns the golden commitment for an ID number", async () => {
    const { secret, commitment } = vectorFor("8001015009087", SECRET_A);
    const result = await commitPersonal(secret, "id-number", "800101 5009 087", webCryptoHmac);
    expect(result).toEqual({ ok: true, commitment });
  });

  it("gives plain reasons for a value that is not a phone or ID number, and a short secret", async () => {
    const secret = vectorFor("+27821234567", SECRET_A).secret;
    expect(await commitPersonal(secret, "phone", "not a number", webCryptoHmac)).toEqual({
      ok: false,
      problem: "not_recognised",
      message: "That doesn't look like a phone number.",
    });
    expect(await commitPersonal(secret, "id-number", "8001015009088", webCryptoHmac)).toEqual({
      ok: false,
      problem: "not_recognised",
      message: "That doesn't look like an ID number.",
    });
    expect(
      await commitPersonal(new Uint8Array(16), "phone", "082 123 4567", webCryptoHmac),
    ).toEqual({
      ok: false,
      problem: "secret_too_short",
      message: "This community's secret is too short.",
    });
  });
});
