// The Node's reading of a community's pool (story 4.6). Two readings, one view:
//
//   the books    the ledger's balances: the pool bank, and each member's liability (`Ledger.balance`, and the
//                member accounts listed by `Ledger.trialBalance`). Only the Node reads the ledger.
//   the record   the money postings the Node mirrored into the record (`ledger.posted`, written by `ledger-mirror.ts`,
//                counted only when `by` names the Node's own identity; phones cannot send that type, see the events
//                route), summed the same way.
//
// The target is the record's latest `quote.selected` written by a treasurer (the creator, or a co-treasurer whose
// role stands at log time), with `totalMinor` a safe, non-negative whole number of cents. `apply` does not check that
// type yet, so the treasurer test is what keeps a member from setting the target (see shortcut S-4.6-4).
//
// Member ids in the books are opaque: HMAC-SHA512 of the member's DID under the Node's master key, so the ledger holds
// no DID and no phone or ID number (AGENTS.md rule 6).

import { createHmac } from "node:crypto";
import { POOL_BANK } from "@shopong/ledger-sqlite";
import {
  isTreasurer,
  logTimeOf,
  poolView,
  type PoolReading,
  type PoolView,
} from "@shopong/community";
import type { EventEnvelope } from "@shopong/events";
import type { CapabilityAuth, CurrencyCode, Did, Ledger, ViewReader } from "@shopong/ports";
import type { JournalEntry } from "@shopong/record-autobase";

/** The record type that mirrors a ledger posting. */
export const LEDGER_POSTED = "ledger.posted";
/** The record type that carries the target. */
export const TARGET_TYPE = "quote.selected";

/** A member's liability account in the books: `liabilities:member/<opaque id>`. */
export const MEMBER_ACCOUNT_PREFIX = "liabilities:member/";
/** How a member's liability is written in the record: the type, with the id in the line's own `member` field. */
export const MEMBER_LIABILITY = "liabilities:member";

/** The part of the replica hub the pool read uses. `ReplicaHub` implements it. */
export interface PoolHub {
  registrationOf(communityKey: string): { spaceKey: string; creator: Did } | undefined;
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
  membersOf(communityKey: string): readonly Did[];
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
  journalOf(communityKey: string): Promise<readonly JournalEntry<EventEnvelope>[]>;
}

/** The opaque member id used in the books: 128 lowercase hex, keyed by the Node's master key. */
export function memberIdOf(masterKey: Uint8Array, did: Did): string {
  return createHmac("sha512", masterKey).update(`ocn/pool/member/v1\n${did}`, "utf8").digest("hex");
}

interface MirroredLine {
  readonly account: string;
  readonly member?: string;
  readonly direction: "debit" | "credit";
  readonly currency: string;
  readonly minor: number;
}

function isMirroredLine(value: unknown): value is MirroredLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.account === "string" &&
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
  nodeIdentity: Did,
  currency: CurrencyCode,
): PoolReading {
  let pool = 0n;
  const members = new Map<string, bigint>();
  for (const entry of journal) {
    if (entry.event.type !== LEDGER_POSTED) continue;
    if ((entry.event.payload as { by?: unknown }).by !== nodeIdentity) continue;
    const lines = (entry.event.payload as { entries?: unknown }).entries;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (!isMirroredLine(line) || line.currency !== currency) continue;
      const amount = BigInt(line.minor);
      const signed = line.direction === "debit" ? amount : -amount;
      if (line.account === POOL_BANK) pool += signed;
      else if (line.account === MEMBER_LIABILITY && line.member !== undefined) {
        // A liability grows with credits: the sign is the opposite of the pool's.
        members.set(line.member, (members.get(line.member) ?? 0n) - signed);
      }
    }
  }
  return { pool, members };
}

/** The target from the record: the latest `quote.selected` by a treasurer, judged at log time. */
async function targetOf(
  journal: readonly JournalEntry<EventEnvelope>[],
  view: ViewReader | undefined,
  standing: { auth: CapabilityAuth; creator: Did; spaceKey: string },
): Promise<bigint | undefined> {
  if (view === undefined) return undefined;
  const at = (await logTimeOf(view)) ?? 0;
  let target: bigint | undefined;
  for (const entry of journal) {
    if (entry.event.type !== TARGET_TYPE) continue;
    if (!(await isTreasurer(standing, view, entry.event.actor, at))) continue;
    const total = (entry.event.payload as { totalMinor?: unknown }).totalMinor;
    if (typeof total === "number" && Number.isSafeInteger(total) && total >= 0) {
      target = BigInt(total);
    }
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
  const { ledger, hub, communityKey, currency } = request;
  const registration = hub.registrationOf(communityKey);
  if (registration === undefined) throw new Error("community is not held");

  const journal = await hub.journalOf(communityKey);
  const view = await hub.indexedView(communityKey);
  const target = await targetOf(journal, view, {
    auth: request.auth,
    creator: registration.creator,
    spaceKey: communityKey,
  });
  const record = recordReading(journal, request.nodeIdentity, currency);

  const bookPool = (await ledger.balance(POOL_BANK, currency)).balance.minor;
  const accounts = (await ledger.trialBalance()).lines
    .filter((line) => line.currency === currency && line.account.startsWith(MEMBER_ACCOUNT_PREFIX))
    .map((line) => line.account);
  const books = new Map<string, bigint>();
  for (const account of new Set(accounts)) {
    const balance = (await ledger.balance(account, currency)).balance.minor;
    books.set(account.slice(MEMBER_ACCOUNT_PREFIX.length), BigInt(balance));
  }

  const memberIds = hub.membersOf(communityKey).map((did) => memberIdOf(request.masterKey, did));
  return poolView({
    currency,
    books: { pool: BigInt(bookPool), members: books },
    record,
    memberIds,
    you: memberIdOf(request.masterKey, request.caller),
    target,
  });
}
