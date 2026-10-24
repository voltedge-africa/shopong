// Wrap an adapter so `verify` runs with the wall clock and the network booby-trapped: any
// `Date.now()`, `new Date()` or `fetch` during verification throws. This turns "verify is a
// pure function of its inputs" (port rule, AD-6) from a claim into a test.
import type { CapabilityAuth } from "@shopong/ports";

export function underTrap<T>(fn: () => Promise<T>): Promise<T> {
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

export function trapped(auth: CapabilityAuth): CapabilityAuth {
  return {
    createIdentity: () => auth.createIdentity(),
    issue: (request) => auth.issue(request),
    decode: (token) => auth.decode(token),
    tokenId: (token) => auth.tokenId(token),
    verify: (token, request) => underTrap(() => auth.verify(token, request)),
  };
}
