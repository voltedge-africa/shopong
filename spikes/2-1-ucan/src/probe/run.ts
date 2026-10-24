// Run the CapabilityAuth contract cases and the AD-18 seed check by hand, for one adapter,
// and return a plain report. Used by the Expo probe (Hermes bundle, web export) and the
// Node/Chromium runners so every runtime runs the same cases.
import type { CapabilityAuth } from "@shopong/ports";
import { capabilityAuthContract } from "@shopong/ports-contract";
import { hexToBytes } from "@noble/hashes/utils.js";
import { identitySeed } from "../identity/seed.js";

export interface CaseResult {
  readonly name: string;
  readonly pass: boolean;
  readonly ms: number;
  readonly error?: string;
}

export interface Report {
  readonly adapter: string;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly CaseResult[];
  readonly did?: string;
}

const RECOVERY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
export const GOLDEN_DID = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : 0);

export async function runProbe(
  adapter: string,
  factory: () => CapabilityAuth,
  didFromSeed: (seed: Uint8Array) => Promise<string>,
): Promise<Report> {
  const cases: CaseResult[] = [];
  const run = async (name: string, fn: () => Promise<void>) => {
    const start = now();
    try {
      await fn();
      cases.push({ name, pass: true, ms: Math.round(now() - start) });
    } catch (e) {
      const error = e instanceof Error ? `${e.message}` : String(e);
      cases.push({ name, pass: false, ms: Math.round(now() - start), error });
    }
  };
  for (const c of capabilityAuthContract) await run(c.name, () => c.run(factory()));
  let did: string | undefined;
  await run("AD-18: recovery seed derives the golden did:key", async () => {
    did = await didFromSeed(identitySeed(hexToBytes(RECOVERY)));
    if (did !== GOLDEN_DID) throw new Error(`derived ${did}, expected ${GOLDEN_DID}`);
  });
  const passed = cases.filter((c) => c.pass).length;
  return { adapter, passed, failed: cases.length - passed, cases, ...(did === undefined ? {} : { did }) };
}
