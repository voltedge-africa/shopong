// SIMULATED Stitch (story 4.4). A stand-in for the Stitch adapter behind the Payments port. It makes no network
// call, reads no Stitch credential and is never a fact about Stitch: every surface it writes says "simulated".
// The Node selects it with PAYMENTS_ADAPTER=simulated. Plan: docs/decisions/4-4-stitch-sandbox-proof.md.
import type { HmacSha512 } from "@shopong/events";
import type { Clock } from "@shopong/ports";
import { SimulatedPayIn } from "./pay-in.js";
import { SimulatedPayOut } from "./pay-out.js";
import { LOG_TAG, SIMULATED_MODE, SimulatedStore, type LateCompletion } from "./store.js";

export { SIGNATURE_HEADER, signBody, signatureValid } from "./signature.js";
export { stitchAmount } from "./amount.js";
export {
  SimulatedPayIn,
  type SimulatedWebhookOutcome,
  type TerminalOutcome,
  type WebhookReading,
} from "./pay-in.js";
export { SimulatedPayOut } from "./pay-out.js";
export { LOG_TAG, SIMULATED_MODE, requestRef, type LateCompletion } from "./store.js";

export interface SimulatedStitchOptions {
  /** The Node's webhook key: 32 bytes. Held by the Node only; never a Stitch credential. */
  readonly webhookKey: Uint8Array;
  /** The HMAC-SHA512 the Node injects (its own crypto module), as the commitments do. */
  readonly hmac: HmacSha512;
  /** Defaults to the wall clock: a processor runs on its own time. */
  readonly clock?: Clock;
  /** JSON state file in the Node's data folder. Omitted: in memory for this process only. */
  readonly stateFile?: string;
  /** Receives log lines, each prefixed with the simulation's tag. */
  readonly log?: (line: string) => void;
}

export interface SimulatedStitch {
  /** Always `simulated-stitch`. Reported as the component's mode. */
  readonly mode: typeof SIMULATED_MODE;
  readonly payIn: SimulatedPayIn;
  readonly payOut: SimulatedPayOut;
  /** Completions that arrived after expiry: flagged, not applied. For reconciliation. */
  lateCompletions(): readonly LateCompletion[];
}

/** Builds the simulated Stitch. Throws, naming the file, if the state file cannot be read. */
export function createSimulatedStitch(options: SimulatedStitchOptions): SimulatedStitch {
  if (options.webhookKey.length !== 32) {
    throw new TypeError(`${LOG_TAG} the webhook key must be 32 bytes`);
  }
  const store = new SimulatedStore(options);
  return {
    mode: SIMULATED_MODE,
    payIn: new SimulatedPayIn(store),
    payOut: new SimulatedPayOut(store),
    lateCompletions: () => store.lateCompletions(),
  };
}
