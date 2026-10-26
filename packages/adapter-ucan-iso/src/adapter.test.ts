// The port's contract suite against the iso-ucan adapter: plain, with the clock and network trapped
// during `verify` (it must be a pure function of its inputs, AD-6), and with issue-time attenuation
// checks off so `verify` alone has to refuse amplifying delegations.
import { describe, expect, it } from "vite-plus/test";
import type { CapabilityAuth } from "@shopong/ports";
import { capabilityAuthContract, runCapabilityAuthContract } from "@shopong/ports-contract";
import { IsoUcanCapabilityAuth } from "./adapter.js";

// Wrap an adapter so `verify` runs with the wall clock and the network booby-trapped: any
// `Date.now()`, `new Date()` or `fetch` during verification throws. This turns "verify is a
// pure function of its inputs" (port rule, AD-6) from a claim into a test.
function underTrap<T>(fn: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  const RealDate = Date;
  const realFetch = globalThis.fetch;
  const trap = (what: string) => () => {
    throw new Error(`${what} read during verify`);
  };
  Date.now = trap("Date.now");
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      if (args.length === 0) throw new Error("new Date() read during verify");
      return new target(...(args as [number]));
    },
  });
  globalThis.fetch = trap("fetch") as typeof fetch;
  return fn().finally(() => {
    Date.now = realNow;
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
  });
}

function trapped(auth: CapabilityAuth): CapabilityAuth {
  return {
    createIdentity: () => auth.createIdentity(),
    issue: (request) => auth.issue(request),
    decode: (token) => auth.decode(token),
    tokenId: (token) => auth.tokenId(token),
    verify: (token, request) => underTrap(() => auth.verify(token, request)),
  };
}

describe("IsoUcanCapabilityAuth", () => {
  runCapabilityAuthContract(() => new IsoUcanCapabilityAuth());
});

describe("IsoUcanCapabilityAuth, clock and network trapped in verify", () => {
  runCapabilityAuthContract(() => trapped(new IsoUcanCapabilityAuth()));
});

describe("IsoUcanCapabilityAuth, no attenuation check at issue", () => {
  for (const c of capabilityAuthContract) {
    it(c.name, async () => c.run(new IsoUcanCapabilityAuth({ checkAttenuationOnIssue: false })));
  }
});

// The Ed25519 seed AD-18 derives from the recovery seed 00 01 02 ... 1f (see apps/shopong/lib/identitySeed.ts,
// which tests the derivation itself). Pinned here so the adapter's use of it cannot drift.
const GOLDEN_IDENTITY_SEED = "ee42e9a2e84c803afdcce145d2ee449d0d27b3ee1b6fd7c562e12ee3ff086eda";
const GOLDEN_DID = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

describe("IsoUcanCapabilityAuth, identitySeed", () => {
  const seed = Uint8Array.from(GOLDEN_IDENTITY_SEED.match(/../g) ?? [], (h) => parseInt(h, 16));

  it("the first identity is the seed's key and later ones are fresh", async () => {
    const auth = new IsoUcanCapabilityAuth({ identitySeed: seed });
    expect(await auth.createIdentity()).toBe(GOLDEN_DID);
    const next = await auth.createIdentity();
    expect(next).not.toBe(GOLDEN_DID);
  });

  it("the same seed gives the same DID on a new adapter", async () => {
    const a = await new IsoUcanCapabilityAuth({ identitySeed: seed }).createIdentity();
    const b = await new IsoUcanCapabilityAuth({ identitySeed: seed }).createIdentity();
    expect(a).toBe(b);
  });

  it("refuses a seed that is not 32 bytes", () => {
    expect(() => new IsoUcanCapabilityAuth({ identitySeed: new Uint8Array(16) })).toThrow(
      RangeError,
    );
  });

  runCapabilityAuthContract(() => new IsoUcanCapabilityAuth({ identitySeed: seed }));
});
