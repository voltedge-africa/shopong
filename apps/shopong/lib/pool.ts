// The pool card's state and words (story 4.6). The Node does the arithmetic and writes the sentences (`poolView` in
// `@shopong/community`); the phone only maps the Node's answer to a state and lays the sentences out. No figure is
// computed here. When the Node cannot be reached, no total is shown as current.
import type { PoolView } from "@shopong/community";
import type { NodeReply } from "./nodeClient";

export const UNREACHABLE_MESSAGE = "We can't reach the Node. Figures may be out of date.";
export const UNREADABLE_MESSAGE = "The books can't be read right now.";

export type PoolScreen =
  | { readonly state: "loading" }
  | { readonly state: "shown"; readonly view: PoolView; readonly checkedAt: number }
  | { readonly state: "unreachable"; readonly message: string }
  | { readonly state: "unavailable"; readonly message: string }
  | { readonly state: "refused"; readonly message: string };

/** The state for the Node's answer. `now` is the phone's clock, kept only to say when the figures were read. */
export function poolScreenOf(reply: NodeReply<PoolView>, now: number): PoolScreen {
  if (reply.ok) return { state: "shown", view: reply.value, checkedAt: now };
  const { failure } = reply;
  if (failure.kind === "offline") return { state: "unreachable", message: UNREACHABLE_MESSAGE };
  if (failure.kind === "refused" && failure.problem === "books_unavailable") {
    return { state: "unavailable", message: UNREADABLE_MESSAGE };
  }
  return { state: "refused", message: failure.reason };
}

/** The sentences the card shows, in three groups: the figures, the people, and the flags (never hidden). */
export interface PoolSections {
  /** The Node's sentence that the figures include simulated payments; empty when the Node says they are real. */
  readonly notice: readonly string[];
  readonly figures: readonly string[];
  readonly people: readonly string[];
  readonly flags: readonly string[];
}

export function poolSections(screen: PoolScreen): PoolSections {
  if (screen.state === "loading")
    return { notice: [], figures: ["Loading the pool."], people: [], flags: [] };
  if (screen.state !== "shown")
    return { notice: [], figures: [screen.message], people: [], flags: [] };
  const { view } = screen;
  // The Node says so beside the figures when they include simulated payments (review item 1).
  const note = (view as { readonly simulatedNote?: unknown }).simulatedNote;
  return {
    notice: typeof note === "string" && note !== "" ? [note] : [],
    figures: [
      view.total.text,
      view.target === null ? "No target yet." : view.target.text,
      view.you.text,
      ...(view.you.shareText === null ? [] : [view.you.shareText]),
    ],
    people: [
      `Your status: ${view.you.status.label}`,
      ...view.members.map(
        (member, index) =>
          `Member ${index + 1}: ${member.status.label}${member.you ? " (you)" : ""}`,
      ),
    ],
    flags: view.flags.map((flag) => flag.text),
  };
}

/** Every sentence the card shows, top to bottom. */
export function poolLines(screen: PoolScreen): string[] {
  const { notice, figures, people, flags } = poolSections(screen);
  return [...notice, ...figures, ...people, ...flags];
}

/** A figure older than this is marked as possibly out of date (triage 2). */
export const STALE_AFTER_MS = 30_000;

/** When the figures were last checked, to the minute, and whether they are now older than `STALE_AFTER_MS`. */
export function freshnessOf(
  checkedAt: number,
  now: number,
): { checkedText: string; stale: boolean } {
  const when = new Date(checkedAt);
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  return { checkedText: `Last checked ${hh}:${mm}`, stale: now - checkedAt > STALE_AFTER_MS };
}
