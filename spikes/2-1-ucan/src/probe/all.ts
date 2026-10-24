// Both adapters through the same probe. Import each separately if you need per-library
// bundle sizes (see expo-probe/README.md).
import { runProbe, type Report } from "./run.js";
import { InhouseCapabilityAuth } from "../inhouse/adapter.js";
import { IsoUcanCapabilityAuth } from "../iso-ucan/adapter.js";
import { TsUcanCapabilityAuth } from "../ts-ucan/adapter.js";
import {
  inhouseDidFromSeed,
  isoUcanSignerFromSeed,
  tsUcanKeypairFromSeed,
} from "../identity/keys.js";

export async function runAll(): Promise<Report[]> {
  return [
    await runProbe("ts-ucan 0.12.0", () => new TsUcanCapabilityAuth(), async (seed) =>
      tsUcanKeypairFromSeed(seed).did(),
    ),
    await runProbe("iso-ucan 2.0.0", () => new IsoUcanCapabilityAuth(), async (seed) =>
      (await isoUcanSignerFromSeed(seed)).did,
    ),
    await runProbe("in-house minimal chain", () => new InhouseCapabilityAuth(), async (seed) =>
      inhouseDidFromSeed(seed),
    ),
  ];
}
