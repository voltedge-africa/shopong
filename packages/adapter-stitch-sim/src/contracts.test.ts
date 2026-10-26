// The Payments contract suites, run unchanged against the simulated Stitch. Both the in-memory and the
// persisted variants must pass. The network is trapped: the simulation must never call fetch.
import { afterAll, beforeAll } from "vite-plus/test";
import { runPayInContract, runPayOutContract } from "@shopong/ports-contract";
import { createSimulatedStitch } from "./index.js";
import { randomKey, scratchFolder, webCryptoHmac } from "./testing.js";

const folder = scratchFolder();
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = () => {
    throw new Error("the simulated Stitch must not make network calls");
  };
});

afterAll(() => {
  globalThis.fetch = realFetch;
  folder.cleanup();
});

// Payment processors run on the wall clock; only the expiry tests move a manual clock.
const wallClock = { now: () => Date.now() };

let counter = 0;
function simulate(persisted: boolean) {
  const options = {
    webhookKey: randomKey(),
    hmac: webCryptoHmac,
    clock: wallClock,
    ...(persisted ? { stateFile: folder.file(`contract-${String(++counter)}.json`) } : {}),
  };
  return createSimulatedStitch(options);
}

for (const persisted of [false, true]) {
  runPayInContract(
    () => {
      const sim = simulate(persisted);
      return { payIn: sim.payIn, settle: async (id, outcome) => sim.payIn.settle(id, outcome) };
    },
    { timeoutMs: 10_000 },
  );

  runPayOutContract(
    () => {
      const sim = simulate(persisted);
      return { payOut: sim.payOut, settle: async (id, outcome) => sim.payOut.settle(id, outcome) };
    },
    { timeoutMs: 10_000 },
  );
}
