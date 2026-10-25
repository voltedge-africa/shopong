// Evidence about iso-ucan 2.0.0 itself, without our adapter: what UCAN 1.0 commands and
// policies enforce on their own, and where our code still has to add the port's rules.
import { describe, expect, it } from "vite-plus/test";
import { Delegation } from "iso-ucan/delegation";
import { Invocation } from "iso-ucan/invocation";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { verifier } from "iso-signatures/verifiers/eddsa.js";
import { Resolver } from "iso-signatures/verifiers/resolver.js";
import { capabilityToPolicy } from "../src/iso-ucan/adapter.js";
import { underTrap } from "../src/trap.js";

const verifierResolver = new Resolver({ ...verifier });
const space = "ocn:space/s1";
// Log times far in the past, in seconds, as the contract uses.
const T0 = 1000;
const HOUR = 3600;
const ceiling = (minor: number) => ({ currency: "ZAR", minor });

async function people() {
  return {
    root: await EdDSASigner.generate(),
    treasurer: await EdDSASigner.generate(),
    agent: await EdDSASigner.generate(),
  };
}

async function grant(
  iss: EdDSASigner,
  aud: EdDSASigner,
  sub: EdDSASigner,
  opts: { cmd?: string; with?: string; minor?: number; exp?: number },
) {
  return Delegation.create({
    iss,
    aud: aud.did,
    sub: sub.did,
    cmd: opts.cmd ?? "/payment/approve",
    pol: capabilityToPolicy({
      with: opts.with ?? space,
      can: "payment/approve",
      ...(opts.minor === undefined ? {} : { ceiling: ceiling(opts.minor) }),
    }) as never,
    exp: opts.exp ?? T0 + 10 * HOUR,
    nbf: T0,
    now: T0,
  });
}

async function invoke(
  p: Awaited<ReturnType<typeof people>>,
  prf: Delegation[],
  args: Record<string, unknown>,
  now = T0 + HOUR,
) {
  const inv = await Invocation.create({
    iss: p.agent,
    sub: p.root.did,
    cmd: "/payment/approve",
    args,
    prf,
    exp: now + 60,
    now,
    verifierResolver,
  } as never);
  const byCid = new Map(prf.map((d) => [d.cid.toString(), d]));
  return Invocation.from({
    bytes: inv.bytes,
    now,
    verifierResolver,
    resolveProof: async (cid: { toString(): string }) => byCid.get(cid.toString())!,
  } as never);
}

describe("iso-ucan 2.0.0 library behaviour", () => {
  it("time is injectable: `now` lets a 1970 token be created and verified", async () => {
    const p = await people();
    await expect(
      Delegation.create({
        iss: p.root,
        aud: p.treasurer.did,
        sub: p.root.did,
        cmd: "/payment/approve",
        pol: [],
        exp: T0 + HOUR,
      }),
    ).rejects.toThrow(/expiration must be in the future/);
    const d = await grant(p.root, p.treasurer, p.root, {});
    await expect(
      Delegation.from({ bytes: d.bytes, now: T0 + HOUR, verifierResolver }),
    ).resolves.toBeInstanceOf(Delegation);
  });

  it("with `now` supplied, verification never reads the clock; without it, it does", async () => {
    const p = await people();
    const d = await grant(p.root, p.treasurer, p.root, { exp: 4_000_000_000 });
    await expect(
      underTrap(() => Delegation.from({ bytes: d.bytes, now: T0, verifierResolver })),
    ).resolves.toBeInstanceOf(Delegation);
    await expect(
      underTrap(() => Delegation.from({ bytes: d.bytes, verifierResolver })),
    ).rejects.toThrow(/Date\.now read/);
  });

  it("ceilings are enforced by the policy engine: every link's ceiling applies", async () => {
    const p = await people();
    const root = await grant(p.root, p.treasurer, p.root, { minor: 1000_00 });
    const raised = await grant(p.treasurer, p.agent, p.root, { minor: 5000_00 });
    await expect(invoke(p, [root, raised], { with: space, ceiling: ceiling(500_00) })).resolves.toBeTruthy();
    await expect(
      invoke(p, [root, raised], { with: space, ceiling: ceiling(2000_00) }),
    ).rejects.toThrow(/invalid arguments/);
  });

  it("a dropped ceiling does not widen: the parent's ceiling still applies", async () => {
    const p = await people();
    const root = await grant(p.root, p.treasurer, p.root, { minor: 1000_00 });
    const dropped = await grant(p.treasurer, p.agent, p.root, {});
    await expect(invoke(p, [root, dropped], { with: space })).rejects.toThrow(/invalid arguments/);
  });

  it("resources narrow by `like` glob; a sibling prefix does not match", async () => {
    const p = await people();
    const root = await grant(p.root, p.treasurer, p.root, {});
    const leaf = await grant(p.treasurer, p.agent, p.root, { with: `${space}/orders` });
    await expect(invoke(p, [root, leaf], { with: `${space}/orders/7` })).resolves.toBeTruthy();
    await expect(invoke(p, [root, leaf], { with: space })).rejects.toThrow(/invalid arguments/);
    await expect(invoke(p, [root], { with: `${space}x` })).rejects.toThrow(/invalid arguments/);
  });

  it("commands narrow by segment: a child cannot broaden its parent's command", async () => {
    const p = await people();
    const root = await grant(p.root, p.treasurer, p.root, { cmd: "/payment/approve" });
    const broader = await grant(p.treasurer, p.agent, p.root, { cmd: "/payment" });
    await expect(invoke(p, [root, broader], { with: space })).rejects.toThrow(/command mismatch/);
  });

  it("GAP: a child may outlive its parent (UCAN 1.0 has no time-subset rule)", async () => {
    const p = await people();
    const root = await grant(p.root, p.treasurer, p.root, { exp: T0 + 10 * HOUR });
    const longer = await grant(p.treasurer, p.agent, p.root, { exp: T0 + 20 * HOUR });
    await expect(invoke(p, [root, longer], { with: space })).resolves.toBeTruthy();
    // ...but at a time after the parent expired, the parent itself fails.
    await expect(invoke(p, [root, longer], { with: space }, T0 + 15 * HOUR)).rejects.toThrow(
      /expiration/,
    );
  });

  it("GAP: expiry is inclusive in seconds (exp == now is still valid); the port is exclusive", async () => {
    const p = await people();
    const d = await grant(p.root, p.treasurer, p.root, { exp: T0 + HOUR });
    await expect(
      Delegation.from({ bytes: d.bytes, now: T0 + HOUR, verifierResolver }),
    ).resolves.toBeInstanceOf(Delegation);
    await expect(
      Delegation.from({ bytes: d.bytes, now: T0 + HOUR + 1, verifierResolver }),
    ).rejects.toThrow(/expiration/);
  });

  it("revocation is a caller-supplied lookup by CID", async () => {
    const p = await people();
    const d = await grant(p.root, p.treasurer, p.root, {});
    const revoked = d.cid.toString();
    await expect(
      Delegation.from({
        bytes: d.bytes,
        now: T0,
        verifierResolver,
        isRevoked: async (cid) => cid.toString() === revoked,
      }),
    ).rejects.toThrow(/revoked/);
  });
});
