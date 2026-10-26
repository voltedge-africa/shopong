// What the phone shows when the Node's status for a pledge could not be read (story 4.3, review item 6). The answer is
// read by the kind of failure, as `nodeFailureMessage` does for other calls: a network failure says the Node could not be
// reached; a clock refusal says to check the clock; "pledge not on the Node" says the pledge has not arrived yet; a
// "try later" says the Node is busy; any other refusal is unreadable. A status is never taken from anything but the
// Node's own answer, so a redirect or a return link cannot make a payment look paid.
import type { NodeFailure } from "./nodeClient";

/** The statuses a failed read can give. Each has its own card (see `payCardOf`). */
export type FailedStatus = "unreachable" | "clock" | "not_reached" | "busy" | "unreadable";

export function paymentStatusOfFailure(failure: NodeFailure): FailedStatus {
  if (failure.kind === "offline") return "unreachable";
  if (failure.kind === "clock") return "clock";
  if (failure.kind === "waiting") return "busy";
  if (failure.problem === "unknown_pledge") return "not_reached";
  return "unreadable";
}

/** The event id of a pledge as the phone's record view holds it, or undefined when there is none. */
export function storedPledgeEvent(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const event = (value as { event?: unknown }).event;
  return typeof event === "string" ? event : undefined;
}
