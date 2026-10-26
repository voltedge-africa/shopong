// The Node's payout routes (story 4.7). Money leaves the pool only here, and only when every check passes at the Node's
// own clock:
//
//   GET  /suppliers/bank/commitment?community=&supplier=   the keyed commitment of a supplier's bank details (members)
//   POST /suppliers/bank        { community, supplier, name, bankId, accountNumber, accountType }
//                               the treasurer keeps a supplier's bank details on the Node (never in the record)
//   POST /payouts               { community, payout }      pays a supplier from the pool for one recorded payment
//
// `payout` is the record event id of the treasurer's `payment.payout`, which carries the bank commitment the approvers
// signed. The Node re-counts the approvals at its own clock, checks the commitment still matches the supplier's bank
// details, checks the pool, reserves the payment and its supplier-and-order pair, posts the ledger entry (credit the pool,
// debit the supplier's payable) keyed by the payment's id, and then creates the simulated payout through `PayOut`.
// A posting that exists in the books is resumed on retry (the books are the source of truth), so a crash after the
// posting never strands money and never pays twice (shortcut S-4.7-5 covers the file-store gap).
//
// Every refusal says "(simulated)": the payments are the simulation (shortcut S-4.7-1). The one-time number and the rate
// limit are applied to every verified request, refused ones included.

import { createHmac } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  PAYOUT_MESSAGES,
  approvalsOf,
  approvalsPrefix,
  approverStanding,
  isCommunityKey,
  isTreasurer,
  logTimeOf,
  payoutKey,
  payoutRule,
  shortfallMessage,
} from "@shopong/community";
import { poolAccountOf, supplierPayableOf } from "@shopong/ledger-sqlite";
import type { SimulatedStitch } from "@shopong/adapter-stitch-sim";
import {
  asEventId,
  type CapabilityAuth,
  type Did,
  type EpochMs,
  type Ledger,
  type LedgerEntry,
  type ViewReader,
} from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import { postAndMirror, type MirrorHub } from "./ledger-mirror.ts";
import {
  claimNonce,
  DEFAULT_MAX_NONCES,
  FixedWindows,
  SeenNonces,
  verifySignedRequest,
  type SignedGate,
} from "./signed.ts";

const CURRENCY = "ZAR" as const;
/** At most this many verified payout calls (refused ones included) per caller per window. */
export const PAYOUT_RATE = { max: 30, windowMs: 10 * 60 * 1000 } as const;

/** What the Node says when it sends a payment. Nothing here names a bank, an account or a processor secret. */
export const PAYOUT_SENT = (supplier: string) =>
  `Payment sent to ${supplier} (simulated). No real money has moved. The bank's final answer is not checked yet.`;

/** A supplier's bank details, as the treasurer typed them. Held on the Node only (AGENTS rule 4). */
export interface SupplierBank {
  readonly name: string;
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountType: "current" | "savings";
}

/**
 * The keyed commitment of a supplier's bank details: HMAC-SHA512 under the Node's commitment key, over the community, the
 * supplier and every detail. The record and the phones hold this value, never the details (AGENTS rule 6).
 */
export function bankCommitmentOf(
  key: Uint8Array,
  community: string,
  supplier: string,
  bank: SupplierBank,
): string {
  const text = JSON.stringify([
    "ocn/bank/v1",
    community,
    supplier,
    bank.name,
    bank.bankId,
    bank.accountNumber,
    bank.accountType,
  ]);
  return createHmac("sha512", key).update(text, "utf8").digest("hex");
}

/** Where a payment stands on the Node: posted to the books, sent to the (simulated) bank, or the bank refused it. */
export type PayoutState = "posted" | "sent" | "failed";

export interface PayoutRecord {
  readonly payout: string;
  readonly community: string;
  readonly order: string;
  readonly supplier: string;
  readonly amountMinor: number;
  readonly approvers: readonly string[];
  readonly state: PayoutState;
  /** The simulated payout's id, once the bank has taken it. */
  readonly bankId?: string;
}

/**
 * The Node's own table: supplier bank details and the payments it has posted. A change is kept only once it is written
 * (the file store rolls back a failed write, as the simulated payments do, S-4.4-9).
 */
export interface PayoutStore {
  bankOf(community: string, supplier: string): SupplierBank | undefined;
  saveBank(community: string, supplier: string, bank: SupplierBank): void;
  payoutOf(payout: string): PayoutRecord | undefined;
  /** A payment for this supplier and order that is posted or sent, other than `except`. A failed one does not count. */
  paidFor(
    community: string,
    order: string,
    supplier: string,
    except: string,
  ): PayoutRecord | undefined;
  /** A payment to this supplier that is posted or sent (its bank details must not change while it is). */
  heldFor(community: string, supplier: string): PayoutRecord | undefined;
  savePayout(record: PayoutRecord): void;
}

interface StoreData {
  banks: Record<string, SupplierBank>;
  payouts: Record<string, PayoutRecord>;
}

const bankKey = (community: string, supplier: string) => `${community}\n${supplier}`;
const LIVE: readonly PayoutState[] = ["posted", "sent"];

function dataStore(initial: StoreData, persist: (data: StoreData) => void): PayoutStore {
  const data = initial;
  return {
    bankOf: (community, supplier) => data.banks[bankKey(community, supplier)],
    saveBank(community, supplier, bank) {
      const key = bankKey(community, supplier);
      const previous = data.banks[key];
      data.banks[key] = bank;
      try {
        persist(data);
      } catch (error) {
        if (previous === undefined) delete data.banks[key];
        else data.banks[key] = previous;
        throw error;
      }
    },
    payoutOf: (payout) => data.payouts[payout],
    paidFor(community, order, supplier, except) {
      return Object.values(data.payouts).find(
        (p) =>
          p.community === community &&
          p.order === order &&
          p.supplier === supplier &&
          p.payout !== except &&
          LIVE.includes(p.state),
      );
    },
    heldFor(community, supplier) {
      return Object.values(data.payouts).find(
        (p) => p.community === community && p.supplier === supplier && LIVE.includes(p.state),
      );
    },
    savePayout(record) {
      const previous = data.payouts[record.payout];
      data.payouts[record.payout] = record;
      try {
        persist(data);
      } catch (error) {
        if (previous === undefined) delete data.payouts[record.payout];
        else data.payouts[record.payout] = previous;
        throw error;
      }
    },
  };
}

/** An in-memory store, for tests and for a Node run without a data folder. */
export function createMemoryPayoutStore(): PayoutStore {
  return dataStore({ banks: {}, payouts: {} }, () => undefined);
}

/**
 * The store in a JSON file, written whole with fsync and rename after each change. A file that cannot be read is an error,
 * never an empty table: a payment already posted must not be posted again.
 */
export function openPayoutStore(path: string): PayoutStore {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const initial: StoreData = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as StoreData)
    : { banks: {}, payouts: {} };
  return dataStore(initial, (data) => {
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  });
}

/** The part of the replica hub the payout routes use. `ReplicaHub` implements it. */
export interface PayoutHub extends MirrorHub {
  registrationOf(communityKey: string): { spaceKey: string; creator: Did } | undefined;
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
}

export interface PayoutOptions {
  readonly auth: CapabilityAuth;
  /** The Node's clock. Defaults to `Date.now`. It judges every approval and role. */
  readonly clock?: () => EpochMs;
  readonly hub: PayoutHub;
  readonly ledger: Ledger;
  readonly payments: SimulatedStitch;
  /** The Node's did:key: the `by` of the posting it writes to the record. */
  readonly nodeIdentity: Did;
  readonly store: PayoutStore;
  /** The key the bank commitments are made with (kept on the Node). */
  readonly commitmentKey: Uint8Array;
  readonly maxNonces?: number;
}

const payoutBody = z.strictObject({
  community: z.string().regex(/^[0-9a-f]{64}$/u),
  payout: z.string().regex(/^[0-9a-f]{128}$/u),
});

const bankBody = z.strictObject({
  community: z.string().regex(/^[0-9a-f]{64}$/u),
  supplier: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  bankId: z.string().min(1).max(40),
  accountNumber: z.string().regex(/^\d{6,16}$/u),
  accountType: z.enum(["current", "savings"]),
});

const commitmentQuery = z.strictObject({
  community: z.string().regex(/^[0-9a-f]{64}$/u),
  supplier: z.string().min(1).max(100),
});

const PAYOUT_PROBLEM_STATUS: Record<string, number> = {
  not_held: 404,
  not_member: 403,
  not_permitted: 403,
  unknown_payment: 404,
  not_enough_approvals: 422,
  short_funds: 422,
  no_bank_details: 422,
  bank_changed: 422,
  bank_locked: 409,
  already_paid: 409,
  in_progress: 409,
  invalid_request: 422,
  payout_failed: 422,
  rate_limited: 429,
  record_unavailable: 503,
  posting_failed: 503,
  store_unavailable: 503,
};

const NO_BANK = "Add this supplier's bank details first.";
const ALREADY_PAID = "This supplier has already been paid for this order.";
const IN_PROGRESS = "That payment is already being sent. Check again in a moment.";
const BANK_CHANGED = "The bank details changed after the approvals. Ask for the approvals again.";
const BANK_LOCKED =
  "Bank details cannot change while a payment to this supplier is approved or sent. Start a new payment to change them.";
const PAYOUT_FAILED =
  "The simulated bank did not take the payment. The books keep the posting, and nothing more was sent. Try Pay again.";
const RECORD_UNAVAILABLE =
  "The posting could not be written to the record. Nothing was paid. Try again.";
const STORE_UNAVAILABLE = "The Node could not save that just now. Try again.";
const BAD_BANK = "The bank details are not in the form the Node expects.";
const RATE_LIMITED = "Too many payment requests. Try again later.";

/** The sentence a person sees for a refusal. Every refusal on these routes says it is simulated. */
const simulated = (reason: string) => `${reason} (simulated)`;

export function registerPayoutRoutes(app: FastifyInstance, options: PayoutOptions): void {
  const clock = options.clock ?? Date.now;
  const gate: SignedGate = {
    auth: options.auth,
    nonces: new SeenNonces(options.maxNonces ?? DEFAULT_MAX_NONCES),
    clock,
  };
  const limits = new FixedWindows(clock);
  /** Payments whose posting or payout is under way on this Node, by payment id. */
  const inFlight = new Set<string>();
  /** The payment that holds each supplier-and-order pair while it is under way (one payout per pair). */
  const pairs = new Map<string, string>();

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    problem: string,
    reason: string,
    actor?: string,
    status?: number,
  ) => {
    request.log.warn(
      {
        audit: "payout",
        simulated: true,
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      simulated(reason),
    );
    const code =
      status ??
      PAYOUT_PROBLEM_STATUS[problem] ??
      (HTTP_STATUS as Record<string, number | undefined>)[problem] ??
      400;
    return reply.code(code).send({
      simulated: true,
      problem,
      reason: simulated(reason),
      requestId: request.id,
    });
  };

  /**
   * The signature, the rate limit and the one-time number, for every verified request (refused ones too). Returns the
   * refusal to send, or undefined when the request may go on.
   */
  const admit = (
    request: FastifyRequest,
    reply: FastifyReply,
    verdict: {
      readonly ok: true;
      readonly actor: Did;
      readonly now: EpochMs;
      readonly nonce: string;
    },
  ) => {
    if (!limits.spend("payouts", verdict.actor, PAYOUT_RATE.max, PAYOUT_RATE.windowMs)) {
      return refuse(request, reply, "rate_limited", RATE_LIMITED, verdict.actor);
    }
    const used = claimNonce(gate.nonces, verdict);
    if (used !== undefined) return refuse(request, reply, used, nodeMessage(used), verdict.actor);
    return undefined;
  };

  /** The community is held, the caller is a member, and the record is readable. Otherwise the refusal to send. */
  async function standing(communityKey: string, actor: Did) {
    const registered = isCommunityKey(communityKey)
      ? options.hub.registrationOf(communityKey)
      : undefined;
    if (registered === undefined)
      return {
        refusal: { problem: "not_held", reason: "This Node does not hold that community." },
      };
    const member = await options.hub.isMember(actor, communityKey);
    if (member === undefined)
      return {
        refusal: { problem: "not_held", reason: "This Node does not hold that community." },
      };
    if (!member)
      return {
        refusal: { problem: "not_member", reason: "You are not a member of this community." },
      };
    const view = await options.hub.indexedView(communityKey);
    if (view === undefined)
      return { refusal: { problem: "record_unavailable", reason: RECORD_UNAVAILABLE } };
    return { registered, view };
  }

  /** The Node's clock or the record's log time, whichever is later: a role ended by either one does not count. */
  async function judgeAt(view: ViewReader): Promise<EpochMs> {
    return Math.max(clock(), (await logTimeOf(view)) ?? 0);
  }

  function standingCtx(
    view: ViewReader,
    registered: { spaceKey: string; creator: Did },
    community: string,
  ) {
    return { auth: options.auth, creator: registered.creator, spaceKey: community, view };
  }

  /** Whether a payment to this supplier is approved (someone approved it) and not yet failed or sent in the Node's table. */
  async function approvedPendingFor(
    view: ViewReader,
    community: string,
    supplier: string,
  ): Promise<boolean> {
    for (const entry of await view.list("payouts/")) {
      const record = entry.value as { supplier?: unknown } | null;
      if (record === null || typeof record !== "object" || record.supplier !== supplier) continue;
      const id = entry.key.slice("payouts/".length);
      if ((await view.list(approvalsPrefix(id))).length > 0) return true;
    }
    return false;
  }

  /**
   * The approvers that stand for a payment at `at`. Only a current member counts, and an approval given before the member
   * joined again does not (a removed person must ask again, S-4.7 fix 12). Each approver is checked again here.
   */
  async function countApprovers(
    view: ViewReader,
    ctx: { auth: CapabilityAuth; creator: Did; spaceKey: string; view: ViewReader },
    payout: string,
    amountMinor: number,
    at: EpochMs,
  ) {
    const approvers: string[] = [];
    const refused: string[] = [];
    for (const entry of await view.list(approvalsPrefix(payout))) {
      const approver = entry.key.slice(approvalsPrefix(payout).length);
      const given = (entry.value as { at?: unknown } | null)?.at;
      const joined = (await view.get(`members/${approver}`)) as { joinedAt?: unknown } | undefined;
      if (
        typeof given === "number" &&
        typeof joined?.joinedAt === "number" &&
        joined.joinedAt > given
      ) {
        refused.push("That approval was given before you rejoined. Ask for a fresh one.");
        continue;
      }
      const problem = await approverStanding(ctx, approver, amountMinor, at);
      if (problem === undefined) approvers.push(approver);
      else refused.push(problem);
    }
    void view;
    return { approvers, refused };
  }

  app.get("/suppliers/bank/commitment", async (request, reply) => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      return refuse(
        request,
        reply,
        verdict.problem,
        nodeMessage(verdict.problem),
        verdict.actor,
        HTTP_STATUS[verdict.problem],
      );
    }
    const refusedNow = admit(request, reply, verdict);
    if (refusedNow !== undefined) return refusedNow;
    const actor = verdict.actor;
    const query = commitmentQuery.safeParse(request.query);
    if (!query.success)
      return refuse(
        request,
        reply,
        "invalid_request",
        "The request is not in the form the Node expects.",
        actor,
      );
    const found = await standing(query.data.community, actor);
    if (found.refusal !== undefined)
      return refuse(request, reply, found.refusal.problem, found.refusal.reason, actor);
    const bank = options.store.bankOf(query.data.community, query.data.supplier);
    if (bank === undefined) return refuse(request, reply, "no_bank_details", NO_BANK, actor, 404);
    return reply.code(200).send({
      commitment: bankCommitmentOf(
        options.commitmentKey,
        query.data.community,
        query.data.supplier,
        bank,
      ),
      requestId: request.id,
    });
  });

  app.post("/suppliers/bank", async (request, reply) => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      return refuse(
        request,
        reply,
        verdict.problem,
        nodeMessage(verdict.problem),
        verdict.actor,
        HTTP_STATUS[verdict.problem],
      );
    }
    const refusedNow = admit(request, reply, verdict);
    if (refusedNow !== undefined) return refusedNow;
    const actor = verdict.actor;
    const parsed = bankBody.safeParse(parseJson(request.rawBody));
    if (!parsed.success) return refuse(request, reply, "invalid_request", BAD_BANK, actor);
    const { community, supplier, name, bankId, accountNumber, accountType } = parsed.data;
    const found = await standing(community, actor);
    if (found.refusal !== undefined)
      return refuse(request, reply, found.refusal.problem, found.refusal.reason, actor);
    const at = await judgeAt(found.view);
    if (
      !(await isTreasurer(
        standingCtx(found.view, found.registered, community),
        found.view,
        actor,
        at,
      ))
    ) {
      return refuse(request, reply, "not_permitted", PAYOUT_MESSAGES.not_permitted, actor);
    }
    const next: SupplierBank = { name, bankId, accountNumber, accountType };
    const previous = options.store.bankOf(community, supplier);
    // Bank details the approvers have signed for cannot change while the payment is approved or sent (S-4.7 fix 3).
    if (
      previous !== undefined &&
      bankCommitmentOf(options.commitmentKey, community, supplier, previous) !==
        bankCommitmentOf(options.commitmentKey, community, supplier, next) &&
      (options.store.heldFor(community, supplier) !== undefined ||
        (await approvedPendingFor(found.view, community, supplier)))
    ) {
      return refuse(request, reply, "bank_locked", BANK_LOCKED, actor);
    }
    try {
      options.store.saveBank(community, supplier, next);
    } catch {
      return refuse(request, reply, "store_unavailable", STORE_UNAVAILABLE, actor);
    }
    // The audit line names the outcome only: never the supplier's account (AGENTS rule 4).
    request.log.info(
      { audit: "supplier_bank", simulated: true, outcome: "saved", actor, requestId: request.id },
      "supplier bank details saved (simulated)",
    );
    return reply.code(200).send({ saved: true, supplier, requestId: request.id });
  });

  app.post("/payouts", async (request, reply) => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      return refuse(
        request,
        reply,
        verdict.problem,
        nodeMessage(verdict.problem),
        verdict.actor,
        HTTP_STATUS[verdict.problem],
      );
    }
    const refusedNow = admit(request, reply, verdict);
    if (refusedNow !== undefined) return refusedNow;
    const actor = verdict.actor;
    const parsed = payoutBody.safeParse(parseJson(request.rawBody));
    if (!parsed.success)
      return refuse(
        request,
        reply,
        "invalid_request",
        "The request is not in the form the Node expects.",
        actor,
      );
    const { community, payout } = parsed.data;

    const found = await standing(community, actor);
    if (found.refusal !== undefined)
      return refuse(request, reply, found.refusal.problem, found.refusal.reason, actor);
    const { registered, view } = found;
    const at = await judgeAt(view);
    const ctx = standingCtx(view, registered, community);
    if (!(await isTreasurer(ctx, view, actor, at))) {
      return refuse(request, reply, "not_permitted", PAYOUT_MESSAGES.not_permitted, actor);
    }
    const recorded = (await view.get(payoutKey(payout))) as
      | { order: string; supplier: string; amountMinor: number; bank?: unknown }
      | undefined;
    if (recorded === undefined)
      return refuse(request, reply, "unknown_payment", PAYOUT_MESSAGES.unknown_payment, actor);

    // From here to the reservation there is no await: the checks and the reservation are one step, so two requests
    // cannot both pass them (S-4.7 fix 2).
    const earlier = options.store.payoutOf(payout);
    if (earlier?.state === "sent") return reply.code(200).send(answerOf(earlier, true, request.id));
    if (inFlight.has(payout)) return refuse(request, reply, "in_progress", IN_PROGRESS, actor);
    const pair = `${community}\n${recorded.order}\n${recorded.supplier}`;
    if (pairs.has(pair)) return refuse(request, reply, "already_paid", ALREADY_PAID, actor);
    inFlight.add(payout);
    pairs.set(pair, payout);
    try {
      const again = options.store.payoutOf(payout);
      if (again?.state === "sent") return reply.code(200).send(answerOf(again, true, request.id));
      if (options.store.paidFor(community, recorded.order, recorded.supplier, payout) !== undefined)
        return refuse(request, reply, "already_paid", ALREADY_PAID, actor);
      const bank = options.store.bankOf(community, recorded.supplier);
      if (bank === undefined) return refuse(request, reply, "no_bank_details", NO_BANK, actor);
      const commitment = bankCommitmentOf(
        options.commitmentKey,
        community,
        recorded.supplier,
        bank,
      );
      if (commitment !== recorded.bank)
        return refuse(request, reply, "bank_changed", BANK_CHANGED, actor);

      // The books first: a posting that exists for this payment means the money is already out of the pool, so the
      // retry resumes it and does not check funds or approvals again.
      const posted = await options.ledger.findByIdempotencyKey(payout);
      let approvers: string[] = earlier?.approvers.slice() ?? [];
      if (posted === undefined) {
        const required = await approvalsOf(view);
        const counted = await countApprovers(view, ctx, payout, recorded.amountMinor, at);
        approvers = counted.approvers;
        const poolMinor = BigInt(
          (await options.ledger.balance(poolAccountOf(community), CURRENCY)).balance.minor,
        );
        const rule = payoutRule({
          required,
          approvers,
          refused: counted.refused,
          amountMinor: recorded.amountMinor,
          poolMinor,
        });
        if (!rule.ok) {
          return refuse(
            request,
            reply,
            rule.problem === "short_funds" ? "short_funds" : "not_enough_approvals",
            rule.message,
            actor,
          );
        }
      } else if (approvers.length === 0) {
        approvers = (await countApprovers(view, ctx, payout, recorded.amountMinor, at)).approvers;
      }
      return await send(request, reply, {
        community,
        payout,
        recorded,
        earlier,
        bank,
        actor,
        approvers,
        posted: posted !== undefined,
      });
    } finally {
      inFlight.delete(payout);
      if (pairs.get(pair) === payout) pairs.delete(pair);
    }
  });

  /** The money: the posting first (refused when the pool is short), then the simulated payout. */
  async function send(
    request: FastifyRequest,
    reply: FastifyReply,
    job: {
      community: string;
      payout: string;
      recorded: { order: string; supplier: string; amountMinor: number };
      earlier: PayoutRecord | undefined;
      bank: SupplierBank;
      actor: string;
      approvers: readonly string[];
      /** True when the books already hold this payment's posting (a resumed payment). */
      posted: boolean;
    },
  ) {
    const { community, payout, recorded, actor } = job;
    if (!job.posted) {
      const amount = { currency: CURRENCY, minor: recorded.amountMinor };
      const entries: LedgerEntry[] = [
        { account: poolAccountOf(community), direction: "credit", amount },
        { account: supplierPayableOf(community), direction: "debit", amount },
      ];
      const posted = await postAndMirror(
        { ledger: options.ledger, hub: options.hub, nodeIdentity: options.nodeIdentity },
        {
          communityKey: community,
          idempotencyKey: payout,
          description: "Payment to a supplier (simulated)",
          entries,
        },
      );
      if (!posted.ok) {
        if (posted.error.code === "insufficient_funds") {
          const poolMinor = (await options.ledger.balance(poolAccountOf(community), CURRENCY))
            .balance.minor;
          return refuse(
            request,
            reply,
            "short_funds",
            shortfallMessage(BigInt(poolMinor), recorded.amountMinor),
            actor,
          );
        }
        return refuse(request, reply, "record_unavailable", RECORD_UNAVAILABLE, actor);
      }
    }
    const record: PayoutRecord = {
      payout,
      community,
      order: recorded.order,
      supplier: recorded.supplier,
      amountMinor: recorded.amountMinor,
      approvers: [...job.approvers],
      state: "posted",
    };
    try {
      options.store.savePayout(record);
    } catch {
      // The posting is in the books; the retry finds it there and resumes (no second posting).
      return refuse(request, reply, "store_unavailable", STORE_UNAVAILABLE, actor);
    }
    const sent = await options.payments.payOut.createPayout({
      amount: { currency: CURRENCY, minor: recorded.amountMinor },
      externalReference: asEventId(payout),
      beneficiary: {
        name: job.bank.name,
        bankId: job.bank.bankId,
        accountNumber: job.bank.accountNumber,
        accountType: job.bank.accountType,
      },
      beneficiaryReference: `OCN ${payout.slice(0, 8)}`,
      approval: { eventId: asEventId(payout), approvers: job.approvers as Did[] },
    });
    if (!sent.ok) {
      request.log.warn(
        {
          audit: "payout",
          simulated: true,
          outcome: "failed",
          problem: "payout_failed",
          actor,
          requestId: request.id,
        },
        "the simulated bank refused the payout (simulated)",
      );
      try {
        options.store.savePayout({ ...record, state: "failed" });
      } catch {
        return refuse(request, reply, "store_unavailable", STORE_UNAVAILABLE, actor);
      }
      return refuse(request, reply, "payout_failed", PAYOUT_FAILED, actor);
    }
    const done: PayoutRecord = { ...record, state: "sent", bankId: sent.value.id };
    try {
      options.store.savePayout(done);
    } catch {
      return refuse(request, reply, "store_unavailable", STORE_UNAVAILABLE, actor);
    }
    request.log.info(
      { audit: "payout", simulated: true, outcome: "sent", actor, requestId: request.id },
      "payment sent (simulated)",
    );
    return reply.code(200).send(answerOf(done, false, request.id));
  }

  function answerOf(record: PayoutRecord, replayed: boolean, requestId: string) {
    return {
      simulated: true,
      status: "pending",
      payout: record.payout,
      supplier: record.supplier,
      amountMinor: record.amountMinor,
      reason: PAYOUT_SENT(record.supplier),
      ...(replayed ? { replayed: true } : {}),
      requestId,
    };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
