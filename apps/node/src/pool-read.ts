// The Node's reading of a community's pool (story 4.6). Two readings, one view:
//
//   the books    the ledger's balances for this community's own accounts (`poolAccountOf`, and each member's liability
//                from `memberLiabilityOf`), read with `Ledger.balance` and listed by `Ledger.trialBalance`. Only the Node
//                reads the ledger. No account of another community is read or counted.
//   the record   the money postings the Node mirrored into this community's record (`ledger.posted`, written by
//                `ledger-mirror.ts`), summed the same way.
//
// The target is the supplier's total for the open order, as the record holds the latest accepted `quote.selected` for it
// (story 8.3). `apply` checks the choice against the order and its quote, and recomputes the total from them, so the
// target is the ranked total for the order's wanted items. A choice is read only while its treasurer (the creator, or a
// co-treasurer) still stands at log time, and only if that person has not been removed.
//
// Member ids in the books are opaque and scoped to the community: HMAC-SHA512 of the community key and the member's DID
// under the Node's master key, so the ledger holds no DID and no phone or ID number (AGENTS.md rule 6).

import { createHmac } from "node:crypto";
import {
  FEES_BASE,
  MEMBER_BASE,
  POOL_BASE,
  poolAccountOf,
  splitAccount,
} from "@shopong/ledger-sqlite";
import {
  isTreasurer,
  logTimeOf,
  ordersOf,
  poolView,
  selectionOf,
  type PoolReading,
  type PoolView,
} from "@shopong/community";
import type { EventEnvelope } from "@shopong/events";
import type { CapabilityAuth, CurrencyCode, Did, Ledger, ViewReader } from "@shopong/ports";
import type { JournalEntry } from "@shopong/record-autobase";

/** The record type that mirrors a ledger posting. */
export const LEDGER_POSTED = "ledger.posted";
/** How long to wait before re-reading a books-and-record difference (story 4.6 fix). */
export const RECHECK_MS = 200;
/** How a member's liability is written in the record: the chart base, with the id in the line's own `member` field. */
export const MEMBER_LIABILITY = MEMBER_BASE;

/** The part of the replica hub the pool read uses. `ReplicaHub` implements it. */
export interface PoolHub {
  registrationOf(communityKey: string): { spaceKey: string; creator: Did } | undefined;
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
  membersOf(communityKey: string): Promise<readonly Did[]>;
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
  journalOf(communityKey: string): Promise<readonly JournalEntry<EventEnvelope>[]>;
}

/** The opaque member id used in one community's books: 128 lowercase hex (story 4.6 fix, scoped per community). */
export function memberIdOf(masterKey: Uint8Array, communityKey: string, did: Did): string {
  return createHmac("sha512", masterKey)
    .update(`ocn/pool/member/v1\n${communityKey}\n${did}`, "utf8")
    .digest("hex");
}

interface MirroredLine {
  readonly account: string;
  readonly member?: string;
  readonly direction: "debit" | "credit";
  readonly currency: string;
  readonly minor: number;
}

const BASES: ReadonlySet<string> = new Set([
  POOL_BASE,
  FEES_BASE,
  "liabilities:supplier/payable",
  MEMBER_BASE,
]);

function isMirroredLine(value: unknown): value is MirroredLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.account === "string" &&
    BASES.has(line.account) &&
    (line.account !== MEMBER_LIABILITY || /^[0-9a-f]{32,}$/u.test(String(line.member))) &&
    (line.direction === "debit" || line.direction === "credit") &&
    typeof line.currency === "string" &&
    typeof line.minor === "number" &&
    Number.isSafeInteger(line.minor) &&
    line.minor > 0
  );
}

/** The record's side of the money: the pool and each member's liability, summed over the mirrored postings. */
function recordReading(
  journal: readonly JournalEntry<EventEnvelope>[],
  creator: Did,
  nodeIdentity: Did,
  currency: CurrencyCode,
): PoolReading {
  let pool = 0n;
  const members = new Map<string, bigint>();
  for (const entry of journal) {
    if (entry.event.type !== LEDGER_POSTED) continue;
    // Counted only when the creator's writer appended it AND the Node's identity is named (story 4.6 fix, triage 4).
    if (entry.writer !== creator || entry.event.actor !== creator) continue;
    if ((entry.event.payload as { by?: unknown }).by !== nodeIdentity) continue;
    const lines = (entry.event.payload as { entries?: unknown }).entries;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (!isMirroredLine(line) || line.currency !== currency) continue;
      const amount = BigInt(line.minor);
      const signed = line.direction === "debit" ? amount : -amount;
      if (line.account === POOL_BASE) pool += signed;
      else if (line.account === MEMBER_LIABILITY && line.member !== undefined) {
        // A liability grows with credits: the sign is the opposite of the pool's.
        members.set(line.member, (members.get(line.member) ?? 0n) - signed);
      }
    }
  }
  return { pool, members };
}

/**
 * The target from the record: the latest accepted choice for each open order (story 8.3). Only one order is open at a time
 * (S-8.2-2), so this is one choice. The choice is judged at the head's log time (shortcut S-4.6-13): its treasurer must
 * still stand as the creator or a co-treasurer, and must not have been removed (story 4.6 fix, triage 3).
 */
async function targetOf(
  view: ViewReader | undefined,
  standing: { auth: CapabilityAuth; creator: Did; spaceKey: string },
): Promise<bigint | undefined> {
  if (view === undefined) return undefined;
  const at = (await logTimeOf(view)) ?? 0;
  let target: bigint | undefined;
  for (const order of await ordersOf(view)) {
    if (order.status !== "open") continue;
    const choice = await selectionOf(view, order.name);
    if (choice === undefined) continue;
    if ((await view.get(`removed/${choice.by}`)) !== undefined) continue;
    if (!(await isTreasurer(standing, view, choice.by, at))) continue;
    target = BigInt(choice.totalMinor);
  }
  return target;
}

export interface PoolReadRequest {
  readonly ledger: Ledger;
  readonly hub: PoolHub;
  readonly communityKey: string;
  readonly caller: Did;
  readonly auth: CapabilityAuth;
  readonly masterKey: Uint8Array;
  readonly nodeIdentity: Did;
  readonly currency: CurrencyCode;
}

/**
 * Reads the books and the record for a community and returns the plain view. Throws when the ledger cannot be read,
 * so the route can say so and show no figures.
 */
export async function readPool(request: PoolReadRequest): Promise<PoolView> {
  const first = await readOnce(request);
  if (!differs(first)) return poolView(first);
  // The books and the record disagree. A mirror may be a moment behind the books (the event is written after the posting),
  // so read once more after a short wait before flagging anything (story 4.6 fix, triage 5). One re-read, not a loop.
  await new Promise((resolve) => setTimeout(resolve, RECHECK_MS));
  return poolView(await readOnce(request));
}

/** Whether the books and the record differ for the pool or for any member (the only case that is re-read). */
function differs(input: { books: PoolReading; record: PoolReading }): boolean {
  if (input.books.pool !== input.record.pool) return true;
  const ids = new Set([...input.books.members.keys(), ...input.record.members.keys()]);
  return [...ids].some(
    (id) => (input.books.members.get(id) ?? 0n) !== (input.record.members.get(id) ?? 0n),
  );
}

/** The inputs of one read of the books and the record. */
async function readOnce(request: PoolReadRequest): Promise<Parameters<typeof poolView>[0]> {
  const { ledger, hub, communityKey, currency } = request;
  const registration = hub.registrationOf(communityKey);
  if (registration === undefined) throw new Error("community is not held");

  const journal = await hub.journalOf(communityKey);
  const view = await hub.indexedView(communityKey);
  const target = await targetOf(view, {
    auth: request.auth,
    creator: registration.creator,
    spaceKey: communityKey,
  });
  const record = recordReading(journal, registration.creator, request.nodeIdentity, currency);

  const bookPool = (await ledger.balance(poolAccountOf(communityKey), currency)).balance.minor;
  const books = new Map<string, bigint>();
  const accounts = new Set(
    (await ledger.trialBalance()).lines
      .filter((line) => line.currency === currency)
      .filter((line) => splitAccount(communityKey, line.account)?.base === MEMBER_BASE)
      .map((line) => line.account),
  );
  for (const account of accounts) {
    const balance = (await ledger.balance(account, currency)).balance.minor;
    books.set(splitAccount(communityKey, account)!.memberId!, BigInt(balance));
  }

  const memberIds = (await hub.membersOf(communityKey)).map((did) =>
    memberIdOf(request.masterKey, communityKey, did),
  );
  return {
    currency,
    books: { pool: BigInt(bookPool), members: books },
    record,
    memberIds,
    you: memberIdOf(request.masterKey, communityKey, request.caller),
    target,
  };
}
