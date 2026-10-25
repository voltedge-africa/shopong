// AD-18 at the identity level: the same recovery seed gives the same did:key every time, in
// both libraries, and the identity key is domain-separated from the Corestore primaryKey.
import { describe, expect, it } from "vite-plus/test";
import { hexToBytes } from "@noble/hashes/utils.js";
import { getPublicKeyAsync } from "@noble/ed25519";
import { deriveKey, identitySeed, PRIMARY_KEY_LABEL } from "../src/identity/seed.js";
import { didKeyFromPublicKey, isoUcanSignerFromSeed, tsUcanKeypairFromSeed } from "../src/identity/keys.js";
import { IsoUcanCapabilityAuth } from "../src/iso-ucan/adapter.js";
import { TsUcanCapabilityAuth } from "../src/ts-ucan/adapter.js";

// RFC 8032 section 7.1, test 1.
const RFC8032_SECRET = hexToBytes("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
const RFC8032_PUBLIC = hexToBytes("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
// A fixed 32-byte "recovery seed" for the golden DID below.
const RECOVERY = hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
// Recorded on first run; any runtime that derives a different DID is wrong.
export const GOLDEN_DID = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

describe("identity from a recovery seed (HKDF-SHA-512)", () => {
  it("both libraries agree with RFC 8032 and an independent did:key encoding", async () => {
    const expected = didKeyFromPublicKey(RFC8032_PUBLIC);
    expect(tsUcanKeypairFromSeed(RFC8032_SECRET).did()).toBe(expected);
    expect((await isoUcanSignerFromSeed(RFC8032_SECRET)).did).toBe(expected);
  });

  it("the same recovery seed gives the same DID, every time, in both libraries", async () => {
    const seed = identitySeed(RECOVERY);
    const ts = tsUcanKeypairFromSeed(seed).did();
    const iso = (await isoUcanSignerFromSeed(seed)).did;
    expect(ts).toBe(iso);
    expect(ts).toBe(didKeyFromPublicKey(await getPublicKeyAsync(seed)));
    expect(tsUcanKeypairFromSeed(identitySeed(RECOVERY)).did()).toBe(ts);
    expect(ts).toBe(GOLDEN_DID);
  });

  it("labels separate purposes: the identity seed is not the Corestore primaryKey", () => {
    const id = identitySeed(RECOVERY);
    const primary = deriveKey(RECOVERY, PRIMARY_KEY_LABEL);
    expect(primary).toHaveLength(32);
    expect(Buffer.from(primary).equals(Buffer.from(id))).toBe(false);
    expect(() => deriveKey(new Uint8Array(8), PRIMARY_KEY_LABEL)).toThrow(/128 bits/);
  });

  it("a restored identity can sign for a chain the old device's DID was granted", async () => {
    for (const make of [
      () =>
        new TsUcanCapabilityAuth({
          createKeypair: async () => tsUcanKeypairFromSeed(identitySeed(RECOVERY)),
        }),
      () =>
        new IsoUcanCapabilityAuth({
          createSigner: () => isoUcanSignerFromSeed(identitySeed(RECOVERY)),
        }),
    ]) {
      const restored = make();
      expect(await restored.createIdentity()).toBe(GOLDEN_DID);
    }
  });
});
