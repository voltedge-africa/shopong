// The Node's payment routes for a member's pledge (story 4.3). The phone sends only the pledge's event id; the Node
// checks the record and the caller, writes the Node's `payment.requested` into the record, and only then creates the
// request at the payments adapter. Both routes pass the request-proof gate (`signed.ts`) before they read the body.
//
//   POST /payments/requests           { community, pledge }  -> the bank page for the pledge. A repeat for the same
//                                      pledge while its request is pending gives that request again (one request, one
//                                      record event).
//   GET  /payments/status             ?community=<key>&pledge=<event id>
//                                      -> the status of the request for the member's pledge (a query, not a path
//                                      segment: Fastify caps path parameters at 100 characters).
//
// The Node decides everything the bank sees: the amount (the pledge's own), the payer reference (`OCN-` plus 8 hex of
// HMAC-SHA512 of the member's DID under a key derived for this community from the community secret, so the same member
// has a different reference in each community, never a name), and the expiry, which is the Node's own clock at the
// time the request is made plus `PAYMENT_WINDOW_MS`. The event's time is never used for expiry (a far-future claim
// cannot keep a request payable). Only a member's current pledge for an order can be paid, and only one payment may be
// waiting for a member's order at a time. Any amount, payment id or bank address a phone sends is refused.
// Refusals are audit-logged; every line says `simulated: true` while the payments are simulated.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DAY_MS, checkPayable, pledgeByEvent, PLEDGE_MESSAGES } from "@shopong/community";
import {
  createEvent,
  encodeUtf8,
  keyedCommitment,
  sha512Hex,
  webCryptoSha512,
  type EventEnvelope,
  type HmacSha512,
} from "@shopong/events";
import type { SimulatedStitch } from "@shopong/adapter-stitch-sim";
import type { CapabilityAuth, Did, EpochMs, ViewReader } from "@shopong/ports";
import { SIMULATED_MODE } from "./payments.ts";
import {
  claimNonce,
  DEFAULT_MAX_NONCES,
  FixedWindows,
  SeenNonces,
  verifySignedRequest,
  type SignedGate,
} from "./signed.ts";

/** How long a member has to pay a pledge: three days from the Node's own clock when the request is made. */
export const PAYMENT_WINDOW_MS = 3 * DAY_MS;
/** At most this many verified payment calls (requests and status reads, refused ones included) per caller per window. */
export const PAYMENT_RATE = { max: 60, windowMs: 10 * 60 * 1000 } as const;

/** The plain sentences a phone shows. None names a bank, a processor or a secret. */
export const PAYMENT_REQUEST_MESSAGES = {
  invalid_request: "The request is not in the form the Node expects.",
  amount_refused: PLEDGE_MESSAGES.amount_must_match,
  not_configured: "Payments are not switched on for this Node.",
  not_held: "This Node does not hold that community.",
  not_member: PLEDGE_MESSAGES.pay_no_role,
  unknown_pledge: "The Node does not have that pledge yet. Try Pay again in a moment.",
  not_yours: PLEDGE_MESSAGES.pay_not_yours,
  not_yours_status: "You can only see the payment for your own pledge.",
  not_current: "That is not your current pledge for this order. Pay the newest one.",
  already_finished: "This pledge's payment is already finished. Make a new pledge to pay again.",
  live_elsewhere: "You already have a payment waiting for this order. Finish it first.",
  window_closed: "This pledge's payment time has run out. Make a new pledge and pay again.",
  no_secret: "This Node has no secret for this community yet.",
  record_unavailable:
    "The payment could not be written to the community's record, so nothing was paid. Try Pay again.",
  bank_unavailable: "The bank request could not be made just now. Nothing was paid. Try Pay again.",
  rate_limited: "Too many payment requests. Try again later.",
} as const;

const HTTP_STATUS: Record<string, number> = {
  unsigned: 401,
  bad_nonce: 400,
  clock_skew: 401,
  replayed: 409,
  busy: 429,
  invalid_request: 400,
  amount_refused: 400,
  not_configured: 503,
  not_held: 404,
  not_member: 403,
  unknown_pledge: 404,
  not_yours: 403,
  not_yours_status: 403,
  not_current: 409,
  already_finished: 409,
  live_elsewhere: 409,
  amount_range: 422,
  window_closed: 409,
  no_secret: 503,
  record_unavailable: 503,
  record_refused: 422,
  bank_unavailable: 422,
  rate_limited: 429,
};

/** The part of the replica hub the payment routes use. `ReplicaHub` implements it. */
export interface PaymentHub {
  registrationOf(communityKey: string): { spaceKey: string; creator: Did } | undefined;
  /** True for a current member, false for anyone else, undefined when the Node does not hold the community. */
  isMember(did: Did, communityKey: string): Promise<boolean | undefined>;
  /** The indexer's view, caught up with what the indexer holds. */
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
  /** Appends an event the Node made to the record, through the creator's replica (as `ReplicaHub.mirror`). */
  mirror(
    communityKey: string,
    event: EventEnvelope,
  ): Promise<{ id: string; duplicate: boolean; rejected?: string } | undefined>;
}

export interface PaymentRequestOptions {
  readonly auth: CapabilityAuth;
  /** The Node's clock. Defaults to `Date.now`. It sets every expiry. */
  readonly clock?: () => EpochMs;
  /** The simulated payments. Undefined: the routes answer 503. */
  readonly payments: SimulatedStitch | undefined;
  readonly hub: PaymentHub;
  /**
   * The payer reference's commitment for a member in a community, as hex: HMAC-SHA512 of the member's DID under the
   * community's own key (`communityPayerKey`). Undefined when the Node has no secret.
   */
  readonly payerCommitment: (communityKey: string, member: string) => Promise<string | undefined>;
  /** The Node's did:key: the `by` of the events it writes (the record's creator is the actor). */
  readonly nodeIdentity: Did;
  readonly maxNonces?: number;
}

/**
 * The key a community's payer references are committed with: derived from the one community secret and the community's
 * key, so two communities give two keys and the same member gets two different references (review item 3).
 */
export async function communityPayerKey(
  secret: Uint8Array,
  community: string,
  hmac: HmacSha512,
): Promise<Uint8Array> {
  const mac = await hmac(secret, encodeUtf8(`ocn/community-payer/v1\n${community}`));
  return mac.subarray(0, 32);
}

/** The payer commitment (hex) of a member in a community, under that community's key. */
export async function payerCommitmentOf(
  secret: Uint8Array,
  community: string,
  member: string,
  hmac: HmacSha512,
): Promise<string> {
  return keyedCommitment(await communityPayerKey(secret, community, hmac), member, hmac);
}

const createBody = z.strictObject({
  community: z.string().regex(/^[0-9a-f]{64}$/u),
  pledge: z.string().regex(/^[0-9a-f]{128}$/u),
});

const statusQuery = z.strictObject({
  community: z.string().regex(/^[0-9a-f]{64}$/u),
  pledge: z.string().regex(/^[0-9a-f]{128}$/u),
});

/** The path of the simulated bank page for a request. The id is the capability, so it is the page's only address. */
export const bankPathOf = (paymentId: string): string => `/simulated-bank/${paymentId}`;

/** The plain sentence for a standing refusal. */
function standingReason(problem: string): string {
  if (problem === "not_configured") return PAYMENT_REQUEST_MESSAGES.not_configured;
  if (problem === "not_held") return PAYMENT_REQUEST_MESSAGES.not_held;
  return PAYMENT_REQUEST_MESSAGES.not_member;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The one-time number the Node's event carries: a fixed function of the pledge, so a retry writes the same event. */
async function nonceOf(pledgeEvent: string): Promise<string> {
  const digest = await sha512Hex(encodeUtf8(`payment.requested\n${pledgeEvent}`), webCryptoSha512);
  return digest.slice(0, 32);
}

export function registerPaymentRequestRoutes(
  app: FastifyInstance,
  options: PaymentRequestOptions,
): void {
  const clock = options.clock ?? Date.now;
  const gate: SignedGate = {
    auth: options.auth,
    nonces: new SeenNonces(options.maxNonces ?? DEFAULT_MAX_NONCES),
    clock,
  };
  const limits = new FixedWindows(clock);

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    problem: string,
    reason: string,
    actor?: string,
  ) => {
    request.log.warn(
      {
        audit: "payment_request",
        simulated: true,
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      `${reason} (simulated)`,
    );
    return reply.code(HTTP_STATUS[problem] ?? 403).send({
      simulated: true,
      problem,
      reason,
      requestId: request.id,
    });
  };

  /** The payments are on, the community is held, and the caller is a current member. */
  async function standing(communityKey: string, actor: Did): Promise<string | undefined> {
    if (options.payments === undefined) return "not_configured";
    if (options.hub.registrationOf(communityKey) === undefined) return "not_held";
    const member = await options.hub.isMember(actor, communityKey);
    if (member === undefined) return "not_held";
    if (!member) return "not_member";
    return undefined;
  }

  /** The member's pledges for this order that are not the current one, and the requests waiting on them. */
  async function otherLiveRequests(
    view: ViewReader,
    payments: SimulatedStitch,
    member: string,
    order: string,
    current: string,
  ) {
    for (const entry of await view.list("pledge-events/")) {
      const other = entry.value as { member?: unknown; order?: unknown; event?: unknown } | null;
      if (other === null || typeof other !== "object") continue;
      if (other.member !== member || other.order !== order || other.event === current) continue;
      const waiting = await payments.payIn.findRequest(String(other.event) as never);
      if (waiting?.status === "pending") return true;
    }
    return false;
  }

  app.post("/payments/requests", async (request, reply) => {
    // 1. The signature and the time. Nothing is claimed yet.
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      return refuse(
        request,
        reply,
        verdict.problem,
        PAYMENT_REQUEST_MESSAGES.invalid_request,
        verdict.actor,
      );
    }
    const actor = verdict.actor;

    // 2. Every verified call counts, refused ones included (review item 8).
    if (!limits.spend("payments", actor, PAYMENT_RATE.max, PAYMENT_RATE.windowMs)) {
      return refuse(request, reply, "rate_limited", PAYMENT_REQUEST_MESSAGES.rate_limited, actor);
    }

    // 3. The body. An amount, a payment id or a bank address from the phone is refused by name.
    const raw = parseJson(request.rawBody);
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (
        keys.some((key) =>
          ["amount", "paymentId", "url", "externalReference", "payerReference"].includes(key),
        )
      ) {
        return refuse(
          request,
          reply,
          "amount_refused",
          PAYMENT_REQUEST_MESSAGES.amount_refused,
          actor,
        );
      }
    }
    const body = createBody.safeParse(raw);
    if (!body.success) {
      return refuse(
        request,
        reply,
        "invalid_request",
        PAYMENT_REQUEST_MESSAGES.invalid_request,
        actor,
      );
    }
    const { community, pledge: pledgeEvent } = body.data;

    // 4. The caller's standing.
    const refusedBy = await standing(community, actor as Did);
    if (refusedBy !== undefined) {
      return refuse(request, reply, refusedBy, standingReason(refusedBy), actor);
    }
    const payments = options.payments;
    if (payments === undefined) {
      return refuse(
        request,
        reply,
        "not_configured",
        PAYMENT_REQUEST_MESSAGES.not_configured,
        actor,
      );
    }

    // 5. The pledge, read from the record: it must exist, be the caller's own, and be the caller's current one for
    //    its order (review item 2). Its amount must be in range.
    const view = await options.hub.indexedView(community);
    const pledged = view === undefined ? undefined : await pledgeByEvent(view, pledgeEvent);
    if (view === undefined || pledged === undefined) {
      return refuse(
        request,
        reply,
        "unknown_pledge",
        PAYMENT_REQUEST_MESSAGES.unknown_pledge,
        actor,
      );
    }
    const payable = checkPayable(pledged, actor);
    if (payable !== undefined) {
      const problem = payable === PLEDGE_MESSAGES.pay_not_yours ? "not_yours" : "amount_range";
      return refuse(request, reply, problem, payable, actor);
    }
    const current = (await view.get(`pledges/${encodeURIComponent(pledged.order)}/${actor}`)) as
      | { event?: unknown }
      | undefined;
    if (current?.event !== pledgeEvent) {
      return refuse(request, reply, "not_current", PAYMENT_REQUEST_MESSAGES.not_current, actor);
    }

    // 6. Only now is the one-time number recorded.
    const used = claimNonce(gate.nonces, verdict);
    if (used !== undefined)
      return refuse(request, reply, used, "That request was already used.", actor);

    // 7. The request for this pledge, if one exists: a pending one is given again; a finished one is not revived.
    const existing = await payments.payIn.findRequest(pledgeEvent as never);
    if (existing !== undefined && existing.status !== "pending") {
      return refuse(
        request,
        reply,
        existing.status === "expired" ? "window_closed" : "already_finished",
        existing.status === "expired"
          ? PAYMENT_REQUEST_MESSAGES.window_closed
          : PAYMENT_REQUEST_MESSAGES.already_finished,
        actor,
      );
    }
    if (
      existing === undefined &&
      (await otherLiveRequests(view, payments, actor, pledged.order, pledgeEvent))
    ) {
      return refuse(
        request,
        reply,
        "live_elsewhere",
        PAYMENT_REQUEST_MESSAGES.live_elsewhere,
        actor,
      );
    }

    // 8. The window, from the Node's clock: an old pledge has run out.
    if (existing === undefined && pledged.claimedAt + PAYMENT_WINDOW_MS <= clock()) {
      return refuse(request, reply, "window_closed", PAYMENT_REQUEST_MESSAGES.window_closed, actor);
    }
    const commitment = await options.payerCommitment(community, actor);
    if (commitment === undefined) {
      return refuse(request, reply, "no_secret", PAYMENT_REQUEST_MESSAGES.no_secret, actor);
    }
    const payerReference = `OCN-${commitment.slice(0, 8)}`;

    // 9. The record first. The Node's event is written as the creator; if the record refuses it, nothing is created.
    const creator = options.hub.registrationOf(community)?.creator;
    if (creator === undefined) {
      return refuse(request, reply, "not_held", PAYMENT_REQUEST_MESSAGES.not_held, actor);
    }
    const requestedEvent = createEvent({
      type: "payment.requested",
      space: community,
      actor: creator,
      proof: [],
      claimedAt: pledged.claimedAt,
      nonce: await nonceOf(pledgeEvent),
      payload: {
        direction: "in",
        pledgeEvent,
        amount: { currency: "ZAR", minor: pledged.minor },
        by: options.nodeIdentity,
      },
    } as never) as EventEnvelope;
    const mirrored = await options.hub.mirror(community, requestedEvent);
    if (mirrored === undefined) {
      return refuse(
        request,
        reply,
        "record_unavailable",
        PAYMENT_REQUEST_MESSAGES.record_unavailable,
        actor,
      );
    }
    // The record's verdict (review item 7): a refused event means no bank request is made.
    if (mirrored.rejected !== undefined) {
      return refuse(request, reply, "record_refused", mirrored.rejected, actor);
    }

    // 10. The bank request, keyed by the pledge's event id, expiring on the Node's clock.
    const made =
      existing !== undefined
        ? { ok: true as const, value: existing }
        : await payments.payIn.createRequest({
            amount: { currency: "ZAR", minor: pledged.minor },
            externalReference: pledgeEvent as never,
            payerReference,
            beneficiaryReference: "OCN POOL",
            expireAt: clock() + PAYMENT_WINDOW_MS,
            methods: ["pay_by_bank"],
          });
    let value = existing;
    if (!made.ok) {
      // A concurrent call made the same request first: the same request is the answer (review item 12, the race).
      value = (await payments.payIn.findRequest(pledgeEvent as never)) ?? undefined;
      if (value === undefined) {
        request.log.warn(
          {
            audit: "payment_request",
            simulated: true,
            outcome: "refused",
            problem: made.error.code,
            requestId: request.id,
          },
          `${PAYMENT_REQUEST_MESSAGES.bank_unavailable} (simulated)`,
        );
        return reply.code(422).send({
          simulated: true,
          problem: "bank_unavailable",
          reason: PAYMENT_REQUEST_MESSAGES.bank_unavailable,
          recorded: true,
          requestId: request.id,
        });
      }
    } else {
      value = made.value;
    }

    request.log.info(
      {
        audit: "payment_request",
        simulated: true,
        outcome: "allowed",
        actor,
        recorded: true,
        requestId: request.id,
      },
      "payment request made (simulated)",
    );
    return reply.code(200).send({
      simulated: true,
      status: value!.status,
      amountMinor: pledged.minor,
      expiresAt: value!.expireAt,
      bankPath: bankPathOf(value!.id),
      payerReference,
      recorded: true,
      requestId: request.id,
    });
  });

  app.get("/payments/status", async (request, reply) => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      return refuse(
        request,
        reply,
        verdict.problem,
        PAYMENT_REQUEST_MESSAGES.invalid_request,
        verdict.actor,
      );
    }
    const actor = verdict.actor;
    if (!limits.spend("payments", actor, PAYMENT_RATE.max, PAYMENT_RATE.windowMs)) {
      return refuse(request, reply, "rate_limited", PAYMENT_REQUEST_MESSAGES.rate_limited, actor);
    }
    const query = statusQuery.safeParse(request.query);
    if (!query.success) {
      return refuse(
        request,
        reply,
        "invalid_request",
        PAYMENT_REQUEST_MESSAGES.invalid_request,
        actor,
      );
    }
    const { community, pledge: pledgeEvent } = query.data;
    const refusedBy = await standing(community, actor);
    if (refusedBy !== undefined) {
      return refuse(request, reply, refusedBy, standingReason(refusedBy), actor);
    }
    const view = await options.hub.indexedView(community);
    const pledged = view === undefined ? undefined : await pledgeByEvent(view, pledgeEvent);
    if (pledged === undefined) {
      return refuse(
        request,
        reply,
        "unknown_pledge",
        PAYMENT_REQUEST_MESSAGES.unknown_pledge,
        actor,
      );
    }
    if (pledged.member !== actor) {
      return refuse(
        request,
        reply,
        "not_yours_status",
        PAYMENT_REQUEST_MESSAGES.not_yours_status,
        actor,
      );
    }
    const used = claimNonce(gate.nonces, verdict);
    if (used !== undefined)
      return refuse(request, reply, used, "That request was already used.", actor);

    const payments = options.payments;
    if (payments === undefined) {
      return refuse(
        request,
        reply,
        "not_configured",
        PAYMENT_REQUEST_MESSAGES.not_configured,
        actor,
      );
    }
    const found = await payments.payIn.findRequest(pledgeEvent as never);
    return reply.code(200).send({
      simulated: true,
      mode: SIMULATED_MODE,
      status: found?.status ?? "none",
      amountMinor: pledged.minor,
      expiresAt: found?.expireAt,
      bankPath: found?.status === "pending" ? bankPathOf(found.id) : undefined,
      // Whether this pledge can still be paid: its request is pending, or none exists and the window is open on the
      // Node's clock. False tells the phone to offer Pay again (a new pledge), not Pay.
      windowOpen:
        found === undefined
          ? pledged.claimedAt + PAYMENT_WINDOW_MS > clock()
          : found.status === "pending",
      requestId: request.id,
    });
  });
}
