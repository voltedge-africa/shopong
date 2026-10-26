// The periodic reconciliation (story 4.5): compares three readings of every simulated payment request the Node knows,
// the provider (the simulated Stitch), the books (the ledger) and the shared record, and lists each difference in plain
// words for the treasurer's "Needs checking" list. SIMULATED: every item says so.
//
// It writes nothing except the list itself (`payment-checking.json`). A difference is never repaired here: the books
// and the record stay as they are until a person decides (AGENTS rule 5 is kept by the ids, which are never reused).
// It runs once when the Node starts and then every 15 minutes. A run that fails is logged and the last list is kept.
//
// Known limit (shortcut S-4.5-6): every pending request is polled on each run; the 30-minute age rule is not applied,
// because the provider's request view carries no creation time.

import type { SimulatedStitch } from "@shopong/adapter-stitch-sim";
import { eventIdOf, webCryptoSha512 } from "@shopong/events";
import type { Did, Ledger } from "@shopong/ports";
import { LEDGER_POSTED, memberIdOf } from "./pool-read.ts";
import {
  PAYMENT_COMPLETED,
  PAYMENT_FAILED,
  PLEDGE_CREATED,
  paymentEventOf,
  randText,
  type CheckItem,
  type CheckingStore,
  type ConfirmationHub,
} from "./payment-confirmation.ts";

export const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const SIM = "(simulated)";

export interface ReconcilerDeps {
  readonly simulated: SimulatedStitch;
  readonly ledger: Ledger;
  readonly hub: ConfirmationHub;
  readonly masterKey: Uint8Array;
  readonly nodeIdentity: Did;
  readonly store: CheckingStore;
  readonly now: () => number;
  readonly log: (message: string, fields: Record<string, unknown>) => void;
}

interface RecordIndex {
  /** Pledge event id to the community it belongs to and the member who made it. */
  readonly pledges: Map<string, { communityKey: string; memberDid: Did }>;
  /** External reference to the payment events the record holds for it. */
  readonly outcomes: Map<string, { completed: boolean; failed: boolean }>;
  /** Event ids of the completions the Node mirrored into the books (`ledger.posted` keys). */
  readonly mirrored: Set<string>;
}

/** The record's side, read from every held community's journal. */
async function indexRecord(hub: ConfirmationHub, nodeIdentity: Did): Promise<RecordIndex> {
  const pledges = new Map<string, { communityKey: string; memberDid: Did }>();
  const outcomes = new Map<string, { completed: boolean; failed: boolean }>();
  const mirrored = new Set<string>();
  for (const communityKey of hub.heldCommunities()) {
    const creator = hub.creatorOf(communityKey);
    for (const entry of await hub.journalOf(communityKey)) {
      const { event } = entry;
      const payload = event.payload as Record<string, unknown>;
      if (event.type === PLEDGE_CREATED) {
        if (!pledges.has(entry.id))
          pledges.set(entry.id, { communityKey, memberDid: event.actor as Did });
      } else if (event.type === PAYMENT_COMPLETED || event.type === PAYMENT_FAILED) {
        // Written by the creator's replica, as the Node's own event (a phone's copy would not count).
        if (entry.writer !== creator || event.actor !== creator) continue;
        if (payload.by !== nodeIdentity || typeof payload.externalReference !== "string") continue;
        const seen = outcomes.get(payload.externalReference) ?? { completed: false, failed: false };
        if (event.type === PAYMENT_COMPLETED) seen.completed = true;
        else seen.failed = true;
        outcomes.set(payload.externalReference, seen);
      } else if (event.type === LEDGER_POSTED) {
        if (entry.writer !== creator || event.actor !== creator) continue;
        if (payload.by !== nodeIdentity || typeof payload.key !== "string") continue;
        mirrored.add(payload.key);
      }
    }
  }
  return { pledges, outcomes, mirrored };
}

/**
 * Lists every difference between the provider, the books and the record, for each simulated request. Read-only except
 * for the provider's own expiry, which its reads apply. Returns the list in the order it was found.
 */
export async function reconcile(deps: ReconcilerDeps): Promise<CheckItem[]> {
  const record = await indexRecord(deps.hub, deps.nodeIdentity);
  const items: CheckItem[] = [];

  for (const request of deps.simulated.payIn.requests()) {
    const reference = request.externalReference;
    const amount = randText(request.amount.minor);
    const pledge = record.pledges.get(reference);
    const seen = record.outcomes.get(reference) ?? { completed: false, failed: false };

    // What the books say about a completion of this payment, once the pledge is known.
    let booked = false;
    let bookedId: string | undefined;
    if (pledge !== undefined) {
      const creator = deps.hub.creatorOf(pledge.communityKey);
      if (creator !== undefined) {
        const event = paymentEventOf({
          type: PAYMENT_COMPLETED,
          communityKey: pledge.communityKey,
          creator,
          nodeIdentity: deps.nodeIdentity,
          externalReference: reference,
          memberId: memberIdOf(deps.masterKey, pledge.communityKey, pledge.memberDid),
          amountMinor: request.amount.minor,
          currency: request.amount.currency,
        });
        bookedId = await eventIdOf(event, webCryptoSha512);
        booked = (await deps.ledger.findByIdempotencyKey(bookedId)) !== undefined;
      }
    }

    if (request.status === "completed") {
      if (pledge === undefined) {
        items.push({
          kind: "paid_no_pledge",
          text: `The simulated bank shows a ${amount} payment as paid, but no pledge in this Node's communities matches it. Nothing has changed. Ask the admin to check ${SIM}.`,
        });
        continue;
      }
      const community = { communityKey: pledge.communityKey };
      if (!booked) {
        items.push({
          kind: "bank_paid_not_in_books",
          ...community,
          text: `The simulated bank shows a ${amount} payment as paid, but the pool books do not have it. Nothing has changed. Ask the admin to check ${SIM}.`,
        });
      } else if (bookedId !== undefined && !record.mirrored.has(bookedId)) {
        items.push({
          kind: "books_not_in_record",
          ...community,
          text: `The pool books have a ${amount} payment from a simulated bank payment that the shared record does not show. Nothing has changed. Ask the admin to check ${SIM}.`,
        });
      }
      if (!seen.completed) {
        items.push({
          kind: "bank_paid_not_in_record",
          ...community,
          text: `The simulated bank shows a ${amount} payment as paid, but the shared record does not show it as paid. Nothing has changed. Ask the admin to check ${SIM}.`,
        });
      }
      continue;
    }

    if (booked) {
      items.push({
        kind: "books_not_paid_at_bank",
        communityKey: pledge!.communityKey,
        text: `The pool books have a ${amount} payment that the simulated bank does not show as paid. Nothing has changed. Ask the admin to check ${SIM}.`,
      });
    }
    if (seen.completed) {
      items.push({
        kind: "record_paid_not_at_bank",
        ...(pledge === undefined ? {} : { communityKey: pledge.communityKey }),
        text: `The shared record shows a ${amount} payment as paid, but the simulated bank does not. Nothing has changed. Ask the admin to check ${SIM}.`,
      });
    }
    if (request.status === "failed" && pledge !== undefined && !seen.failed) {
      items.push({
        kind: "bank_failed_not_in_record",
        communityKey: pledge.communityKey,
        text: `The simulated bank shows a ${amount} payment as failed, but the shared record does not show it. Nothing has changed. Ask the admin to check ${SIM}.`,
      });
    }
  }
  return items;
}

export interface RunningChecking {
  /** Runs the reconciliation now, stores its list and returns it. Two calls at once share one run. */
  runNow(): Promise<CheckItem[]>;
  /** The most recent run, started at Node start. Resolves to its list, or rejects if it failed. */
  readonly lastRun: Promise<CheckItem[]>;
  close(): void;
}

/**
 * Starts the reconciler: one run now, then one every 15 minutes. A failed run is logged, and the last stored list stays.
 */
export function startChecking(
  deps: ReconcilerDeps,
  intervalMs = CHECK_INTERVAL_MS,
): RunningChecking {
  let inFlight: Promise<CheckItem[]> | undefined;
  const runNow = (): Promise<CheckItem[]> => {
    if (inFlight !== undefined) return inFlight;
    inFlight = (async () => {
      const items = await reconcile(deps);
      deps.store.replaceChecking(deps.now(), items);
      deps.log("payment check finished (simulated)", { simulated: true, items: items.length });
      return items;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  const guarded = (): Promise<CheckItem[]> =>
    runNow().catch((error: unknown) => {
      deps.log("payment check failed (simulated): the last list is kept", {
        simulated: true,
        name: (error as Error).name,
      });
      throw error;
    });
  const lastRun = guarded();
  lastRun.catch(() => undefined);
  const timer = setInterval(() => {
    guarded().catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return {
    runNow: guarded,
    lastRun,
    close: () => clearInterval(timer),
  };
}
