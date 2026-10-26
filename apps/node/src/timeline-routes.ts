// The Node's transaction timeline route (story 10.2):
//
//   GET /communities/:key/transactions/:pledge/timeline   every step of one member's payment, in plain sentences, with
//                                                         the record, the pool books and the agreement between them.
//
// Only the member who made the pledge may read its timeline: the amount is that member's own, and another member's
// amount never leaves the Node (see `pool-routes.ts`). The answer holds the pledge's amount, the event ids and the
// sentences only: no DID, no phone or ID number, no bank details and no payer reference.
//
// The facts are gathered here from the record's journal (the Node's own `payment.requested`, `payment.completed` and
// `payment.failed` events, and its `ledger.posted` copies, all checked to be the Node's own by `by`) and from the books
// (`Ledger.findByIdempotencyKey`, keyed by each outcome's event id). The timeline itself is built by
// `transactionTimeline` in `@shopong/community`. If the books cannot be read, the timeline says so and nothing is
// compared.
//
// The request passes the request-proof gate (`signed.ts`) before anything is read, the same as the pool route.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  isCommunityKey,
  transactionTimeline,
  type BookedPosting,
  type BooksReading,
  type RecordedOutcome,
  type RecordedPosting,
  type TransactionFacts,
} from "@shopong/community";
import { POOL_BASE, poolAccountOf } from "@shopong/ledger-sqlite";
import type { EventEnvelope } from "@shopong/events";
import type { CapabilityAuth, Did, Ledger } from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import { LEDGER_POSTED } from "./pool-read.ts";
import { NOT_A_MEMBER, NOT_HELD, type PoolRouteOptions } from "./pool-routes.ts";
import { claimNonce, SeenNonces, verifySignedRequest, type SignedGate } from "./signed.ts";

export const PLEDGE_TYPE = "pledge.created";
export const PAYMENT_REQUESTED = "payment.requested";
export const PAYMENT_COMPLETED = "payment.completed";
export const PAYMENT_FAILED = "payment.failed";

export const TIMELINE_NOT_ON_RECORD = "This payment is not on the record.";
export const TIMELINE_NOT_YOURS = "You can only see the timeline of your own payment.";
export const TIMELINE_BOOKS_UNREADABLE =
  "The pool books could not be read right now, so the timeline is shown from the record only.";
/** Said beside the timeline whenever the Node's payments are the simulation. */
export const TIMELINE_SIMULATED_NOTE = "These payments are simulated. No real money has moved.";

type Payload = Record<string, unknown>;

function payloadOf(entry: EventEnvelope): Payload {
  return entry.payload as unknown as Payload;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function amountOf(payload: Payload): number | undefined {
  const amount = payload.amount;
  if (typeof amount !== "object" || amount === null) return undefined;
  return numberOf((amount as Payload).minor);
}

/** The pool's debit in a mirrored posting, in cents, when the copy holds one. */
function pooledOf(payload: Payload): number | undefined {
  const lines = Array.isArray(payload.entries) ? payload.entries : [];
  for (const line of lines) {
    if (typeof line !== "object" || line === null) continue;
    const l = line as Payload;
    if (l.account === POOL_BASE && l.direction === "debit") return numberOf(l.minor);
  }
  return undefined;
}

/**
 * The record's side of one payment, from the journal. Only the Node's own events count (`by` is the Node's identity).
 * Outcomes are the Node's `payment.completed` or `payment.failed`, and their `externalReference` is the pledge's id.
 */
export function recordFactsOf(
  journal: readonly { readonly id: string; readonly event: EventEnvelope }[],
  pledgeId: string,
  nodeIdentity: Did,
): Omit<TransactionFacts, "books" | "links"> | undefined {
  const pledgeEntry = journal.find(
    (entry) => entry.id === pledgeId && entry.event.type === PLEDGE_TYPE,
  );
  if (pledgeEntry === undefined) return undefined;
  const pledgeMinor = amountOf(payloadOf(pledgeEntry.event));
  if (pledgeMinor === undefined) return undefined;

  const requests: { eventId: string; at?: number; minor: number }[] = [];
  const outcomes: RecordedOutcome[] = [];
  for (const entry of journal) {
    const payload = payloadOf(entry.event);
    if (payload.by !== nodeIdentity) continue;
    if (entry.event.type === PAYMENT_REQUESTED && payload.pledgeEvent === pledgeId) {
      const minor = amountOf(payload);
      if (minor !== undefined) {
        requests.push({ eventId: entry.id, at: entry.event.claimedAt, minor });
      }
    } else if (
      (entry.event.type === PAYMENT_COMPLETED || entry.event.type === PAYMENT_FAILED) &&
      payload.externalReference === pledgeId
    ) {
      const minor = numberOf(payload.amountMinor);
      if (minor === undefined) continue;
      outcomes.push({
        eventId: entry.id,
        minor,
        status: entry.event.type === PAYMENT_COMPLETED ? "completed" : "failed",
      });
    }
  }

  const keys = new Set(outcomes.map((outcome) => outcome.eventId));
  const postings: RecordedPosting[] = [];
  for (const entry of journal) {
    const payload = payloadOf(entry.event);
    if (entry.event.type !== LEDGER_POSTED || payload.by !== nodeIdentity) continue;
    if (typeof payload.key !== "string" || !keys.has(payload.key)) continue;
    const minor = pooledOf(payload);
    if (minor === undefined) continue;
    postings.push({ eventId: entry.id, key: payload.key, minor });
  }

  return {
    pledge: { eventId: pledgeId, at: pledgeEntry.event.claimedAt, minor: pledgeMinor },
    requests,
    outcomes,
    postings,
  };
}

/**
 * The books' side: for each outcome, the posting the ledger holds under the outcome's event id. Unreadable when the
 * ledger is off or fails, so nothing is compared and the timeline says so.
 */
export async function booksOf(
  ledger: Ledger | undefined,
  communityKey: string,
  outcomes: readonly RecordedOutcome[],
): Promise<BooksReading> {
  if (ledger === undefined) return { readable: false };
  try {
    const postings: BookedPosting[] = [];
    const pool = poolAccountOf(communityKey);
    for (const outcome of outcomes) {
      const transaction = await ledger.findByIdempotencyKey(outcome.eventId);
      if (transaction === undefined) continue;
      const debit = transaction.entries.find(
        (entry) => entry.account === pool && entry.direction === "debit",
      );
      if (debit !== undefined) postings.push({ key: outcome.eventId, minor: debit.amount.minor });
    }
    return { readable: true, postings };
  } catch {
    return { readable: false };
  }
}

export function registerTimelineRoute(
  app: FastifyInstance,
  auth: CapabilityAuth,
  options: PoolRouteOptions,
): void {
  const gate: Pick<SignedGate, "auth" | "clock"> = { auth, clock: options.now ?? Date.now };
  const nonces = new SeenNonces(options.maxNonces);

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    problem: string,
    reason: string,
    actor?: Did,
  ) => {
    request.log.warn(
      {
        audit: "timeline",
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      reason,
    );
    return reply.code(status).send({ problem, reason, requestId: request.id });
  };

  app.get<{ Params: { key: string; pledge: string } }>(
    "/communities/:key/transactions/:pledge/timeline",
    async (request, reply) => {
      const verdict = await verifySignedRequest(gate, request);
      if (!verdict.ok) {
        return refuse(
          request,
          reply,
          HTTP_STATUS[verdict.problem] ?? 401,
          verdict.problem,
          nodeMessage(verdict.problem),
          verdict.actor,
        );
      }
      const { actor } = verdict;
      const { hub, ledger, nodeIdentity, simulated } = options;
      if (hub === undefined) {
        return refuse(request, reply, 503, "record_off", "The Node record is not running.", actor);
      }

      const { key, pledge } = request.params;
      const registered = isCommunityKey(key) ? hub.registrationOf(key) : undefined;
      if (registered === undefined) return refuse(request, reply, 404, "not_held", NOT_HELD, actor);
      const member = await hub.isMember(actor, key);
      if (!member) return refuse(request, reply, 403, "not_member", NOT_A_MEMBER, actor);

      const used = claimNonce(nonces, verdict);
      if (used !== undefined) {
        return refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
      }
      if (nodeIdentity === undefined) {
        return refuse(request, reply, 503, "record_off", "The Node record is not running.", actor);
      }

      try {
        const journal = await hub.journalOf(key);
        const pledgeEntry = journal.find(
          (entry) => entry.id === pledge && entry.event.type === PLEDGE_TYPE,
        );
        if (pledgeEntry === undefined) {
          return refuse(request, reply, 404, "not_on_record", TIMELINE_NOT_ON_RECORD, actor);
        }
        if (pledgeEntry.event.actor !== actor) {
          return refuse(request, reply, 403, "not_yours", TIMELINE_NOT_YOURS, actor);
        }
        const recorded = recordFactsOf(journal, pledge, nodeIdentity);
        if (recorded === undefined) {
          return refuse(request, reply, 404, "not_on_record", TIMELINE_NOT_ON_RECORD, actor);
        }
        const books = await booksOf(ledger, key, recorded.outcomes);
        const timeline = transactionTimeline({ ...recorded, books });
        request.log.info(
          { audit: "timeline", outcome: "accepted", actor, requestId: request.id },
          "timeline read answered",
        );
        return reply.code(200).send({
          timeline,
          requestId: request.id,
          ...(books.readable ? {} : { booksNote: TIMELINE_BOOKS_UNREADABLE }),
          ...(simulated === true
            ? { simulated: true, simulatedNote: TIMELINE_SIMULATED_NOTE }
            : {}),
        });
      } catch (error) {
        request.log.error(
          {
            audit: "timeline",
            outcome: "failed",
            actor,
            requestId: request.id,
            name: (error as Error).name,
          },
          "timeline read failed",
        );
        return refuse(
          request,
          reply,
          503,
          "record_unavailable",
          "The record can't be read right now.",
          actor,
        );
      }
    },
  );
}
