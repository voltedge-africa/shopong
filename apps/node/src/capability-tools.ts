// The first capability tools the OCN Capability MCP server lists (story 11.2). Each has a schema, one required ability
// and a kind. The handlers are injected by the Node: until a capability is wired, its tool answers that it isn't connected.
// Later stories add tools here (route.plan, quote.compare, ...); the server code does not change.

import { z } from "zod";
import { formatRand } from "@shopong/community";
import type { JsonValue } from "@shopong/ports";
import { defineTool, type CapabilityTool, type ToolRun } from "./capability-mcp.ts";

const space = z.string().min(1).max(200);
const text = z.string().min(1).max(200);
const zar = z.strictObject({
  currency: z.literal("ZAR"),
  minor: z.number().int().positive().max(100_000_000),
});

export const ledgerReadInput = z.strictObject({ space, account: text.optional() });
export const orderProposeInput = z.strictObject({
  space,
  name: text,
  items: z
    .array(z.strictObject({ name: text, quantity: z.number().int().positive().max(100_000) }))
    .min(1)
    .max(100),
});
export const paymentRequestInput = z.strictObject({
  space,
  /** The member to pay (a member id, never a phone number). */
  payee: text,
  amount: zar,
  reference: text,
});

type Handler<I> = (input: I, ctx: ToolRun) => Promise<JsonValue>;

export interface CapabilityHandlers {
  readonly "ledger.read"?: Handler<z.output<typeof ledgerReadInput>>;
  readonly "order.propose"?: Handler<z.output<typeof orderProposeInput>>;
  readonly "payment.request"?: Handler<z.output<typeof paymentRequestInput>>;
}

const notConnected = async (): Promise<JsonValue> => {
  throw new Error("not connected");
};

/** The default tool set. `payment.request` is money: it only ever runs after the member approves. */
export function defaultCapabilityTools(handlers: CapabilityHandlers = {}): CapabilityTool[] {
  return [
    defineTool({
      name: "ledger.read",
      description: "Read a community's books: balances and recent entries.",
      kind: "read",
      ability: "ledger/read",
      input: ledgerReadInput,
      run: handlers["ledger.read"] ?? notConnected,
    }),
    defineTool({
      name: "order.propose",
      description: "Propose a group order for the community to approve.",
      kind: "write",
      ability: "order/propose",
      input: orderProposeInput,
      run: handlers["order.propose"] ?? notConnected,
    }),
    defineTool({
      name: "payment.request",
      description:
        "Ask to pay a member from the community's pool. Waits for the member to approve.",
      kind: "money",
      ability: "payment/approve",
      input: paymentRequestInput,
      amount: (input) => input.amount,
      summary: (input) =>
        `Pay ${formatRand(input.amount)} to ${input.payee} for ${input.reference}`,
      run: handlers["payment.request"] ?? notConnected,
    }),
  ];
}
