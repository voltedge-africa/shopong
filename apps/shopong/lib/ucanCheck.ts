// A quick check that the UCAN adapter works in the running app, on the engine the app runs on. It is the
// short version of the CapabilityAuth contract: the cases a phone is most likely to get wrong. The full
// contract runs in Node against the same adapter (packages/adapter-ucan-iso).
import { installedPolyfills } from "./cryptoPolyfills";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { money, type Capability, type CapabilityAuth, type CapabilityToken } from "@shopong/ports";

// Fixed times, far from today, so a verify that read the clock would fail.
const T0 = 1_000_000;
const HOUR = 3_600_000;

export interface CheckCase {
  readonly name: string;
  readonly pass: boolean;
  readonly ms: number;
  readonly error?: string;
}

export interface CheckReport {
  readonly engine: string;
  readonly polyfills: readonly string[];
  readonly cases: readonly CheckCase[];
  readonly passed: number;
  readonly failed: number;
}

class Failed extends Error {}
function must(condition: boolean, what: string): void {
  if (!condition) throw new Failed(what);
}

export function engineName(): string {
  return (globalThis as { HermesInternal?: unknown }).HermesInternal ? "hermes" : "other";
}

export async function runUcanCheck(
  auth: CapabilityAuth = new IsoUcanCapabilityAuth(),
): Promise<CheckReport> {
  const cases: CheckCase[] = [];
  const run = async (name: string, fn: () => Promise<void>) => {
    const start = Date.now();
    try {
      await fn();
      cases.push({ name, pass: true, ms: Date.now() - start });
    } catch (e) {
      cases.push({ name, pass: false, ms: Date.now() - start, error: String(e) });
    }
  };

  const space = "ocn:space/ucan-check";
  const approve: Capability = {
    with: space,
    can: "payment/approve",
    ceiling: money("ZAR", 1000_00),
  };
  const root = await auth.createIdentity();
  const treasurer = await auth.createIdentity();
  const agent = await auth.createIdentity();
  const need = (required: Capability, over: object = {}) => ({
    required,
    rootIssuer: root,
    logTime: T0 + HOUR,
    ...over,
  });
  const grant = async (): Promise<CapabilityToken> => {
    const issued = await auth.issue({
      issuer: root,
      audience: treasurer,
      capabilities: [approve],
      notBefore: T0,
      expiresAt: T0 + 10 * HOUR,
    });
    must(issued.ok, "root grant was refused");
    return (issued as { value: CapabilityToken }).value;
  };

  await run("identities are distinct", async () => {
    must(new Set([root, treasurer, agent]).size === 3, "two identities are equal");
  });
  await run("a root grant verifies for what it grants", async () => {
    const result = await auth.verify(await grant(), need(approve));
    must(result.ok, `verify failed: ${JSON.stringify(result)}`);
  });
  await run("a request above the ceiling is refused", async () => {
    const above: Capability = { ...approve, ceiling: money("ZAR", 5000_00) };
    must(!(await auth.verify(await grant(), need(above))).ok, "an over-ceiling request verified");
  });
  await run("a delegated chain verifies", async () => {
    const lower: Capability = { ...approve, ceiling: money("ZAR", 500_00) };
    const delegated = await auth.issue({
      issuer: treasurer,
      audience: agent,
      capabilities: [lower],
      notBefore: T0,
      expiresAt: T0 + 2 * HOUR,
      proofs: [await grant()],
    });
    must(delegated.ok, "delegation was refused");
    const result = await auth.verify((delegated as { value: CapabilityToken }).value, need(lower));
    must(result.ok, `chain failed: ${JSON.stringify(result)}`);
  });
  await run("a delegation cannot raise the ceiling", async () => {
    const higher: Capability = { ...approve, ceiling: money("ZAR", 5000_00) };
    const issued = await auth.issue({
      issuer: treasurer,
      audience: agent,
      capabilities: [higher],
      notBefore: T0,
      expiresAt: T0 + 2 * HOUR,
      proofs: [await grant()],
    });
    if (issued.ok) {
      must(!(await auth.verify(issued.value, need(higher))).ok, "a raised ceiling verified");
    }
  });
  await run("a token is expired at the supplied time", async () => {
    const result = await auth.verify(await grant(), need(approve, { logTime: T0 + 10 * HOUR }));
    must(
      !result.ok && result.error.code === "expired",
      `expected expired: ${JSON.stringify(result)}`,
    );
  });
  await run("a tampered token is refused", async () => {
    const token = await grant();
    const mid = Math.floor(token.length / 2);
    const swapped = token[mid] === "A" ? "B" : "A";
    const tampered = (token.slice(0, mid) + swapped + token.slice(mid + 1)) as CapabilityToken;
    must(!(await auth.verify(tampered, need(approve))).ok, "a tampered token verified");
  });
  await run("a chain from another root is refused", async () => {
    const other = await auth.createIdentity();
    const result = await auth.verify(await grant(), need(approve, { rootIssuer: other }));
    must(
      !result.ok && result.error.code === "wrong_root",
      `expected wrong_root: ${JSON.stringify(result)}`,
    );
  });
  await run("a revoked token is refused", async () => {
    const result = await auth.verify(await grant(), need(approve, { isRevoked: () => true }));
    must(
      !result.ok && result.error.code === "revoked",
      `expected revoked: ${JSON.stringify(result)}`,
    );
  });

  const passed = cases.filter((c) => c.pass).length;
  return {
    engine: engineName(),
    polyfills: installedPolyfills,
    cases,
    passed,
    failed: cases.length - passed,
  };
}
