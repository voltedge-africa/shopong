import { expect } from "vite-plus/test";
import {
  money,
  type Capability,
  type CapabilityAuth,
  type CapabilityToken,
  type Did,
  type VerifyRequest,
} from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  unique,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

// Times are fixed numbers, far from today, so a verify that reads the wall clock fails.
const T0 = 1_000_000;
const HOUR = 3_600_000;

interface World {
  auth: CapabilityAuth;
  root: Did;
  treasurer: Did;
  agent: Did;
  space: string;
  approve: Capability;
}

async function world(auth: CapabilityAuth): Promise<World> {
  const space = `ocn:space/${unique("s")}`;
  return {
    auth,
    root: await auth.createIdentity(),
    treasurer: await auth.createIdentity(),
    agent: await auth.createIdentity(),
    space,
    approve: { with: space, can: "payment/approve", ceiling: money("ZAR", 1000_00) },
  };
}

async function rootGrant(w: World, capability: Capability = w.approve): Promise<CapabilityToken> {
  return expectOk(
    await w.auth.issue({
      issuer: w.root,
      audience: w.treasurer,
      capabilities: [capability],
      notBefore: T0,
      expiresAt: T0 + 10 * HOUR,
    }),
  );
}

function needs(w: World, overrides: Partial<VerifyRequest> = {}): VerifyRequest {
  return { required: w.approve, rootIssuer: w.root, logTime: T0 + HOUR, ...overrides };
}

/** Delegate from the treasurer to the agent; amplification may be refused at issue or at verify. */
async function delegateOrRefuse(
  w: World,
  parent: CapabilityToken,
  capability: Capability,
  window: { notBefore: number; expiresAt: number } = { notBefore: T0, expiresAt: T0 + 2 * HOUR },
): Promise<void> {
  const issued = await w.auth.issue({
    issuer: w.treasurer,
    audience: w.agent,
    capabilities: [capability],
    ...window,
    proofs: [parent],
  });
  if (!issued.ok) {
    expect(issued.error.code).toBe("not_attenuated");
    return;
  }
  expectErr(
    await w.auth.verify(
      issued.value,
      needs(w, { required: capability, logTime: window.notBefore }),
    ),
    "not_attenuated",
  );
}

export const capabilityAuthContract: readonly ContractCase<CapabilityAuth>[] = [
  {
    name: "creates distinct identities",
    run: async (auth) => {
      const a = await auth.createIdentity();
      const b = await auth.createIdentity();
      expect(a).toMatch(/^did:[a-z0-9]+:.+/);
      expect(a).not.toBe(b);
    },
  },
  {
    name: "a root grant verifies for the capability it grants",
    run: async (auth) => {
      const w = await world(auth);
      const verified = expectOk(
        await auth.verify(await rootGrant(w), needs(w, { audience: w.treasurer })),
      );
      expect(verified.holder).toBe(w.treasurer);
      expect(verified.chain).toHaveLength(1);
      expect(verified.chain[0]?.issuer).toBe(w.root);
    },
  },
  {
    name: "decode returns the payload and tokenId is stable per token",
    run: async (auth) => {
      const w = await world(auth);
      const token = await rootGrant(w);
      const payload = expectOk(await auth.decode(token));
      expect(payload).toMatchObject({
        issuer: w.root,
        audience: w.treasurer,
        notBefore: T0,
        expiresAt: T0 + 10 * HOUR,
      });
      expect(payload.capabilities[0]).toMatchObject({ with: w.space, can: "payment/approve" });
      expect(payload.proofs).toEqual([]);
      expect(await auth.tokenId(token)).toBe(await auth.tokenId(token));
      expect(await auth.tokenId(token)).not.toBe(await auth.tokenId(await rootGrant(w)));
      expectErr(await auth.decode("not a token" as CapabilityToken), "malformed");
    },
  },
  {
    name: "a narrower request under the grant verifies; a different ability does not",
    run: async (auth) => {
      const w = await world(auth);
      const token = await rootGrant(w);
      expectOk(
        await auth.verify(
          token,
          needs(w, {
            required: {
              with: `${w.space}/orders/1`,
              can: "payment/approve",
              ceiling: money("ZAR", 10_00),
            },
          }),
        ),
      );
      expectErr(
        await auth.verify(token, needs(w, { required: { with: w.space, can: "member/invite" } })),
        "insufficient_capability",
      );
      expectErr(
        await auth.verify(
          token,
          needs(w, {
            required: { with: `${w.space}x`, can: "payment/approve", ceiling: money("ZAR", 1) },
          }),
        ),
        "insufficient_capability",
      );
    },
  },
  {
    name: "a request above the ceiling is refused",
    run: async (auth) => {
      const w = await world(auth);
      expectErr(
        await auth.verify(
          await rootGrant(w),
          needs(w, { required: { ...w.approve, ceiling: money("ZAR", 1000_01) } }),
        ),
        "insufficient_capability",
      );
    },
  },
  {
    name: "a delegated chain verifies leaf first, root last",
    run: async (auth) => {
      const w = await world(auth);
      const narrower: Capability = {
        with: w.space,
        can: "payment/approve",
        ceiling: money("ZAR", 200_00),
      };
      const leaf = expectOk(
        await auth.issue({
          issuer: w.treasurer,
          audience: w.agent,
          capabilities: [narrower],
          notBefore: T0,
          expiresAt: T0 + 2 * HOUR,
          proofs: [await rootGrant(w)],
        }),
      );
      const verified = expectOk(
        await auth.verify(leaf, needs(w, { required: narrower, audience: w.agent })),
      );
      expect(verified.holder).toBe(w.agent);
      expect(verified.chain.map((p) => p.issuer)).toEqual([w.treasurer, w.root]);
    },
  },
  {
    name: "validity uses the supplied log time, never the wall clock",
    run: async (auth) => {
      const w = await world(auth);
      const token = await rootGrant(w);
      expectOk(await auth.verify(token, needs(w, { logTime: T0 })));
      expectOk(await auth.verify(token, needs(w, { logTime: T0 + 10 * HOUR - 1 })));
      expectErr(await auth.verify(token, needs(w, { logTime: T0 - 1 })), "not_yet_valid");
      expectErr(await auth.verify(token, needs(w, { logTime: T0 + 10 * HOUR })), "expired");
      // The token expired decades ago by the wall clock, yet is valid at this log time.
      expect(T0 + 10 * HOUR).toBeLessThan(Date.now());
    },
  },
  {
    name: "a chain from another root is refused",
    run: async (auth) => {
      const w = await world(auth);
      expectErr(
        await auth.verify(await rootGrant(w), needs(w, { rootIssuer: w.agent })),
        "wrong_root",
      );
    },
  },
  {
    name: "a token for someone else is refused when the audience is given",
    run: async (auth) => {
      const w = await world(auth);
      expectErr(
        await auth.verify(await rootGrant(w), needs(w, { audience: w.agent })),
        "wrong_audience",
      );
    },
  },
  {
    name: "revocation of the leaf or any proof is honoured",
    run: async (auth) => {
      const w = await world(auth);
      const parent = await rootGrant(w);
      const leaf = expectOk(
        await auth.issue({
          issuer: w.treasurer,
          audience: w.agent,
          capabilities: [w.approve],
          notBefore: T0,
          expiresAt: T0 + 2 * HOUR,
          proofs: [parent],
        }),
      );
      const leafId = await auth.tokenId(leaf);
      const parentId = await auth.tokenId(parent);
      expectOk(await auth.verify(leaf, needs(w, { isRevoked: () => false })));
      expectErr(await auth.verify(leaf, needs(w, { isRevoked: (id) => id === leafId })), "revoked");
      expectErr(
        await auth.verify(leaf, needs(w, { isRevoked: async (id) => id === parentId })),
        "revoked",
      );
    },
  },
  {
    name: "a tampered token is refused",
    run: async (auth) => {
      const w = await world(auth);
      const token = await rootGrant(w);
      const at = Math.floor(token.length / 2);
      const tampered =
        `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}` as CapabilityToken;
      expectErr(await auth.verify(tampered, needs(w)), "bad_signature", "malformed");
    },
  },
  {
    name: "issuing for an identity whose key the adapter does not hold is refused",
    run: async (auth) => {
      const w = await world(auth);
      expectErr(
        await auth.issue({
          issuer: "did:key:z6MkNotOurs",
          audience: w.agent,
          capabilities: [w.approve],
          expiresAt: T0 + HOUR,
        }),
        "unknown_issuer",
      );
    },
  },
  {
    name: "delegation cannot raise the ceiling",
    run: async (auth) => {
      const w = await world(auth);
      await delegateOrRefuse(w, await rootGrant(w), {
        ...w.approve,
        ceiling: money("ZAR", 5000_00),
      });
    },
  },
  {
    name: "delegation cannot drop the ceiling",
    run: async (auth) => {
      const w = await world(auth);
      await delegateOrRefuse(w, await rootGrant(w), { with: w.space, can: "payment/approve" });
    },
  },
  {
    name: "delegation cannot broaden the resource or the ability",
    run: async (auth) => {
      const w = await world(auth);
      const parent = await rootGrant(w, { with: `${w.space}/orders`, can: "order/pledge" });
      await delegateOrRefuse(w, parent, { with: w.space, can: "order/pledge" });
      await delegateOrRefuse(w, parent, { with: `${w.space}/orders`, can: "order/*" });
    },
  },
  {
    name: "delegation cannot extend the expiry",
    run: async (auth) => {
      const w = await world(auth);
      await delegateOrRefuse(w, await rootGrant(w), w.approve, {
        notBefore: T0,
        expiresAt: T0 + 20 * HOUR,
      });
    },
  },
  {
    name: "a delegation from someone the proof was not issued to is refused",
    run: async (auth) => {
      const w = await world(auth);
      const parent = await rootGrant(w); // issued to the treasurer
      const issued = await auth.issue({
        issuer: w.agent,
        audience: w.agent,
        capabilities: [w.approve],
        notBefore: T0,
        expiresAt: T0 + HOUR,
        proofs: [parent],
      });
      if (!issued.ok) {
        expect(["invalid_request", "not_attenuated"]).toContain(issued.error.code);
        return;
      }
      expectErr(await auth.verify(issued.value, needs(w)), "broken_chain");
    },
  },
];

/** Register the `CapabilityAuth` contract against an adapter. */
export function runCapabilityAuthContract(
  factory: Factory<CapabilityAuth>,
  options?: ContractOptions,
): void {
  registerContract("CapabilityAuth contract", capabilityAuthContract, factory, options);
}
