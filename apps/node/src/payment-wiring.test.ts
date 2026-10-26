// The Node's wiring of the payer reference (story 4.3, review item 3): the production options build the payer
// commitment from the community secret, keyed by each community, so the same member has a different reference in two
// communities. This test uses the real wiring, not the route test's stand-in.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { describe, expect, it } from "vite-plus/test";
import type { Did } from "@shopong/ports";
import { paymentRequestOptionsOf } from "./node.ts";
import { ResolvedSecrets } from "./secrets.ts";

const COMMUNITY_A = "ab".repeat(32);
const COMMUNITY_B = "cd".repeat(32);
const MEMBER = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL" as Did;
const NODE = "did:key:z6MkfrQ7y7N9mWrVHgqZ6nqvpjhiWqwCfsZUYqL4pkoKJ2zL" as Did;

describe("[S-4.3] the payer reference wiring (review item 3)", () => {
  it("gives the same member a different payer commitment in two communities", async () => {
    const secrets = new ResolvedSecrets(new Map([["COMMUNITY_SECRET", "11".repeat(32)]]));
    const options = paymentRequestOptionsOf({
      auth: new IsoUcanCapabilityAuth(),
      hub: {} as never,
      payments: {} as never,
      secrets,
      identity: NODE,
    });
    expect(options).toBeDefined();
    const inA = await options!.payerCommitment(COMMUNITY_A, MEMBER);
    const inB = await options!.payerCommitment(COMMUNITY_B, MEMBER);
    expect(inA).toMatch(/^[0-9a-f]{128}$/u);
    expect(inB).toMatch(/^[0-9a-f]{128}$/u);
    expect(inA).not.toBe(inB);
  });

  it("gives the same answer for the same community, every time", async () => {
    const secrets = new ResolvedSecrets(new Map([["COMMUNITY_SECRET", "11".repeat(32)]]));
    const options = paymentRequestOptionsOf({
      auth: new IsoUcanCapabilityAuth(),
      hub: {} as never,
      payments: {} as never,
      secrets,
      identity: NODE,
    })!;
    expect(await options.payerCommitment(COMMUNITY_A, MEMBER)).toBe(
      await options.payerCommitment(COMMUNITY_A, MEMBER),
    );
  });
});
