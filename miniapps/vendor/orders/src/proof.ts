// The words a person sees for the delivery of an order (story 7.6). Pure, so the panel and the tests use one set. The host
// (apps/shopong) reads the record and the queue; this package only words the answer.

import type { ProofView } from "./host";

/** Whose turn it is to act on the delivery, from this phone's point of view. */
export type ArrivalState = "not_planned" | "waiting_for_driver" | "driver_to_confirm" | "arrived";

/** Where the delivery stands for this phone: nothing planned, waiting for the driver, the driver to confirm, or arrived. */
export function arrivalWords(view: ProofView, me: string): { state: ArrivalState; words: string } {
  if (view.arrived) return { state: "arrived", words: "Arrived. The goods are with the members." };
  if (view.plannedDriver === undefined) {
    return { state: "not_planned", words: "No delivery is planned for this order yet." };
  }
  if (view.plannedDriver === me) {
    return {
      state: "driver_to_confirm",
      words: "You are driving this delivery. Confirm when it arrives.",
    };
  }
  return { state: "waiting_for_driver", words: "Waiting for the driver to confirm the arrival." };
}

/** The help line under the driver's button: what the photo is for, and that the phone keeps it until it is sent. */
export const ARRIVAL_HELP =
  "Take the photo at the drop-off point, of the goods. It is sent to the OCN Node. If there is no network, it waits on this phone.";

/** "2 of 5 collected", or the plain words for an order with no shares yet. */
export function progressWords(collected: number, of: number): string {
  if (of === 0) return "No members have a share in this order yet.";
  return `${collected} of ${of} collected`;
}

/** The words for one member's own collection: the button's line, or the fact that it is recorded. */
export function collectionWords(view: ProofView, me: string): string | undefined {
  if (!view.arrived) return undefined;
  const mine = view.shares.find((share) => share.member === me);
  if (mine === undefined) return undefined;
  return mine.collected
    ? "You have confirmed your collection."
    : "Confirm that you have collected your share.";
}

/** The dispute list's lines: each dispute in the words the record holds, with the note as the person wrote it. */
export function disputeWords(view: ProofView): readonly string[] {
  return view.disputes.map((dispute) =>
    dispute.note === undefined
      ? "A member says a share did not arrive."
      : `A member says: ${dispute.note}`,
  );
}
