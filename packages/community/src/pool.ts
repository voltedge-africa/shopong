// The pool view (story 4.6): what the pool holds, what each member has paid, and where each stands, judged from
// two readings the OCN Node makes: the books (the ledger's balances) and the record (the mirrored postings, see
// `apps/node` ledger-mirror). This module does the arithmetic and says it in plain words. It does no I/O, and it
// never reads the wall clock.
//
// Amounts are exact integer cents (bigint in, decimal strings out, so nothing past 2^53 is lost). A member sees their
// own amount and every member's status. Another member's amount never leaves this module: it appears only as a
// status, or as a flag with no figures in it.
//
// Target and shares. The target is the total the record says the pool needs (`quote.selected`, read by the Node). It
// is split equally over the admitted members, in member-id order: each gets floor(target / n) cents, and the first
// `target mod n` members get one more cent.

import type { CurrencyCode } from "@shopong/ports";
import { SUPPLIER_PAID_NOTE, supplierPaidText, type PaidPayout } from "./payout.js";

export const POOL_STATUS_LABELS = {
  paid: "Paid",
  part_paid: "Part paid",
  waiting: "Waiting",
  no_target: "No target yet",
  not_member: "Not a member of this pool",
} as const;

export type PoolStatusKind = keyof typeof POOL_STATUS_LABELS;

export interface PoolStatus {
  readonly kind: PoolStatusKind;
  readonly label: string;
}

/** One reading of the money: the pool, and each member's liability (credit balance) by opaque member id. */
export interface PoolReading {
  readonly pool: bigint;
  readonly members: ReadonlyMap<string, bigint>;
}

export interface PoolInputs {
  readonly currency: CurrencyCode;
  /** The ledger's balances. Balances come only from the Ledger port (read by the Node). */
  readonly books: PoolReading;
  /** The mirrored postings in the record, summed the same way. */
  readonly record: PoolReading;
  /** Opaque ids of the admitted members. */
  readonly memberIds: readonly string[];
  /** The caller's opaque member id. */
  readonly you: string;
  /** The target in cents from the record, or undefined when the record has none. */
  readonly target: bigint | undefined;
  /** The payments the record shows as paid to a supplier (story 8.5), in the record's order. */
  readonly paid?: readonly PaidPayout[];
}

export type PoolFlagKind =
  | "mismatch"
  | "unmatched_member"
  | "unmatched_record_member"
  | "member_mismatch";

export interface PoolFlag {
  readonly kind: PoolFlagKind;
  readonly text: string;
}

export interface PoolView {
  readonly currency: CurrencyCode;
  /** The pool as the books hold it. Shown even when the record differs. */
  readonly total: { readonly minor: string; readonly text: string };
  readonly target: { readonly minor: string; readonly text: string } | null;
  /**
   * The funding bar for the open order (story 8.4): the whole percent of the target that is in, capped at 100, and the
   * sentence beside it. Null when there is no target, or a target of nothing, so there is no bar to draw.
   */
  readonly funding: { readonly percent: number; readonly text: string } | null;
  /**
   * The supplier payment the record shows as made (story 8.5), the same for every member: who was paid, how much, and that
   * it is simulated. Null until the record shows one.
   */
  readonly supplierPaid: {
    readonly supplier: string;
    readonly order: string;
    readonly amount: { readonly minor: string; readonly text: string };
    readonly text: string;
    readonly note: string;
  } | null;
  readonly you: {
    readonly minor: string;
    readonly text: string;
    /** The caller's share in cents, or null when there is no target. */
    readonly share: string | null;
    readonly shareText: string | null;
    readonly status: PoolStatus;
  };
  /** Every admitted member in id order: whether it is the caller, and their status. No amounts, no ids. */
  readonly members: readonly { readonly you: boolean; readonly status: PoolStatus }[];
  readonly flags: readonly PoolFlag[];
}

/** Rand and cents, exact: `R500.00`, `R0.50`, `-R1.50`. */
export function randText(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const rands = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${sign}R${rands.toString()}.${cents}`;
}

function status(kind: PoolStatusKind): PoolStatus {
  return { kind, label: POOL_STATUS_LABELS[kind] };
}

/** The share of each admitted member, in id order: floor(target / n), with the first `target mod n` members one cent more. */
function sharesOf(target: bigint, memberIds: readonly string[]): Map<string, bigint> {
  const shares = new Map<string, bigint>();
  const n = BigInt(memberIds.length);
  if (n === 0n) return shares;
  const base = target / n;
  const extra = target % n;
  memberIds.forEach((id, index) => {
    shares.set(id, base + (BigInt(index) < extra ? 1n : 0n));
  });
  return shares;
}

/** The bar's figure: the whole percent of the target in the books, rounded down and kept between 0 and 100. */
function fundingOf(pool: bigint, target: bigint | undefined): PoolView["funding"] {
  if (target === undefined || target <= 0n) return null;
  const raw = (pool * 100n) / target;
  const percent = raw < 0n ? 0 : raw > 100n ? 100 : Number(raw);
  return { percent, text: `${randText(pool)} of ${randText(target)} is in.` };
}

export function poolView(input: PoolInputs): PoolView {
  const ids = [...new Set(input.memberIds)].sort();
  const shares = input.target === undefined ? undefined : sharesOf(input.target, ids);
  const flags: PoolFlag[] = [];

  if (input.books.pool !== input.record.pool) {
    const books = input.books.pool;
    const record = input.record.pool;
    const difference = books > record ? books - record : record - books;
    flags.push({
      kind: "mismatch",
      text: `The books show ${randText(books)} but the shared record shows ${randText(record)}. The difference is ${randText(difference)}.`,
    });
  }

  const known = new Set(ids);
  if ([...input.books.members.keys()].some((id) => !known.has(id))) {
    flags.push({
      kind: "unmatched_member",
      text: "A member account has no matching member in the record.",
    });
  }

  // A record amount for an id the books do not hold, or an id that is not admitted, is a difference too (never hidden).
  const booked = new Set(input.books.members.keys());
  const recorded = [...input.record.members.keys()];
  if (recorded.some((id) => !known.has(id))) {
    flags.push({
      kind: "unmatched_record_member",
      text: "A member amount in the shared record has no matching member in the community.",
    });
  }
  if (recorded.some((id) => !booked.has(id))) {
    flags.push({
      kind: "unmatched_record_member",
      text: "A member amount in the shared record has no matching member account in the books.",
    });
  }

  let otherMismatch = false;
  for (const id of ids) {
    const books = input.books.members.get(id) ?? 0n;
    const record = input.record.members.get(id) ?? 0n;
    if (books === record) continue;
    if (id === input.you) {
      flags.push({
        kind: "member_mismatch",
        text: `Your amounts do not match. The books show ${randText(books)} and the shared record shows ${randText(record)}.`,
      });
    } else {
      otherMismatch = true;
    }
  }
  if (otherMismatch) {
    // Another member's figures never reach the caller: this flag says only that there is a difference.
    flags.push({
      kind: "member_mismatch",
      text: "The amounts for another member do not match between the books and the record.",
    });
  }

  const statusOf = (id: string): PoolStatus => {
    // An id off the member list is never Paid, whatever the books say (triage 7).
    if (!known.has(id)) return status("not_member");
    if (shares === undefined) return status("no_target");
    const paid = input.books.members.get(id) ?? 0n;
    const share = shares.get(id) ?? 0n;
    if (paid >= share) return status("paid");
    if (paid > 0n) return status("part_paid");
    return status("waiting");
  };

  const paid = input.paid?.[0];
  const yourPaid = input.books.members.get(input.you) ?? 0n;
  const yourShare = known.has(input.you) ? shares?.get(input.you) : undefined;

  return {
    currency: input.currency,
    total: {
      minor: input.books.pool.toString(),
      text: `The pool holds ${randText(input.books.pool)}.`,
    },
    target:
      input.target === undefined
        ? null
        : {
            minor: input.target.toString(),
            text: `The target is ${randText(input.target)}.`,
          },
    // Once the supplier is paid the pool is spent on purpose: a bar that fell back to empty would read as a loss.
    funding: paid === undefined ? fundingOf(input.books.pool, input.target) : null,
    supplierPaid:
      paid === undefined
        ? null
        : {
            supplier: paid.supplier,
            order: paid.order,
            amount: { minor: String(paid.amountMinor), text: randText(BigInt(paid.amountMinor)) },
            text: supplierPaidText(paid),
            note: SUPPLIER_PAID_NOTE,
          },
    you: {
      minor: yourPaid.toString(),
      text: `You have paid ${randText(yourPaid)}`,
      share: yourShare === undefined ? null : yourShare.toString(),
      shareText: yourShare === undefined ? null : `Your share is ${randText(yourShare)}`,
      status: statusOf(input.you),
    },
    members: ids.map((id) => ({ you: id === input.you, status: statusOf(id) })),
    flags,
  };
}
