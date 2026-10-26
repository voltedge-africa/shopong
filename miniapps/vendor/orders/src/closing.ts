// The words on the closing screen (story 8.7). Pure, so the panel and the tests use one set. The summary itself is read from
// the record and the pool by `@shopong/community` (`closingSummary`); this file only words what the screen adds.

import type { TimelineLine } from "@shopong/community";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day in the words a member reads: `26 Oct 2026`. In UTC, so every phone says the same thing. */
export function dayWords(at: number): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCFullYear()}`;
}

/** One timeline line: the sentence, with its day when the record holds a time for it. */
export function timelineWords(line: TimelineLine): string {
  return line.at === undefined ? line.sentence : `${line.sentence} (${dayWords(line.at)})`;
}

/** The sentence under the treasurer's button, asking for the confirmation before anything is sent. */
export const CONFIRM_CLOSE =
  "Close this order? Every member has collected. The summary is shared with everyone. No money moves when an order is closed.";

export const CLOSED_WORDS = "This order is closed.";

/** What each member's line says about collection. */
export function collectedWords(collected: boolean): string {
  return collected ? "Collected" : "Not collected yet";
}
