// Evidence about @ucans/ucans 0.12.0 itself, without our adapter. Each test pins one fact
// the decision record relies on.
import { describe, expect, it } from "vite-plus/test";
import * as ucans from "@ucans/ucans";
import { underTrap } from "../src/trap.js";

const space = "ocn:space/s1";
const approve = ucans.capability.parse({ with: space, can: "payment/approve" });
const nowS = () => Math.floor(Date.now() / 1000);

async function chain(opts: { rootNbf?: number; rootFacts?: ucans.Fact[]; childFacts?: ucans.Fact[] }) {
  const root = await ucans.EdKeypair.create();
  const treasurer = await ucans.EdKeypair.create();
  const agent = await ucans.EdKeypair.create();
  const parent = await ucans.build({
    issuer: root,
    audience: treasurer.did(),
    capabilities: [approve],
    expiration: nowS() + 3600,
    ...(opts.rootNbf === undefined ? {} : { notBefore: opts.rootNbf }),
    ...(opts.rootFacts === undefined ? {} : { facts: opts.rootFacts }),
  });
  const leaf = await ucans.build({
    issuer: treasurer,
    audience: agent.did(),
    capabilities: [approve],
    expiration: nowS() + 1800,
    proofs: [ucans.encode(parent)],
    ...(opts.childFacts === undefined ? {} : { facts: opts.childFacts }),
  });
  return { root, agent, leaf: ucans.encode(leaf) };
}

describe("@ucans/ucans 0.12.0 library behaviour", () => {
  it("verify has no time input: a token valid at log time 1970 is rejected as expired", async () => {
    const root = await ucans.EdKeypair.create();
    const holder = await ucans.EdKeypair.create();
    const token = ucans.encode(
      await ucans.build({
        issuer: root,
        audience: holder.did(),
        capabilities: [approve],
        notBefore: 1000,
        expiration: 37000,
      }),
    );
    const result = await ucans.verify(token, {
      audience: holder.did(),
      requiredCapabilities: [{ capability: approve, rootIssuer: root.did() }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error[0]?.message)).toMatch(/Expired/);
  });

  it("verify reads the wall clock (trapped Date.now makes it fail)", async () => {
    const { root, agent, leaf } = await chain({});
    const result = await underTrap(() =>
      ucans.verify(leaf, {
        audience: agent.did(),
        requiredCapabilities: [{ capability: approve, rootIssuer: root.did() }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((e) => e.message).join()).toMatch(/Date\.now read/);
  });

  it("control: a two-link chain without nbf verifies", async () => {
    const { root, agent, leaf } = await chain({});
    const result = await ucans.verify(leaf, {
      audience: agent.did(),
      requiredCapabilities: [{ capability: approve, rootIssuer: root.did() }],
    });
    expect(result.ok).toBe(true);
  });

  it("BUG: any proof with nbf breaks the chain (inverted time-bounds subset check)", async () => {
    // validateProofs: `proof.nbf != null && ucan.exp > proof.nbf` -> "'Not before' is after
    // parent's expiration". Every sane child (exp after the parent's nbf) trips it.
    const { root, agent, leaf } = await chain({ rootNbf: nowS() - 60 });
    const result = await ucans.verify(leaf, {
      audience: agent.did(),
      requiredCapabilities: [{ capability: approve, rootIssuer: root.did() }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((e) => e.message).join()).toMatch(/Not before/);
  });

  it("ceilings are not enforced: facts are invisible to delegation semantics", async () => {
    const { root, agent, leaf } = await chain({
      rootFacts: [{ "ocn/ceilings": { "0": { currency: "ZAR", minor: 1000_00 } } }],
      childFacts: [{ "ocn/ceilings": { "0": { currency: "ZAR", minor: 5000_00 } } }],
    });
    const result = await ucans.verify(leaf, {
      audience: agent.did(),
      requiredCapabilities: [{ capability: approve, rootIssuer: root.did() }],
    });
    expect(result.ok).toBe(true); // the raised ceiling passes; only our code can refuse it
  });

  it("default semantics only allow equal resources; path narrowing needs custom semantics", async () => {
    const root = await ucans.EdKeypair.create();
    const holder = await ucans.EdKeypair.create();
    const token = ucans.encode(
      await ucans.build({
        issuer: root,
        audience: holder.did(),
        capabilities: [approve],
        expiration: nowS() + 3600,
      }),
    );
    const narrower = ucans.capability.parse({ with: `${space}/orders/1`, can: "payment/approve" });
    const result = await ucans.verify(token, {
      audience: holder.did(),
      requiredCapabilities: [{ capability: narrower, rootIssuer: root.did() }],
    });
    expect(result.ok).toBe(false);
  });
});
