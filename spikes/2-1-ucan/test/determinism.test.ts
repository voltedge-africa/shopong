// Same inputs, same verdict: a fresh adapter that holds no keys verifies offline, and the
// verdict does not change with the wall clock (AD-6, story 3.6).
import { describe, expect, it, vi } from "vite-plus/test";
import { money, type CapabilityAuth, type CapabilityToken, type Did } from "@shopong/ports";
import { IsoUcanCapabilityAuth } from "../src/iso-ucan/adapter.js";
import { TsUcanCapabilityAuth } from "../src/ts-ucan/adapter.js";

const T0 = 1_000_000;
const HOUR = 3_600_000;

async function scenario(auth: CapabilityAuth) {
  const root = await auth.createIdentity();
  const treasurer = await auth.createIdentity();
  const agent = await auth.createIdentity();
  const space = "ocn:space/det";
  const approve = { with: space, can: "payment/approve", ceiling: money("ZAR", 1000_00) };
  const parent = await auth.issue({
    issuer: root, audience: treasurer, capabilities: [approve], notBefore: T0, expiresAt: T0 + 10 * HOUR,
  });
  if (!parent.ok) throw new Error(parent.error.message);
  const leaf = await auth.issue({
    issuer: treasurer, audience: agent,
    capabilities: [{ ...approve, ceiling: money("ZAR", 200_00) }],
    notBefore: T0, expiresAt: T0 + 2 * HOUR, proofs: [parent.value],
  });
  if (!leaf.ok) throw new Error(leaf.error.message);
  return { root, leaf: leaf.value, space };
}

async function verdicts(auth: CapabilityAuth, root: Did, leaf: CapabilityToken, space: string) {
  const out: string[] = [];
  for (const logTime of [T0 - 1, T0, T0 + HOUR, T0 + 2 * HOUR - 1, T0 + 2 * HOUR, T0 + 11 * HOUR]) {
    for (const minor of [1, 200_00, 200_01, 1000_00]) {
      const r = await auth.verify(leaf, {
        required: { with: `${space}/orders/1`, can: "payment/approve", ceiling: money("ZAR", minor) },
        rootIssuer: root,
        logTime,
      });
      out.push(`${logTime}/${minor}:${r.ok ? "ok" : r.error.code}`);
    }
  }
  return out;
}

describe.each([
  ["ts-ucan", () => new TsUcanCapabilityAuth()],
  ["iso-ucan", () => new IsoUcanCapabilityAuth()],
])("%s determinism", (_name, make) => {
  it("a fresh instance with no keys gives identical verdicts at any wall-clock time", async () => {
    const { root, leaf, space } = await scenario(make());
    const first = await verdicts(make(), root, leaf, space);
    const spy = vi.spyOn(Date, "now").mockReturnValue(4_102_444_800_000); // 2100-01-01
    const second = await verdicts(make(), root, leaf, space);
    spy.mockRestore();
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });
});
