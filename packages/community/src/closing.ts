// Collecting and closing an order (story 8.7). Each member confirms their own collection (`collection.confirmed`, story 7.6);
// then the treasurer closes the order (`order.closed`). `apply` judges the close at log time (story 3.6) with the checks here,
// and the closing screen reads the same record and the pool view (story 4.6) to show the summary. Nothing here moves money
// (story 4.8 is not built): a difference is said in words only. Pure over the view: no clock, no network (AGENTS rule 3).
//
// View key: `closed/<order>` { event, by, claimedAt }. The order is kept as it was (its status is not changed), so the pool's
// target and the earlier stories' rules read the order as before (shortcut S-8.7-4).

import type { ViewReader } from "@shopong/ports";
import { collectedKey, deliveredKey, deliveredOf } from "./delivery-proof.js";
import { deliveryKey } from "./delivery.js";
import { orderKey, storedOrderOf } from "./orders.js";
import { pledgeKey, type StoredPledge } from "./pledges.js";
import { randText, type PoolView } from "./pool.js";
import { selectionOf } from "./selection.js";

/** The plain sentences a person sees when a close is refused. */
export const CLOSE_MESSAGES = {
  not_permitted: "Only the treasurer can close an order.",
  unreadable: "This closing can't be read.",
  not_delivered: "The delivery has not been confirmed yet.",
  already_closed: "This order is already closed.",
  nobody: "Nobody has a share in this order yet.",
  not_writable: "Your phone is not set up to write to this community yet.",
  save_failed: "The order could not be closed. Try again.",
} as const;

/** "Not everyone has collected yet: A, B." */
export const notCollectedMessage = (names: readonly string[]): string =>
  `Not everyone has collected yet: ${names.join(", ")}.`;

/** The view key of a closed order. The name is encoded, so no name can clash with a path. */
export const closedKey = (order: string) => `closed/${encodeURIComponent(order)}`;

/** A member as the record can name them: the record holds no display name, only the did:key, so a short form of it. */
export function memberLabel(did: string): string {
  const prefix = "did:key:";
  if (!did.startsWith(prefix)) return did;
  const key = did.slice(prefix.length);
  return key.length <= 18 ? did : `${prefix}${key.slice(0, 12)}…${key.slice(-6)}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every pledge made to the order, as the view holds it: the members with a share. */
async function pledgesOf(view: ViewReader, order: string): Promise<readonly StoredPledge[]> {
  const prefix = pledgeKey(order, "");
  const out: StoredPledge[] = [];
  for (const row of await view.list(prefix)) {
    const v = row.value;
    if (!isObject(v)) continue;
    if (typeof v.member !== "string" || typeof v.minor !== "number") continue;
    if (typeof v.event !== "string" || typeof v.claimedAt !== "number") continue;
    out.push({
      order,
      member: v.member as StoredPledge["member"],
      minor: v.minor,
      event: v.event,
      claimedAt: v.claimedAt,
    });
  }
  return out;
}

/** The members with a share in the order who are still members and have not confirmed their collection, in key order. */
export async function missingCollectors(view: ViewReader, order: string): Promise<string[]> {
  const missing: string[] = [];
  for (const pledge of await pledgesOf(view, order)) {
    if ((await view.get(`members/${pledge.member}`)) === undefined) continue;
    if ((await view.get(collectedKey(order, pledge.member))) === undefined) {
      missing.push(pledge.member);
    }
  }
  return missing;
}

/**
 * Why an order cannot be closed yet, in the matrix's order, or undefined when it can. The sender's standing is judged by the
 * caller. Read from the view only.
 */
export async function closeBlocker(view: ViewReader, order: string): Promise<string | undefined> {
  if ((await view.get(closedKey(order))) !== undefined) return CLOSE_MESSAGES.already_closed;
  if ((await view.get(deliveredKey(order))) === undefined) return CLOSE_MESSAGES.not_delivered;
  const pledges = await pledgesOf(view, order);
  const holders: string[] = [];
  for (const pledge of pledges) {
    if ((await view.get(`members/${pledge.member}`)) !== undefined) holders.push(pledge.member);
  }
  if (holders.length === 0) return CLOSE_MESSAGES.nobody;
  const missing = await missingCollectors(view, order);
  if (missing.length > 0) return notCollectedMessage(missing.map(memberLabel));
  return undefined;
}

/** The split of a total over `count` members: floor(total / count) cents each, the first `total mod count` one cent more. */
export function sharesOfTotal(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalMinor / count);
  const extra = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** How one member's payment stands against their share. */
export type DifferenceKind = "even" | "credit" | "owing";

export interface Difference {
  readonly kind: DifferenceKind;
  /** The size of the difference in cents (0 when even). */
  readonly minor: number;
  readonly words: string;
}

/**
 * A member's difference, in words only (story 8.7, shortcut S-8.7-1). An overpayment is credit that stays in the pool; an
 * underpayment is still to pay. Nothing is paid back or moved, and the words never say it was.
 */
export function differenceOf(paidMinor: number, shareMinor: number): Difference {
  if (paidMinor === shareMinor) {
    return { kind: "even", minor: 0, words: "Paid in full. Nothing is left over." };
  }
  if (paidMinor > shareMinor) {
    const over = paidMinor - shareMinor;
    return {
      kind: "credit",
      minor: over,
      words: `${randText(BigInt(over))} credit, still in the pool. Nothing has been paid back.`,
    };
  }
  const short = shareMinor - paidMinor;
  return { kind: "owing", minor: short, words: `${randText(BigInt(short))} still to pay.` };
}

/** The closing figures for an order: each member's paid, share and difference, from the total and what each paid. */
export function closeFigures(totalMinor: number, paid: readonly number[]) {
  const shares = sharesOfTotal(totalMinor, paid.length);
  return paid.map((paidMinor, index) => {
    const shareMinor = shares[index] ?? 0;
    return { paidMinor, shareMinor, difference: differenceOf(paidMinor, shareMinor) };
  });
}

/** One line of the order's timeline: a plain sentence, with the time the record holds for it when it holds one. */
export interface TimelineLine {
  readonly sentence: string;
  /** Epoch milliseconds, as a member's phone claimed it. Absent when the record keeps no time for the step. */
  readonly at?: number;
}

export interface ClosingMember {
  readonly label: string;
  readonly you: boolean;
  readonly collected: boolean;
}

export interface ClosingSummary {
  readonly order: string;
  readonly closed: boolean;
  readonly delivered: boolean;
  /** The sentence the close would be refused with right now, or undefined when it can be closed. */
  readonly blocker?: string;
  readonly closedLine?: TimelineLine;
  /** The group's figures, in words: the order's cost and the pool. */
  readonly group: readonly string[];
  /** The caller's own line, in full. Other members' amounts are never shown. */
  readonly you?: {
    readonly paidText: string;
    readonly shareText: string;
    readonly difference: Difference;
  };
  /** Every member with a share: whether they have collected. */
  readonly members: readonly ClosingMember[];
  readonly timeline: readonly TimelineLine[];
  /** What is still open: unpaid, uncollected, and any "still to pay". A list in the view; no obligation is written. */
  readonly openItems: readonly string[];
  readonly notes: readonly string[];
}

/**
 * The closing summary of an order, read from the record and (when the Node could be reached) the pool view. It sums nothing:
 * the total is the recorded choice, and the caller's own paid amount and share are the Node's.
 */
export async function closingSummary(
  view: ViewReader,
  order: string,
  me: string,
  pool?: PoolView,
): Promise<ClosingSummary> {
  const stored = storedOrderOf(await view.get(orderKey(order)));
  const choice = await selectionOf(view, order);
  const delivered = await deliveredOf(view, order);
  const planned = await view.get(deliveryKey(order));
  const closedRow = await view.get(closedKey(order));
  const closed = closedRow !== undefined;
  const label = (did: string) => (did === me ? "You" : memberLabel(did));

  const pledges = [...(await pledgesOf(view, order))].sort(
    (a, b) => a.claimedAt - b.claimedAt || (a.member < b.member ? -1 : 1),
  );
  const members: ClosingMember[] = [];
  const collections: { who: string; at: number }[] = [];
  for (const pledge of pledges) {
    const row = await view.get(collectedKey(order, pledge.member));
    members.push({
      label: label(pledge.member),
      you: pledge.member === me,
      collected: row !== undefined,
    });
    const at = isObject(row) && typeof row.claimedAt === "number" ? row.claimedAt : undefined;
    if (at !== undefined) collections.push({ who: pledge.member, at });
  }
  collections.sort((a, b) => a.at - b.at || (a.who < b.who ? -1 : 1));

  const timeline: TimelineLine[] = [];
  if (stored !== undefined) {
    timeline.push({ sentence: `${label(stored.proposedBy)} proposed the order ${stored.name}.` });
    if (stored.status === "open") timeline.push({ sentence: "The treasurer approved the order." });
  }
  if (choice !== undefined) {
    timeline.push({
      sentence: `${label(choice.by)} chose ${choice.supplier}. The order costs ${randText(BigInt(choice.totalMinor))}.`,
    });
  }
  for (const pledge of pledges) {
    timeline.push({ sentence: `${label(pledge.member)} pledged a share.`, at: pledge.claimedAt });
  }
  if (isObject(planned) && typeof planned.driver === "string") {
    timeline.push({ sentence: `A delivery was planned with driver ${label(planned.driver)}.` });
  }
  if (delivered !== undefined) {
    timeline.push({
      sentence: `${label(delivered.driver)} confirmed the goods arrived.`,
      at: delivered.claimedAt,
    });
  }
  for (const done of collections) {
    timeline.push({ sentence: `${label(done.who)} collected their share.`, at: done.at });
  }
  let closedLine: TimelineLine | undefined;
  if (isObject(closedRow) && typeof closedRow.by === "string") {
    closedLine = {
      sentence: `${label(closedRow.by)} closed the order.`,
      ...(typeof closedRow.claimedAt === "number" ? { at: closedRow.claimedAt } : {}),
    };
    timeline.push(closedLine);
  }

  const group: string[] = [];
  const notes: string[] = [];
  const openItems: string[] = [];
  for (const member of members) {
    if (!member.collected) openItems.push(`${member.label} has not collected yet.`);
  }
  if (choice !== undefined) group.push(`The order costs ${randText(BigInt(choice.totalMinor))}.`);
  let you: ClosingSummary["you"];
  if (pool === undefined) {
    notes.push("Payment figures show once the Node can be reached.");
  } else {
    group.push(pool.total.text);
    const notPaid = pool.members.filter((m) => m.status.kind !== "paid").length;
    if (notPaid > 0) {
      openItems.push(
        notPaid === 1
          ? "1 member has not paid their share in full yet."
          : `${notPaid} members have not paid their share in full yet.`,
      );
    }
    if (choice !== undefined) {
      const left = BigInt(pool.total.minor) - BigInt(choice.totalMinor);
      if (left > 0n) {
        group.push(
          `${randText(left)} more is in the pool than the order cost. It stays in the pool as credit for the members. Nothing has been paid back.`,
        );
      }
    }
    if (pool.you.share !== null) {
      const difference = differenceOf(Number(pool.you.minor), Number(pool.you.share));
      you = {
        paidText: pool.you.text.replace(/^You have paid/, "You paid") + ".",
        shareText: `${pool.you.shareText ?? ""}.`,
        difference,
      };
      if (difference.kind === "owing") {
        openItems.push(`You still need to pay ${randText(BigInt(difference.minor))}.`);
      }
    }
  }

  const blocker = closed ? CLOSE_MESSAGES.already_closed : await closeBlocker(view, order);
  return {
    order,
    closed,
    delivered: delivered !== undefined,
    ...(blocker === undefined ? {} : { blocker }),
    ...(closedLine === undefined ? {} : { closedLine }),
    group,
    ...(you === undefined ? {} : { you }),
    members,
    timeline,
    openItems,
    notes,
  };
}
