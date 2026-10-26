/**
 * What each capability tool does, as far as a generated interface cares (story 11.4, AD-17):
 *
 * - `read`: returns data and changes nothing. A component may show its result (`reads`).
 * - `write`: changes the community's record. A button may trigger it (`actions`).
 * - `money`: moves money. A button may trigger it, and the capability returns `needs-confirmation`
 *   until the member approves (story 11.2), so the generated screen cannot skip that step.
 *
 * The names are the architecture's (AD-17 and the flows in 4.x). Only the first three are listed by the
 * OCN Capability MCP server today (`apps/node/src/capability-tools.ts`); the rest are declared so the
 * library can be written now, and a tool that is not listed here cannot be bound by any component.
 */
export type CapabilityKind = "read" | "write" | "money";

export const CAPABILITY_KINDS: Readonly<Record<string, CapabilityKind>> = {
  "ledger.read": "read",
  "members.list": "read",
  "pledges.query": "read",
  "quote.compare": "read",
  "route.plan": "read",
  "order.propose": "write",
  "message.send": "write",
  "delivery.confirm": "write",
  "payment.request": "money",
};

/** The capability kind of a tool, or undefined if the catalogue does not know it. */
export function capabilityKindOf(tool: string): CapabilityKind | undefined {
  return Object.hasOwn(CAPABILITY_KINDS, tool) ? CAPABILITY_KINDS[tool] : undefined;
}
