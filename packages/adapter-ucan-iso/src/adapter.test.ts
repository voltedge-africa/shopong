// The port's contract suite against the iso-ucan adapter: plain, with the clock and network trapped
// during `verify` (it must be a pure function of its inputs, AD-6), and with issue-time attenuation
// checks off so `verify` alone has to refuse amplifying delegations.
import { describe, it } from "vite-plus/test";
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
