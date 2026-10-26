// The plain words the community card shows about syncing (story 3.4). Pure: the screen passes in the sync state and
// the netinfo hint, and gets sentences a person can act on. The last sync result is the truth; the hint only adds
// "you are offline" before the first sync has answered.

import type { SyncState } from "./sync";

export interface SyncLine {
  /** One sentence for the headline of the sync block. */
  readonly headline: string;
  /** A second sentence: what the person can do, or a note. */
  readonly detail?: string;
  /** Whether the card offers "Try again" and "Remove this change" (a refused item). */
  readonly tryAgain: boolean;
  readonly tone: "good" | "waiting" | "problem";
}

const count = (n: number, one: string, many: string) =>
  n === 1 ? one : many.replace("{n}", String(n));
const waitingWords = (n: number) =>
  count(n, "Waiting to send 1 change.", "Waiting to send {n} changes.");

export function syncLine(input: {
  readonly state: SyncState;
  /** netinfo says the phone has no connection right now. */
  readonly offlineHint: boolean;
  /** The build sets no Node address, or the address is not usable. */
  readonly noNodeReason?: string;
  readonly onWeb: boolean;
}): SyncLine {
  const { state, offlineHint, onWeb } = input;
  const notes: string[] = [];
  if (state.setAside === true) {
    notes.push("Some waiting changes could not be read and were set aside.");
  }
  if ((state.ignored ?? 0) > 0) {
    notes.push(`${state.ignored} entries from the Node could not be checked and were ignored.`);
  }
  if (onWeb && state.pending > 0) {
    notes.push("On the web, changes waiting to send are lost if this page is reloaded.");
  }
  const withNotes = (line: SyncLine): SyncLine =>
    notes.length === 0
      ? line
      : { ...line, detail: [line.detail, ...notes].filter(Boolean).join(" ") };

  if (input.noNodeReason !== undefined) {
    return withNotes({
      headline: input.noNodeReason,
      detail: "Changes stay on this phone for now.",
      tryAgain: false,
      tone: "waiting",
    });
  }
  switch (state.result) {
    case "refused":
      return withNotes({
        headline: count(state.pending, "Could not send 1 change.", "Could not send {n} changes."),
        detail: state.refusal,
        tryAgain: true,
        tone: "problem",
      });
    case "clock_skew":
      return withNotes({
        headline: "Check your phone's clock.",
        detail: `${waitingWords(state.pending)} They will go once the clocks agree.`,
        tryAgain: false,
        tone: "problem",
      });
    case "waiting":
      return withNotes({
        headline: waitingWords(state.pending),
        detail: "The Node will take them once it can.",
        tryAgain: false,
        tone: "waiting",
      });
    case "offline":
      return withNotes({
        headline: "You are offline. Your changes are saved on your phone.",
        detail: state.pending > 0 ? waitingWords(state.pending) : undefined,
        tryAgain: false,
        tone: "waiting",
      });
    case "none":
      if (offlineHint) {
        return withNotes({
          headline: "You are offline. Your changes are saved on your phone.",
          detail: state.pending > 0 ? waitingWords(state.pending) : undefined,
          tryAgain: false,
          tone: "waiting",
        });
      }
      return withNotes({
        headline: "Not yet synced with your OCN Node.",
        tryAgain: false,
        tone: "waiting",
      });
    case "connected":
      if (state.pending > 0) {
        return withNotes({
          headline: waitingWords(state.pending),
          tryAgain: false,
          tone: "waiting",
        });
      }
      return withNotes({ headline: "Connected to your OCN Node.", tryAgain: false, tone: "good" });
    case "no_node":
      return withNotes({
        headline: "No OCN Node is set for this build.",
        detail: "Changes stay on this phone for now.",
        tryAgain: false,
        tone: "waiting",
      });
  }
}
