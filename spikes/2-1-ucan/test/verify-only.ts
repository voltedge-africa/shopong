// Run the contract with issue-time checks off. One contract case is wrong in this mode for
// every adapter, including the in-memory reference (memory-reference.test.ts): its leaf has
// `expiresAt: T0 + HOUR` and is verified at `logTime: T0 + HOUR`, so `expired` is the
// correct answer, not `broken_chain`. It is marked `it.fails` and reported as a
// contract-suite follow-up in the decision record.
import { describe, it } from "vite-plus/test";
import type { CapabilityAuth } from "@shopong/ports";
import { capabilityAuthContract } from "@shopong/ports-contract";

export const KNOWN_CONTRACT_ISSUE =
  "a delegation from someone the proof was not issued to is refused";

export function runVerifyOnly(name: string, factory: () => CapabilityAuth): void {
  describe(name, () => {
    for (const c of capabilityAuthContract) {
      (c.name === KNOWN_CONTRACT_ISSUE ? it.fails : it)(c.name, async () => c.run(factory()));
    }
  });
}
