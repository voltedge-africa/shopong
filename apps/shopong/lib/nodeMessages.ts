// Plain sentences for a Node failure, shown where a person asked for something the Node must do (story 3.4).

import type { NodeFailure } from "./nodeClient";

/** "It did not make the community", and so on. `action` is a bare verb phrase. */
export function nodeFailureMessage(failure: NodeFailure, action: string): string {
  if (failure.kind === "offline") {
    return `The OCN Node cannot be reached, so it did not ${action}. Try again when you are online.`;
  }
  if (failure.kind === "waiting")
    return `The OCN Node is not ready for that yet. Try again in a moment.`;
  return failure.reason;
}

/** The sentence for a change the Node has, or a step the Node took, that the phone could not queue (review P3). */
export function unqueuedMessage(done: string, reason: string): string {
  return `${done}, but ${reason.charAt(0).toLowerCase()}${reason.slice(1)} It is not recorded yet.`;
}
