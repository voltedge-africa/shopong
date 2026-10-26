// The simulated payments on the OCN Node (story 4.4). The Node holds the simulation's webhook key; nothing here
// calls Stitch or reads a Stitch credential. Every surface this module feeds says "simulated": the component's
// mode, the start-up line, the routes' answers and their audit lines.

import { join } from "node:path";
import {
  createSimulatedStitch,
  SIMULATED_MODE,
  type SimulatedStitch,
} from "@shopong/adapter-stitch-sim";
import { nodeHmacSha512 } from "./commitments.ts";
import type { NodeComponent } from "./components.ts";
import { ConfigError, type ResolvedSecrets } from "./secrets.ts";

export { SIMULATED_MODE };

export const SIMULATED_WEBHOOK_KEY = "SIMULATED_WEBHOOK_SECRET";
/** The simulated requests and disbursements, in the Node's data folder. */
export const PAYMENTS_STATE_FILE = "payments-simulated.json";

/**
 * The simulation's webhook key from the secret registry: 32 bytes as 64 hex characters. A placeholder, or one
 * repeated digit, is refused by name, never by value.
 */
export function simulatedWebhookKeyOf(secrets: ResolvedSecrets): Uint8Array {
  const hex = secrets.get(SIMULATED_WEBHOOK_KEY) ?? "";
  // More than four different characters: a repeated digit, or a short pattern repeated, is a placeholder (review item 8).
  const distinct = new Set(hex.toLowerCase()).size;
  const shaped = /^[0-9a-fA-F]{64}$/u.test(hex) && distinct > 4;
  if (!shaped) {
    throw new ConfigError(
      `${SIMULATED_WEBHOOK_KEY} must be 64 hex characters (32 bytes) with more than four different characters, not a placeholder`,
      [SIMULATED_WEBHOOK_KEY],
    );
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** Builds the simulated Stitch on the Node: its state in the data folder, its log lines through the Node's logger. */
export function openSimulatedPayments(options: {
  readonly dataDir: string;
  readonly secrets: ResolvedSecrets;
  readonly log: (line: string) => void;
}): SimulatedStitch {
  return createSimulatedStitch({
    webhookKey: simulatedWebhookKeyOf(options.secrets),
    hmac: nodeHmacSha512,
    stateFile: join(options.dataDir, PAYMENTS_STATE_FILE),
    log: options.log,
  });
}

/** The payments component's health: `ok` in simulated mode when enabled, `disabled` when switched off. */
export function paymentsComponent(enabled: boolean): NodeComponent {
  return {
    name: "payments",
    async check() {
      if (!enabled) return { status: "disabled" };
      return { status: "ok", mode: SIMULATED_MODE };
    },
  };
}
