// Confirms a payment from a verified webhook (story 4.5). SIMULATED: the processor is the simulated Stitch (story 4.4),
// and every log line, flag and answer this module makes says so.
//
// The order for a completion is fixed: the books (`postAndMirror`, keyed by the confirmation's event id), then the
// record (`payment.completed`, the same event id, written by the creator's replica with the Node's identity in `by`),
// then the simulated provider's status and the 2xx answer. A crash after the books and before the record is repaired
// by the redelivery, which replays the books (`replayed: true`) and then writes the record. Nothing is acknowledged
// until both writes have returned.
//
// The event id is SHA-512 of the canonical `payment.completed` (or `payment.failed`) event built from the external
// reference, the amount, the currency and the status, plus the pledge's member id and the community. Its `claimedAt` is
// fixed at 0 and its nonce is the external reference, so the same payment always builds the same id (AGENTS rule 5).
//
// What is never done here: repairing a mismatch (the reconciler only lists it), posting for an unknown request, posting a
// completion that arrives after failure, expiry or cancellation (those are flagged), and posting on an amount mismatch.
// Flags live in `payment-checking.json` in the data folder, so the treasurer's list survives a restart.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { requestRef, type SimulatedStitch, type WebhookReading } from "@shopong/adapter-stitch-sim";
import {
  configureChart,
  configureMemberAccount,
  memberLiabilityOf,
  poolAccountOf,
} from "@shopong/ledger-sqlite";
import { createEvent, eventIdOf, webCryptoSha512, type EventEnvelope } from "@shopong/events";
import {
  money,
  type Did,
  type Ledger,
  type LedgerEntry,
  type PaymentStatus,
  type WebhookDelivery,
} from "@shopong/ports";
import { postAndMirror, type MirrorHub } from "./ledger-mirror.ts";
import type { DiscrepancyStore } from "./discrepancies.ts";
import { memberIdOf, type PoolHub } from "./pool-read.ts";

export const PAYMENT_COMPLETED = "payment.completed";
export const PAYMENT_FAILED = "payment.failed";
export const PLEDGE_CREATED = "pledge.created";
export const CHECKING_FILE = "payment-checking.json";
const CHECKING_FORMAT = "payment-checking/1";

/** The simulation's words, on every person-visible text this module writes. */
const SIM = "(simulated)";

/** What the treasurer is told, by kind. Each text is plain words and names the simulation. */
export type FlagKind =
  | "unknown_payment"
  | "amount_mismatch"
  | "late_completion"
  | "completed_after_ended"
  | "failed_after_completed"
  | "no_pledge";

export interface Flag {
  readonly kind: FlagKind;
  /** Dedupes a repeat delivery: the same kind and the same payment (or the same body, for an unknown request). */
  readonly key: string;
  /** The community the flag belongs to; absent when no pledge matches the payment. */
  readonly communityKey?: string;
  readonly text: string;
  readonly at: number;
}

/** A row of the reconciler's "Needs checking" list (see reconciler.ts). */
export interface CheckItem {
  readonly kind: string;
  readonly communityKey?: string;
  readonly text: string;
}

interface CheckingState {
  readonly format: typeof CHECKING_FORMAT;
  readonly flags: Flag[];
  readonly checkedAt?: number;
  readonly items: CheckItem[];
}

/** Rand amount in plain words, from whole cents (exact: no floating point). */
export function randText(minor: number): string {
  return `R${Math.floor(minor / 100).toString()}.${(minor % 100).toString().padStart(2, "0")}`;
}

function isFlag(value: unknown): value is Flag {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.kind === "string" &&
    typeof f.key === "string" &&
    typeof f.text === "string" &&
    typeof f.at === "number" &&
    (f.communityKey === undefined || typeof f.communityKey === "string")
  );
}

/**
 * The flags and the reconciler's last list, in one JSON file. Written with fsync and rename; a change that cannot be
 * written is rolled back and thrown, so nothing is acknowledged that was not stored.
 */
export class CheckingStore {
  readonly #file: string;
  #state: CheckingState;

  /**
   * Reads the file. A file that is not valid, or not in this format, is moved aside to `<file>.bad` and the list starts
   * empty: a corrupt list must not stop the Node (review item 7). The move is logged in plain words.
   */
  constructor(file: string, log?: (message: string) => void) {
    this.#file = file;
    this.#state = { format: CHECKING_FORMAT, flags: [], items: [] };
    if (!existsSync(file)) return;
    let loaded: CheckingState | undefined;
    try {
      const s = JSON.parse(readFileSync(file, "utf8")) as Partial<CheckingState> | null;
      const valid =
        typeof s === "object" &&
        s !== null &&
        s.format === CHECKING_FORMAT &&
        Array.isArray(s.flags) &&
        s.flags.every(isFlag) &&
        Array.isArray(s.items);
      if (valid) loaded = { ...(s as CheckingState) };
    } catch {
      loaded = undefined;
    }
    if (loaded !== undefined) {
      this.#state = loaded;
      return;
    }
    renameSync(file, `${file}.bad`);
    log?.(
      `payment-checking.json could not be read and was moved aside to payment-checking.json.bad; the Needs checking list starts empty (simulated)`,
    );
  }

  flags(): readonly Flag[] {
    return this.#state.flags;
  }

  checking(): { readonly checkedAt?: number; readonly items: readonly CheckItem[] } {
    return { checkedAt: this.#state.checkedAt, items: this.#state.items };
  }

  /** Adds a flag once per key. Returns false when the key was already flagged. */
  flag(flag: Flag): boolean {
    if (this.#state.flags.some((f) => f.kind === flag.kind && f.key === flag.key)) return false;
    this.#change({ ...this.#state, flags: [...this.#state.flags, flag] });
    return true;
  }

  /** Replaces the reconciler's list with the one just found. */
  replaceChecking(at: number, items: readonly CheckItem[]): void {
    this.#change({ ...this.#state, checkedAt: at, items: [...items] });
  }

  #change(next: CheckingState): void {
    const before = this.#state;
    this.#state = next;
    try {
      this.#persist();
    } catch (error) {
      this.#state = before;
      throw error;
    }
  }

  /** Writes the whole list: every byte is written (checked), the file is fsynced, renamed, and the folder is fsynced. */
  #persist(): void {
    const temp = `${this.#file}.tmp`;
    const bytes = Buffer.from(JSON.stringify(this.#state), "utf8");
    const fd = openSync(temp, "w", 0o600);
    try {
      let written = 0;
      while (written < bytes.length) {
        const n = writeSync(fd, bytes, written, bytes.length - written);
        if (n <= 0) throw new Error("payment checking file: a write wrote no bytes");
        written += n;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.#file);
    const dir = openSync(dirname(this.#file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}

export function openCheckingStore(dataDir: string, log?: (message: string) => void): CheckingStore {
  return new CheckingStore(join(dataDir, CHECKING_FILE), log);
}

/** The hub surface confirmation needs: the mirror, the pool reads, and the list of held communities. */
export interface ConfirmationHub extends MirrorHub, PoolHub {
  heldCommunities(): readonly string[];
}

export interface Pledge {
  readonly communityKey: string;
  /** The member who made the pledge (their DID; never sent to the books, only their opaque id). */
  readonly memberDid: Did;
}

export interface ConfirmationDeps {
  readonly simulated: SimulatedStitch;
  /** The books. Undefined when the ledger is off: a completion then is not acknowledged. */
  readonly ledger: Ledger | undefined;
  readonly hub: ConfirmationHub;
  readonly masterKey: Uint8Array;
  readonly nodeIdentity: Did;
  readonly store: CheckingStore;
  /** The discrepancy list (story 10.3). Undefined in tests that do not need it. */
  readonly discrepancies?: DiscrepancyStore;
  readonly now: () => number;
  /** Test seam: called after the books are written and before the record, to simulate a crash there. */
  readonly beforeRecord?: (eventType: string) => void;
  /** Test seam: true makes the record write for this event type fail (as if the record refused it). */
  readonly failRecordWrite?: (eventType: string) => boolean;
}

/** What a delivery came to. `not_pay_in` means the body is not a pay-in event, so the caller tries the pay-out side. */
export type Confirmation =
  | { readonly kind: "refused"; readonly problem: "invalid_signature" }
  | { readonly kind: "not_pay_in" }
  | {
      readonly kind: "answered";
      /** The payment's one-way reference for logs (`requestRef`), or a digest of an unknown request's body. */
      readonly ref: string;
      readonly applied: boolean;
      readonly status?: PaymentStatus;
      readonly lateCompletion: boolean;
      readonly flagged?: FlagKind;
    }
  | {
      readonly kind: "not_acknowledged";
      readonly problem: WriteProblem;
      readonly message: string;
    };

/** The pledge's event id is the payment's external reference (the port's rule). */
export async function findPledge(
  hub: ConfirmationHub,
  externalReference: string,
): Promise<Pledge | undefined> {
  for (const communityKey of hub.heldCommunities()) {
    for (const entry of await hub.journalOf(communityKey)) {
      if (entry.id === externalReference && entry.event.type === PLEDGE_CREATED) {
        return { communityKey, memberDid: entry.event.actor as Did };
      }
    }
  }
  return undefined;
}

/**
 * The payment event the Node writes for a completion or a failure. Deterministic: no clock, no randomness. Its nonce is
 * the external reference and its `claimedAt` is 0, so the event id depends on the payment's own facts only.
 */
export function paymentEventOf(input: {
  readonly type: typeof PAYMENT_COMPLETED | typeof PAYMENT_FAILED;
  readonly communityKey: string;
  readonly creator: Did;
  readonly nodeIdentity: Did;
  readonly externalReference: string;
  readonly memberId: string;
  readonly amountMinor: number;
  readonly currency: string;
}): EventEnvelope {
  const status = input.type === PAYMENT_COMPLETED ? "completed" : "failed";
  return createEvent({
    type: input.type,
    space: input.communityKey,
    actor: input.creator,
    proof: [],
    claimedAt: 0,
    nonce: input.externalReference,
    payload: {
      by: input.nodeIdentity,
      externalReference: input.externalReference,
      memberId: input.memberId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status,
    },
  } as never) as EventEnvelope;
}

interface Read {
  readonly externalReference: string;
  readonly paymentId: string;
  readonly outcome: "completed" | "failed" | "cancelled" | "expired";
  readonly status: PaymentStatus;
  readonly minor: number;
  readonly currency: string;
}

/** The true state of one delivery's writes, so a stopped delivery says what happened (review item 6). */
export interface WriteProgress {
  /** The books hold the posting (a ledger write that returned, including a mirror that failed after it). */
  books: boolean;
  /** The payment's own record event (`payment.completed` or `payment.failed`) was written. */
  record: boolean;
  /** The simulated provider's status was saved. */
  status: boolean;
}

export type WriteProblem =
  | "books_written"
  | "record_written"
  | "status_written"
  | "state_unwritten";

export function problemOf(progress: WriteProgress): WriteProblem {
  if (progress.record) return "record_written";
  if (progress.books) return "books_written";
  if (progress.status) return "status_written";
  return "state_unwritten";
}

/** What a person is told for each state. Every text names the simulation and says what to do. */
export function messageOf(problem: WriteProblem): string {
  switch (problem) {
    case "books_written":
      return `The payment is in the pool books (simulated) but not in the shared record, and the simulated bank has not marked it paid. Send the same webhook again to finish it, or ask the admin to check (simulated).`;
    case "record_written":
      return `The payment is in the pool books and the shared record (simulated), but the simulated bank's status could not be saved. Send the same webhook again to finish it (simulated).`;
    case "status_written":
      return `The simulated bank marked the payment as failed, but the failure could not be written to the shared record. Send the same webhook again to finish it (simulated).`;
    case "state_unwritten":
      return `The simulated state could not be written. Nothing was applied (simulated).`;
  }
}

/** Thrown when a write stopped a delivery. Carries the true state for the route's answer. */
export class WriteStopped extends Error {
  override name = "WriteStopped";
  readonly problem: WriteProblem;
  constructor(problem: WriteProblem) {
    super(messageOf(problem));
    this.problem = problem;
  }
}

/**
 * One async lock per key, in this process: every step for one payment (its status read, the books, the record and the
 * provider's status) runs in order, so two deliveries for one request cannot interleave (review items 2 to 4).
 */
export class KeyedLock {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

const LOCKS = new KeyedLock();

/** The ledger postings of a completion: the pool takes the money, the member's liability grows by the same amount. */
function completionEntries(
  communityKey: string,
  memberId: string,
  minor: number,
  currency: string,
): LedgerEntry[] {
  return [
    { account: poolAccountOf(communityKey), direction: "debit", amount: money(currency, minor) },
    {
      account: memberLiabilityOf(communityKey, memberId),
      direction: "credit",
      amount: money(currency, minor),
    },
  ];
}

/** The books' and the record's writes for a completion, in order. `false` when one did not happen. */
type CompletionWrite =
  | { readonly kind: "written" }
  | { readonly kind: "stopped" }
  | { readonly kind: "ended"; readonly status: PaymentStatus };

async function writeCompletion(
  deps: ConfirmationDeps,
  read: Read,
  pledge: Pledge,
  progress: WriteProgress,
): Promise<CompletionWrite> {
  const ledger = deps.ledger;
  const creator = deps.hub.creatorOf(pledge.communityKey);
  if (ledger === undefined || creator === undefined) return { kind: "stopped" };
  const memberId = memberIdOf(deps.masterKey, pledge.communityKey, pledge.memberDid);
  const event = paymentEventOf({
    type: PAYMENT_COMPLETED,
    communityKey: pledge.communityKey,
    creator,
    nodeIdentity: deps.nodeIdentity,
    externalReference: read.externalReference,
    memberId,
    amountMinor: read.minor,
    currency: read.currency,
  });
  const id = await eventIdOf(event, webCryptoSha512);

  const chart = await configureChart(ledger, pledge.communityKey);
  if (!chart.ok) return { kind: "stopped" };
  const member = await configureMemberAccount(ledger, pledge.communityKey, memberId);
  if (!member.ok) return { kind: "stopped" };

  // Read again immediately before the books: a cancel or an expiry that landed during the awaits above is caught here,
  // so nothing is posted for a request that has already ended (review item 2).
  const current = await deps.simulated.payIn.getRequest(read.paymentId);
  if (current !== undefined && current.status !== "pending" && current.status !== "completed") {
    return { kind: "ended", status: current.status };
  }

  const posted = await postAndMirror(
    { ledger, hub: deps.hub, nodeIdentity: deps.nodeIdentity },
    {
      communityKey: pledge.communityKey,
      idempotencyKey: id,
      description: "Pay-in confirmed (simulated Stitch)",
      entries: completionEntries(pledge.communityKey, memberId, read.minor, read.currency),
    },
  );
  // A mirror that failed after the ledger took the posting still leaves the posting in the books.
  if (posted.ok || posted.error.code === "mirror_failed") progress.books = true;
  if (!posted.ok) return { kind: "stopped" };

  deps.beforeRecord?.(PAYMENT_COMPLETED);
  const recorded = deps.failRecordWrite?.(PAYMENT_COMPLETED)
    ? undefined
    : await deps.hub.mirror(pledge.communityKey, event);
  if (recorded === undefined) return { kind: "stopped" };
  progress.record = true;
  return { kind: "written" };
}

/** Records a failure in the shared record, keyed like the completion. */
async function writeFailure(
  deps: ConfirmationDeps,
  read: Read,
  pledge: Pledge,
  progress: WriteProgress,
): Promise<boolean> {
  const creator = deps.hub.creatorOf(pledge.communityKey);
  if (creator === undefined) return false;
  const event = paymentEventOf({
    type: PAYMENT_FAILED,
    communityKey: pledge.communityKey,
    creator,
    nodeIdentity: deps.nodeIdentity,
    externalReference: read.externalReference,
    memberId: memberIdOf(deps.masterKey, pledge.communityKey, pledge.memberDid),
    amountMinor: read.minor,
    currency: read.currency,
  });
  const recorded = deps.failRecordWrite?.(PAYMENT_FAILED)
    ? undefined
    : await deps.hub.mirror(pledge.communityKey, event);
  if (recorded === undefined) return false;
  progress.record = true;
  return true;
}

function answer(
  ref: string,
  applied: boolean,
  extra: { status?: PaymentStatus; lateCompletion?: boolean; flagged?: FlagKind } = {},
): Confirmation {
  return {
    kind: "answered",
    ref,
    applied,
    lateCompletion: extra.lateCompletion ?? false,
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(extra.flagged === undefined ? {} : { flagged: extra.flagged }),
  };
}

function digestOf(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 24);
}

/**
 * Handles one delivery. The signature is checked before anything is read or written. Everything after that runs under
 * the payment's lock, with its status read again inside it. A stopped write throws `WriteStopped` with the true state.
 */
export async function confirmDelivery(
  deps: ConfirmationDeps,
  delivery: WebhookDelivery,
): Promise<Confirmation> {
  const probe = await deps.simulated.payIn.inspectWebhook(delivery);
  if (!probe.ok) {
    if (probe.error.code === "invalid_signature")
      return { kind: "refused", problem: "invalid_signature" };
    if (probe.error.code === "malformed") return { kind: "not_pay_in" };
  }
  const key = probe.ok ? probe.value.externalReference : digestOf(delivery.body);
  const progress: WriteProgress = { books: false, record: false, status: false };
  try {
    return await LOCKS.run(key, async () => {
      const read = await deps.simulated.payIn.inspectWebhook(delivery);
      if (!read.ok) {
        if (read.error.code === "invalid_signature")
          return { kind: "refused", problem: "invalid_signature" };
        if (read.error.code === "malformed") return { kind: "not_pay_in" };
        return unknownRequest(deps, delivery);
      }
      return decide(deps, delivery, read.value, progress);
    });
  } catch (error) {
    if (error instanceof WriteStopped) throw error;
    throw new WriteStopped(problemOf(progress));
  }
}

/** A request the Node does not know: nothing is posted, the body's digest keys the flag, and the delivery is acknowledged. */
function unknownRequest(deps: ConfirmationDeps, delivery: WebhookDelivery): Confirmation {
  const digest = digestOf(delivery.body);
  deps.store.flag({
    kind: "unknown_payment",
    key: digest,
    text: `A simulated payment came in for a request this Node does not know. Nothing was posted. Ask the admin to check ${SIM}.`,
    at: deps.now(),
  });
  return answer(digest, false, { flagged: "unknown_payment" });
}

/** Decides what a verified, read delivery does, and does it. Runs under the payment's lock. */
async function decide(
  deps: ConfirmationDeps,
  delivery: WebhookDelivery,
  r: WebhookReading,
  progress: WriteProgress,
): Promise<Confirmation> {
  const flat: Read = {
    externalReference: r.externalReference,
    paymentId: r.paymentId,
    outcome: r.outcome,
    status: r.status,
    minor: r.requested.minor,
    currency: r.requested.currency,
  };
  const key = requestRef(r.paymentId);
  const amount = randText(r.requested.minor);
  const pledge = await findPledge(deps.hub, r.externalReference);
  const community = pledge?.communityKey;
  const scoped = community === undefined ? {} : { communityKey: community };

  if (!r.amountMatches) {
    deps.store.flag({
      kind: "amount_mismatch",
      key: `${key}|${r.outcome}`,
      ...scoped,
      text: `A simulated payment came in with a different amount from its request (${amount} asked for). Nothing was posted. Ask the admin to check ${SIM}.`,
      at: deps.now(),
    });
    return answer(key, false, { flagged: "amount_mismatch" });
  }

  if (r.outcome === "completed") {
    if (r.status === "expired" || r.status === "failed" || r.status === "cancelled") {
      return endedCompletion(deps, delivery, r.status, key, amount, scoped, progress);
    }
    if (pledge === undefined) {
      deps.store.flag({
        kind: "no_pledge",
        key,
        text: `A simulated payment of ${amount} came in, but no pledge in this Node's communities matches it. Nothing was posted ${SIM}. Ask the admin to check.`,
        at: deps.now(),
      });
      if (r.status === "completed")
        return answer(key, false, { status: "completed", flagged: "no_pledge" });
      const done = await ingest(deps, delivery, progress);
      return answer(key, done.applied, { status: done.status, flagged: "no_pledge" });
    }
    const already = r.status === "completed";
    const written = await writeCompletion(deps, flat, pledge, progress);
    if (written.kind === "ended") {
      return endedCompletion(deps, delivery, written.status, key, amount, scoped, progress);
    }
    if (written.kind === "stopped") {
      const problem = problemOf(progress);
      return { kind: "not_acknowledged", problem, message: messageOf(problem) };
    }
    if (already) return answer(key, false, { status: "completed" });
    const done = await ingest(deps, delivery, progress);
    if (done.status !== "completed") {
      // Cancelled or expired while the books were being written. The books cannot be unwritten, so it is flagged now.
      deps.store.flag({
        kind: "completed_after_ended",
        key,
        ...scoped,
        text: `A simulated payment of ${amount} was posted to the pool books just as its request was ${done.status === "expired" ? "expiring" : "being cancelled"}. Check it ${SIM}.`,
        at: deps.now(),
      });
      return answer(key, false, { status: done.status, flagged: "completed_after_ended" });
    }
    return answer(key, done.applied, { status: done.status });
  }

  if (r.outcome === "failed") {
    if (r.status === "completed") {
      deps.store.flag({
        kind: "failed_after_completed",
        key,
        ...scoped,
        text: `A simulated payment of ${amount} was reported as failed after it had been paid. Nothing changed ${SIM}. Ask the admin to check.`,
        at: deps.now(),
      });
      return answer(key, false, { status: "completed", flagged: "failed_after_completed" });
    }
    if (r.status !== "pending" && r.status !== "failed")
      return answer(key, false, { status: r.status });
    if (pledge === undefined) {
      deps.store.flag({
        kind: "no_pledge",
        key,
        text: `A simulated payment of ${amount} was reported as failed, but no pledge in this Node's communities matches it. Nothing was recorded ${SIM}. Ask the admin to check.`,
        at: deps.now(),
      });
    }
    // The provider's status is applied first: a failed ingest never leaves "failed" in the record (review item 4).
    let status: PaymentStatus = r.status;
    let applied = false;
    if (r.status === "pending") {
      const done = await ingest(deps, delivery, progress);
      status = done.status;
      applied = done.applied;
      if (status === "completed") {
        deps.store.flag({
          kind: "failed_after_completed",
          key,
          ...scoped,
          text: `A simulated payment of ${amount} was reported as failed after it had been paid. Nothing changed ${SIM}. Ask the admin to check.`,
          at: deps.now(),
        });
        return answer(key, false, { status, flagged: "failed_after_completed" });
      }
      if (status !== "failed") return answer(key, false, { status });
    }
    if (pledge !== undefined && !(await writeFailure(deps, flat, pledge, progress))) {
      throw new WriteStopped(problemOf(progress));
    }
    return answer(key, applied, {
      status,
      ...(pledge === undefined ? { flagged: "no_pledge" as const } : {}),
    });
  }

  // Cancelled or expired: the status is applied while the request is still pending; no money moves.
  if (r.status === "pending") {
    const done = await ingest(deps, delivery, progress);
    return answer(key, done.applied, { status: done.status });
  }
  return answer(key, false, { status: r.status });
}

/** A completion for a request that has already ended: flagged, never posted; an expiry is also a late completion. */
async function endedCompletion(
  deps: ConfirmationDeps,
  delivery: WebhookDelivery,
  status: PaymentStatus,
  key: string,
  amount: string,
  scoped: { communityKey?: string },
  progress: WriteProgress,
): Promise<Confirmation> {
  if (status === "expired") {
    const done = await ingest(deps, delivery, progress);
    deps.store.flag({
      kind: "late_completion",
      key,
      ...scoped,
      text: `A simulated payment of ${amount} arrived after its request had run out. It was not posted. Ask the admin to check ${SIM}.`,
      at: deps.now(),
    });
    return answer(key, false, {
      status: done.status,
      lateCompletion: done.lateCompletion,
      flagged: "late_completion",
    });
  }
  deps.store.flag({
    kind: "completed_after_ended",
    key,
    ...scoped,
    text: `A simulated payment of ${amount} was reported as paid after its request had already ${status === "failed" ? "failed" : "been cancelled"}. It was not posted. Ask the admin to check ${SIM}.`,
    at: deps.now(),
  });
  return answer(key, false, { status, flagged: "completed_after_ended" });
}

async function ingest(
  deps: ConfirmationDeps,
  delivery: WebhookDelivery,
  progress: WriteProgress,
): Promise<{ applied: boolean; lateCompletion: boolean; status: PaymentStatus }> {
  const outcome = await deps.simulated.payIn.ingestWebhook(delivery);
  if (!outcome.ok) throw new Error("the verified webhook could not be applied");
  progress.status = true;
  return {
    applied: outcome.value.applied,
    lateCompletion: outcome.value.lateCompletion,
    status: outcome.value.payment.status,
  };
}
