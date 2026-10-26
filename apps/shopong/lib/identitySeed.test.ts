import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { describe, expect, it } from "vite-plus/test";

import { fromHex, identitySeed, shortDid, toHex } from "./identitySeed";

const GOLDEN_SEED = Uint8Array.from({ length: 32 }, (_, i) => i);
const GOLDEN_DID = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

describe("identitySeed", () => {
  it("derives the golden DID from the golden recovery seed", async () => {
    const auth = new IsoUcanCapabilityAuth({ identitySeed: identitySeed(GOLDEN_SEED) });
    expect(await auth.createIdentity()).toBe(GOLDEN_DID);
  });

  it("is 32 bytes and differs from the recovery seed", () => {
    const derived = identitySeed(GOLDEN_SEED);
    expect(derived).toHaveLength(32);
    expect(toHex(derived)).not.toBe(toHex(GOLDEN_SEED));
  });

  it("refuses a recovery seed under 128 bits", () => {
    expect(() => identitySeed(new Uint8Array(8))).toThrow(RangeError);
  });
});

describe("hex helpers", () => {
  it("round-trips bytes", () => {
    expect(fromHex(toHex(GOLDEN_SEED), 32)).toEqual(GOLDEN_SEED);
  });

  it.each(["", "zz", "00".repeat(31), "00".repeat(33), "0G".repeat(32), "AB".repeat(32)])(
    "rejects %j as not 64 lowercase hex characters",
    (bad) => {
      expect(fromHex(bad, 32)).toBeNull();
    },
  );
});

describe("shortDid", () => {
  it("keeps the first 12 characters of the key and the last 6", () => {
    expect(shortDid(GOLDEN_DID)).toBe("did:key:z6MkmtmqQWNz…ouVZtL");
  });

  it("leaves other text alone", () => {
    expect(shortDid("did:web:example.com")).toBe("did:web:example.com");
  });
});
