// The words the Timeline screen lays out. Pure, so the screen and the tests use one set. The Node writes the sentences
// (`transactionTimeline` in `@shopong/community`); this file only orders them for the screen and names the tone of the
// agreement.

import { randWords, type AgreementState, type Timeline } from "@shopong/community";
import type { TimelinePayment } from "./host";

/** The first characters of an event id, as the screen shows them so a person can match them. */
export const SHORT_ID = 8;

export interface StepLine {
  readonly key: string;
  readonly label: string;
  readonly words: string;
  /** The event id a person can match, shortened; absent for a step that shows no record event. */
  readonly ref?: string;
}

/** The steps in the order the Node gives them, each with its label, sentence and short event id. */
export function stepLines(timeline: Timeline): readonly StepLine[] {
  return timeline.steps.map((step, index) => ({
    key: `${String(index)}-${step.kind}`,
    label: step.label,
    words: step.words,
    ...(step.eventId === undefined ? {} : { ref: step.eventId.slice(0, SHORT_ID) }),
  }));
}

/** The tone of the agreement line: `ok` when the record and the books agree, `warn` when they differ, else `neutral`. */
export function agreementTone(state: AgreementState): "ok" | "warn" | "neutral" {
  if (state === "agree") return "ok";
  if (state === "disagree") return "warn";
  return "neutral";
}

/** The button's words for one payment in the list: the order and the amount, in rand. */
export function paymentLabel(payment: TimelinePayment): string {
  return `${payment.order}: ${randWords(payment.minor)}`;
}
