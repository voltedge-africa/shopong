// The deterministic `apply` of a community (AGENTS.md rule 3): it reads only the entry and the view,
// never the wall clock, the network or randomness.
//
// Log time (story 3.6, log-time.ts): every role and invitation check is judged at log time, the highest
// `claimedAt` accepted so far (`log/time` in the view), never at the event's own `claimedAt`. The event's
// claim counts only once its checks pass, and then log time may rise by at most one cap (a day). A revoked
// grant (`revoked/<grant id>`, from `role.revoked`) is refused on any later use.
//
// An event that fails a check is not dropped (logs cannot be edited): the view records
// `rejected/<event id>` with the plain reason, so every device sees the same thing.
//
// Every decision here is made on `event.actor`, a field the sender writes, so `apply` first requires it
// to be the writer who actually appended the entry (`entry.writer`). Without that, any admitted writer
// (an invitee, before they have even joined) could claim to be the creator and invite anyone.
//
// View keys: `members/<did>` { invitation, joinedAt }, `invitations/<id>` { invitee, expiresAt },
// `joined/<invitation id>` { member }, `roles/<did>/<role>` and `revoked/<grant id>` (see roles.ts),
// `delivered/<order>`, `collected/<order>/<member>` and `disputes/<order>/<event id>` (see delivery-proof.ts),
// `settings/approvals` (story 4.7), `community/name` and `community/rules` (story 8.1), `payouts/<payment id>` and
// `approvals/<payment id>/<approver>` (story 4.7),
// `quotes/<order>/<supplier>` (see quotes.ts), `files-of/<order>/<hash>` (see files.ts), `pledges/<order>/<member>` and `pledge-events/<event id>` (see
// pledges.ts), `orders/<order>` (the proposal and its status) and `order-ids/<event id>` { name } (see orders.ts, story 8.2), `selections/<order>` (the latest choice of a supplier, see selection.ts, story 8.3), `payments/<pledge event id>` (the Node's request for a pledge), `log/time` (see log-time.ts), `indexers/<did>` (true; the
// creator's is seeded by the founding join, story 3.3), `removed/<did>` { by, at } (set by a removal, cleared by a
// fresh invitation to that person; story 3.3), `rejected/<event id>` { type, reason }, `areas/<did>` { area } (a member's
// suburb or town, story 7.3; see areas.ts), `profiles/<did>` { name, kind?, area?, signature } (a small retailer's shown
// business profile, story 9.1; see profile.ts).

import {
  PAYLOAD_VALIDATORS,
  PERSONAL_DATA_MESSAGE,
  businessProfileBytes,
  checkPersonalFields,
  isPlainObject,
  type EventEnvelope,
  type FileAttachedPayload,
  type JsonObject,
} from "@shopong/events";
import type {
  Apply,
  CapabilityAuth,
  Did,
  EpochMs,
  RecordEntry,
  Signature,
  ViewWriter,
} from "@shopong/ports";
import { invitePassOnAllowed } from "./chain.js";
import { fileOfOrderKey, fileShapeProblem, fileUploadProblem } from "./files.js";
import {
  DELIVERY_MESSAGES,
  deliveryKey,
  placeAdderProblem,
  placeJson,
  driverStands,
  placeKey,
  placeRegistered,
  plannerProblem,
} from "./delivery.js";
import {
  PROOF_MESSAGES,
  collectedKey,
  deliveredKey,
  disputeKey,
  hasShareIn,
  plannedDriverOf,
} from "./delivery-proof.js";
import { verifyAuthority } from "./authority.js";
import { MEMBER_AREA_MESSAGES, memberAreaKey } from "./areas.js";
import { PROFILE_MESSAGES, PROFILE_TYPE, profileFieldsOfPayload, profileKey } from "./profile.js";
import { INVITATION_MESSAGES, JOIN_ABILITY, problemOf } from "./invitation.js";
import {
  CLAIM_MESSAGE,
  LOG_TIME_KEY,
  advanceLogTime,
  isValidClaim,
  logTimeOf,
} from "./log-time.js";
import { decodeProof } from "./proof.js";
import { NAMING_MESSAGES, NAMING_TYPE } from "./naming.js";
import {
  ORDER_MESSAGES,
  checkOrder,
  orderGateProblem,
  orderIdKey,
  orderJson,
  orderKey,
  ordersOf,
  proposalProblem,
  storedOrderOf,
} from "./orders.js";
import {
  QUOTE_MESSAGES,
  checkQuote,
  isTreasurer,
  quoteJson,
  quoteKey,
  quotesOf,
  tidy,
} from "./quotes.js";
import { SELECTION_MESSAGES, selectionJson, selectionKey, supplierTotalOf } from "./selection.js";
import {
  PAYMENT_REQUEST_KEYS,
  PAYMENT_TYPE_MESSAGE,
  PLEDGE_MESSAGES,
  checkPledge,
  paymentKey,
  pledgeByEvent,
  pledgeEventKey,
  pledgeJson,
  pledgeKey,
} from "./pledges.js";
import {
  coTreasurerJoinRecorded,
  coTreasurerProblem,
  isCoTreasurer,
  isCurrentGrantIn,
  isRevokedIn,
  recordRoleGrant,
  recordRoleRevocation,
  roleProblemOf,
  type StandingContext,
} from "./roles.js";
import { spaceUri } from "./space.js";
import {
  APPROVAL_TYPE,
  APPROVALS_KEY,
  DEFAULT_APPROVALS,
  PAYOUT_MESSAGES,
  PAYOUT_RECOMMENDATIONS,
  PAYOUT_TYPE,
  type PayoutRecommendation,
  approvalBytes,
  approvalKey,
  approverStanding,
  checkApprovalsSetting,
  payoutKey,
  termsOf,
} from "./payout.js";

/** The `invitation` a creator's own first `member.joined` carries. It needs no token. */
export const FOUNDER_INVITATION = "founder";

/** Why an event is refused when its `actor` is not the writer who appended it. */
export const NOT_THE_WRITER = "This was not written by the person it names.";

/** Why a `member.removed` is refused (story 3.3). Each is one plain sentence, as the record shows it. */
export const REMOVAL_MESSAGES = {
  unreadable: "This removal can't be read.",
  not_permitted: "Only the creator or a co-treasurer can remove someone else.",
  creator_not_removable: "The creator of a community cannot be removed.",
  not_a_member: "That person is not a member of this community.",
  last_indexer: "A community must keep at least one indexer, so this person cannot be removed.",
} as const;

export interface CommunityApplyEnvironment {
  readonly auth: CapabilityAuth;
  /** The creator: every invitation chain must start from this DID. */
  readonly creator: Did;
  /** The community key; events for any other space are refused. */
  readonly spaceKey: string;
}

function str(o: JsonObject, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

/** Why an event is refused when its payload is not an object, so it cannot be read. */
export const EVENT_UNREADABLE = "This event can't be read.";

const INDEXERS = "indexers/";

/** A did:key, as the Node's identity is written in `by`. */
const NODE_DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,}$/;

/** The event types `apply` checks. Other types are not applied yet, and do not move log time. */
const CHECKED: ReadonlySet<string> = new Set([
  "member.invited",
  "member.joined",
  "member.removed",
  "role.granted",
  "role.revoked",
  "quote.added",
  "pledge.created",
  "payment.requested",
  "file.attached",
  "place.registered",
  "delivery.planned",
  "delivery.confirmed",
  "member.area",
  "collection.confirmed",
  "delivery.disputed",
  PAYOUT_TYPE,
  APPROVAL_TYPE,
  NAMING_TYPE,
  PROFILE_TYPE,
  "order.proposed",
  "order.approved",
  "quote.selected",
]);

export function createCommunityApply(env: CommunityApplyEnvironment): Apply<EventEnvelope> {
  /** Who a co-treasurer's standing is judged against: the creator, this space, and the verifier. */
  const standing: StandingContext = {
    auth: env.auth,
    creator: env.creator,
    spaceKey: env.spaceKey,
  };

  async function invited(
    event: EventEnvelope,
    view: ViewWriter,
    host: Parameters<Apply<EventEnvelope>>[2],
    at: EpochMs,
  ): Promise<string | undefined> {
    if (event.actor !== env.creator && !(await isCoTreasurer(standing, view, event.actor, at))) {
      return "Only the creator can invite.";
    }
    const invitation = str(event.payload, "invitation");
    const invitee = str(event.payload, "invitee");
    const expiresAt = event.payload.expiresAt;
    if (invitation === undefined || invitee === undefined || typeof expiresAt !== "number")
      return INVITATION_MESSAGES.unreadable;
    await view.put(`invitations/${invitation}`, { invitee, expiresAt });
    // A fresh invitation ends a removal: the person may join again (story 3.3).
    await view.del(`removed/${invitee}`);
    await host.addWriter(invitee as Did);
    return undefined;
  }

  /** `at` is log time before this event; `joinedAt` is log time after it is accepted. */
  async function joined(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
    joinedAt: EpochMs,
  ) {
    const event = entry.event;
    const invitation = str(event.payload, "invitation");
    if (invitation === undefined) return INVITATION_MESSAGES.unreadable;
    if (invitation !== FOUNDER_INVITATION && (await view.get(`joined/${invitation}`)) !== undefined)
      return INVITATION_MESSAGES.already_used;
    if ((await view.get(`members/${event.actor}`)) !== undefined) return "Already a member.";

    if (invitation === FOUNDER_INVITATION) {
      if (event.actor !== env.creator || event.proof.length > 0)
        return INVITATION_MESSAGES.unreadable;
      // The approvals a payment needs (story 4.7): written once here, 1 to 5, the default of two when not given. Text,
      // a fraction or a number outside the range is refused, never converted.
      const given = event.payload.approvals;
      const approvals = given === undefined ? DEFAULT_APPROVALS : checkApprovalsSetting(given);
      if (approvals === undefined) return PAYOUT_MESSAGES.approvals_invalid;
      await view.put(APPROVALS_KEY, approvals);
      // The creator is the community's first indexer (story 3.3); nothing else seeds the set.
      await view.put(`${INDEXERS}${event.actor}`, true);
    } else {
      const proof = event.proof[0];
      const token = proof === undefined ? undefined : decodeProof(proof);
      if (token === undefined) return INVITATION_MESSAGES.unreadable;
      const verified = await verifyAuthority(env.auth, token, {
        holder: event.actor as Did,
        rootIssuer: env.creator,
        at,
        required: { with: spaceUri(env.spaceKey), can: JOIN_ABILITY },
        isRevoked: (id) => isRevokedIn(view, id),
        isCurrentGrant: (who, id) => isCurrentGrantIn(view, who, id),
      });
      if (!verified.ok) return INVITATION_MESSAGES[problemOf(verified.error.code)];
      const passedOn = await invitePassOnAllowed(
        env.auth,
        verified.value.chain,
        (inviter, parentId) => coTreasurerJoinRecorded(view, inviter, parentId, at),
      );
      if (!passedOn) return INVITATION_MESSAGES.unreadable;
      // The token must be the one the event names, so its id cannot be swapped to dodge the reuse check.
      if ((await env.auth.tokenId(token)) !== invitation) return INVITATION_MESSAGES.unreadable;
      await view.put(`joined/${invitation}`, { member: event.actor });
    }
    await view.put(`members/${event.actor}`, { invitation, joinedAt });
    return undefined;
  }

  /**
   * A removal by capability (story 3.3), judged at log time (story 3.6). The creator, or a co-treasurer whose standing
   * holds at log time, may remove anyone but the creator; a member may remove themself. The creator is never removed.
   * The indexer set must keep at least one indexer. The removed member's earlier events stay in the view; role grants
   * are not touched (story 2.6 revokes them).
   */
  async function removed(
    event: EventEnvelope,
    view: ViewWriter,
    host: Parameters<Apply<EventEnvelope>>[2],
    at: EpochMs,
  ): Promise<string | undefined> {
    const member = str(event.payload, "member");
    if (member === undefined) return REMOVAL_MESSAGES.unreadable;
    if (member === env.creator) return REMOVAL_MESSAGES.creator_not_removable;
    const leaving = event.actor === member;
    if (!leaving && !(await isTreasurer(standing, view, event.actor, at))) {
      return (
        (await coTreasurerProblem(standing, view, event.actor, at)) ??
        REMOVAL_MESSAGES.not_permitted
      );
    }
    if ((await view.get(`members/${member}`)) === undefined) return REMOVAL_MESSAGES.not_a_member;
    const indexers = (await view.list(INDEXERS)).filter(
      (entry) => entry.key !== `${INDEXERS}${member}`,
    );
    if (indexers.length === 0) return REMOVAL_MESSAGES.last_indexer;
    await host.removeWriter(member as Did);
    await view.del(`members/${member}`);
    await view.del(`${INDEXERS}${member}`);
    await view.put(`removed/${member}`, { by: event.actor, at });
    return undefined;
  }

  /**
   * A pledge (story 4.3): the writer must be a member, and the pledge must pass `checkPledge` for that member. A
   * pledge is recorded once per event id, so a second arrival of the same event is refused as a duplicate.
   */
  async function pledgeCreated(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    if ((await view.get(`members/${event.actor}`)) === undefined) return PLEDGE_MESSAGES.not_member;
    const checked = checkPledge(event.payload, event.actor as Did);
    if (!checked.ok) return checked.problem;
    // A pledge waits for the treasurer's approval and stops at the deadline, judged at log time (story 8.2).
    const gate = orderGateProblem(
      storedOrderOf(await view.get(orderKey(checked.value.order))),
      "pledge",
      at,
    );
    if (gate !== undefined) return gate;
    if ((await view.get(pledgeEventKey(entry.id))) !== undefined) return PLEDGE_MESSAGES.duplicate;
    const stored = pledgeJson(entry.id, checked.value, event.claimedAt);
    await view.put(pledgeEventKey(entry.id), stored);
    await view.put(pledgeKey(checked.value.order, checked.value.member), stored);
    return undefined;
  }

  /**
   * The Node's request for a pledge (story 4.3). A current member may not write one (AGENTS rule 4: the phone never
   * creates a payment request). The request must name a recorded pledge and carry that pledge's amount.
   */
  /**
   * The Node's request for a pledge (story 4.3, written as `ledger.posted` is: the Node makes the event, the creator's
   * replica writes it). The actor is the record's creator, and `by` names the Node's did:key. A member's own event is
   * refused, so a phone cannot make a payment request. The pledge's member must still be a member, and the amount must
   * be the pledge's. One request per pledge.
   */
  async function paymentRequested(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
  ): Promise<string | undefined> {
    const event = entry.event;
    if (event.actor !== env.creator) return PAYMENT_TYPE_MESSAGE;
    const payload = event.payload;
    if (
      !Object.keys(payload).every((key) =>
        (PAYMENT_REQUEST_KEYS as readonly string[]).includes(key),
      )
    ) {
      return PLEDGE_MESSAGES.payment_fields;
    }
    const by = payload.by;
    if (typeof by !== "string" || !NODE_DID_KEY.test(by)) return PLEDGE_MESSAGES.payment_fields;
    if (payload.direction !== "in") return PLEDGE_MESSAGES.not_pay_in;
    const pledgeEvent = str(payload, "pledgeEvent");
    const pledge = pledgeEvent === undefined ? undefined : await pledgeByEvent(view, pledgeEvent);
    if (pledgeEvent === undefined || pledge === undefined) return PLEDGE_MESSAGES.unknown_pledge;
    // A member who has since been removed has no standing to pay (story 3.3).
    if ((await view.get(`members/${pledge.member}`)) === undefined)
      return PLEDGE_MESSAGES.pay_no_role;
    const amount = payload.amount;
    const minor =
      typeof amount === "object" && amount !== null && !Array.isArray(amount)
        ? (amount as { minor?: unknown }).minor
        : undefined;
    if (minor !== pledge.minor) return PLEDGE_MESSAGES.amount_must_match;
    // One request per pledge: the Node makes it once, keyed by the pledge's event id (AGENTS rule 5).
    if ((await view.get(paymentKey(pledgeEvent))) !== undefined) return PLEDGE_MESSAGES.duplicate;
    await view.put(paymentKey(pledgeEvent), { minor: pledge.minor });
    return undefined;
  }

  /**
   * A place (story 7.4): the treasurer's, shaped as the registry says (no coordinate, no address), and not registered
   * already. The record keeps its label, area and the commitment of its address.
   */
  async function placeRegisteredCheck(
    event: EventEnvelope,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const adder = await placeAdderProblem(standing, view, event.actor, at);
    if (adder !== undefined) return adder;
    if (PAYLOAD_VALIDATORS["place.registered"](event.payload).length > 0) {
      return DELIVERY_MESSAGES.place_unreadable;
    }
    const place = str(event.payload, "place") ?? "";
    if (await placeRegistered(view, place)) return DELIVERY_MESSAGES.place_exists;
    await view.put(
      placeKey(place),
      placeJson({
        label: str(event.payload, "label") ?? "",
        area: str(event.payload, "area") ?? "",
        addressCommitment: str(event.payload, "addressCommitment") ?? "",
      }),
    );
    return undefined;
  }

  /**
   * A member's area (story 7.3): the writer must be a member now (`members/<did>`, which a removal deletes), and the
   * name must be a suburb or town (the shape). The record keeps the name only.
   */
  async function memberAreaRecorded(
    event: EventEnvelope,
    view: ViewWriter,
  ): Promise<string | undefined> {
    if ((await view.get(`members/${event.actor}`)) === undefined) {
      return MEMBER_AREA_MESSAGES.not_a_member;
    }
    if (PAYLOAD_VALIDATORS["member.area"](event.payload).length > 0) {
      return MEMBER_AREA_MESSAGES.unreadable;
    }
    await view.put(memberAreaKey(event.actor), { area: str(event.payload, "area") ?? "" });
    return undefined;
  }

  /**
  /**
   * An arrival (story 7.4, proof in story 7.6): the assigned driver's, with the photo's SHA-512 and an optional coarse
   * place. The driver's role must stand at log time (a role that ended says the day it ended); the driver must be the one
   * the route names; the delivery is confirmed once. The record keeps it as `delivered/<order>`.
   */
  async function deliveryConfirmedCheck(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    if (!(await driverStands(standing, view, event.actor, at))) {
      return (
        (await roleProblemOf(standing, view, event.actor, "driver", at)) ??
        DELIVERY_MESSAGES.confirm_not_permitted
      );
    }
    if (PAYLOAD_VALIDATORS["delivery.confirmed"](event.payload).length > 0) {
      return DELIVERY_MESSAGES.confirm_unreadable;
    }
    const order = str(event.payload, "order") ?? "";
    const assigned = await plannedDriverOf(view, order);
    if (assigned === undefined) return PROOF_MESSAGES.no_delivery;
    if (assigned !== event.actor) return PROOF_MESSAGES.not_assigned;
    if ((await view.get(deliveredKey(order))) !== undefined)
      return PROOF_MESSAGES.already_delivered;
    const lat = event.payload.lat;
    const lng = event.payload.lng;
    const place = str(event.payload, "place");
    await view.put(deliveredKey(order), {
      event: entry.id,
      driver: event.actor,
      photoSha512: str(event.payload, "photoSha512") ?? "",
      claimedAt: event.claimedAt,
      ...(typeof lat === "string" && typeof lng === "string" ? { lat, lng } : {}),
      ...(place === undefined ? {} : { place }),
    });
    return undefined;
  }

  /**
   * A member's own share (story 7.6): the signer is a member, names themself, and has a share (a pledge) in the order.
   * The order's arrival must be recorded and the confirmation must name it. Once per member.
   */
  async function collectionConfirmedCheck(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
  ): Promise<string | undefined> {
    const event = entry.event;
    if ((await view.get(`members/${event.actor}`)) === undefined) {
      return PROOF_MESSAGES.collect_not_member;
    }
    if (PAYLOAD_VALIDATORS["collection.confirmed"](event.payload).length > 0) {
      return PROOF_MESSAGES.unreadable;
    }
    if (str(event.payload, "member") !== event.actor) return PROOF_MESSAGES.collect_not_member;
    const order = str(event.payload, "order") ?? "";
    const delivered = (await view.get(deliveredKey(order))) as JsonObject | undefined;
    if (delivered === undefined) return PROOF_MESSAGES.not_delivered;
    if (str(delivered, "event") !== str(event.payload, "delivery")) {
      return PROOF_MESSAGES.wrong_delivery;
    }
    if (!(await hasShareIn(view, order, event.actor))) return PROOF_MESSAGES.not_in_order;
    if ((await view.get(collectedKey(order, event.actor))) !== undefined) {
      return PROOF_MESSAGES.already_collected;
    }
    await view.put(collectedKey(order, event.actor), {
      event: entry.id,
      delivery: str(event.payload, "delivery") ?? "",
      claimedAt: event.claimedAt,
    });
    return undefined;
  }

  /**
   * A dispute (story 7.6): a member's, the treasurer included, about the order's arrival. It sits beside the confirmation,
   * which is not changed. The named delivery must be the order's.
   */
  async function deliveryDisputedCheck(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
  ): Promise<string | undefined> {
    const event = entry.event;
    if ((await view.get(`members/${event.actor}`)) === undefined) {
      return PROOF_MESSAGES.dispute_not_member;
    }
    if (PAYLOAD_VALIDATORS["delivery.disputed"](event.payload).length > 0) {
      return PROOF_MESSAGES.unreadable;
    }
    const order = str(event.payload, "order") ?? "";
    const delivered = (await view.get(deliveredKey(order))) as JsonObject | undefined;
    if (delivered === undefined) return PROOF_MESSAGES.not_delivered;
    if (str(delivered, "event") !== str(event.payload, "delivery")) {
      return PROOF_MESSAGES.wrong_delivery;
    }
    const note = str(event.payload, "note");
    await view.put(disputeKey(order, entry.id), {
      event: entry.id,
      by: event.actor,
      claimedAt: event.claimedAt,
      ...(note === undefined ? {} : { note }),
    });
    return undefined;
  }

  /**
   * A route (story 7.4): planned by the treasurer or a driver whose role stands at log time, between two different
   * registered places, for a driver who is a member. The route's summary is kept for the order; no line is.
   */
  async function deliveryPlannedCheck(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    const planner = await plannerProblem(standing, view, event.actor, at);
    if (planner !== undefined) return planner;
    const payload = event.payload;
    const origin = str(payload, "origin") ?? "";
    const destination = str(payload, "destination") ?? "";
    if (origin !== "" && origin === destination) return DELIVERY_MESSAGES.same_place;
    if (PAYLOAD_VALIDATORS["delivery.planned"](payload).length > 0) {
      return DELIVERY_MESSAGES.unreadable;
    }
    const driver = str(payload, "driver") ?? "";
    if (!(await placeRegistered(view, origin)) || !(await placeRegistered(view, destination))) {
      return DELIVERY_MESSAGES.unknown_place;
    }
    if ((await view.get(`members/${driver}`)) === undefined) return DELIVERY_MESSAGES.not_member;
    if (!(await driverStands(standing, view, driver, at))) return DELIVERY_MESSAGES.not_a_driver;
    const route = (payload.route ?? {}) as JsonObject;
    await view.put(deliveryKey(str(payload, "order") ?? ""), {
      event: entry.id,
      driver,
      origin,
      destination,
      costing: str(route, "costing") ?? "",
      distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : 0,
      durationSeconds: typeof route.durationSeconds === "number" ? route.durationSeconds : 0,
      tileRelease: str(route, "tileRelease") ?? "",
      fingerprint: str(route, "fingerprint") ?? "",
      plannedBy: event.actor,
    });
    return undefined;
  }

  /**
   * A supplier payment (story 4.7). Only the treasurer (the creator, or a co-treasurer standing at log time) may record one,
   * and only for a supplier with a quote on the order. The payment's record event id is its key.
   */
  async function payoutRecorded(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    if (!(await isTreasurer(standing, view, event.actor, at))) {
      return (
        (await coTreasurerProblem(standing, view, event.actor, at)) ?? PAYOUT_MESSAGES.not_permitted
      );
    }
    const terms = termsOf(event.payload);
    if (terms === undefined) return PAYOUT_MESSAGES.bad_payment;
    const recommendation = event.payload.recommendation;
    if (
      typeof recommendation !== "string" ||
      !PAYOUT_RECOMMENDATIONS.includes(recommendation as PayoutRecommendation)
    ) {
      return PAYOUT_MESSAGES.bad_payment;
    }
    if ((await view.get(quoteKey(terms.order, terms.supplier))) === undefined) {
      return PAYOUT_MESSAGES.no_quote;
    }
    await view.put(payoutKey(entry.id), { ...terms, recommendation, by: event.actor });
    return undefined;
  }

  /**
   * One approval of a supplier payment (story 4.7). The approver must stand at log time for the amount (the creator always
   * does), the approval must be signed for this community, this payment and these terms, and each person counts once.
   */
  async function approvalRecorded(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    const payment = event.payload.payout;
    const terms = termsOf(event.payload);
    const signature = event.payload.signature;
    if (typeof payment !== "string" || terms === undefined || typeof signature !== "string") {
      return PAYOUT_MESSAGES.bad_payment;
    }
    const recorded = (await view.get(payoutKey(payment))) as
      | { order?: unknown; supplier?: unknown; amountMinor?: unknown; bank?: unknown }
      | undefined;
    if (recorded === undefined) return PAYOUT_MESSAGES.unknown_payment;
    if (
      recorded.order !== terms.order ||
      recorded.supplier !== terms.supplier ||
      recorded.amountMinor !== terms.amountMinor ||
      recorded.bank !== terms.bank
    ) {
      return PAYOUT_MESSAGES.mismatch;
    }
    if ((await view.get(approvalKey(payment, event.actor))) !== undefined) {
      return PAYOUT_MESSAGES.already_approved;
    }
    const signed = await env.auth.verifySignature(
      event.actor as Did,
      approvalBytes(env.spaceKey, payment, event.actor, terms),
      signature as Signature,
    );
    if (!signed) return PAYOUT_MESSAGES.not_signed;
    const standingProblem = await approverStanding(
      { auth: env.auth, creator: env.creator, spaceKey: env.spaceKey, view },
      event.actor,
      terms.amountMinor,
      at,
    );
    if (standingProblem !== undefined) return standingProblem;
    await view.put(approvalKey(payment, event.actor), {
      eventId: entry.id,
      amountMinor: terms.amountMinor,
      at,
    });
    return undefined;
  }

  /**
   * The community's name and rules note (story 8.1). Only the treasurer may name it: the creator, or a co-treasurer whose
   * role stands at log time. The payload must be in the strict form. A later naming replaces the earlier one.
   */
  async function communityNamed(
    event: EventEnvelope,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    if (!(await isTreasurer(standing, view, event.actor, at))) {
      return (
        (await coTreasurerProblem(standing, view, event.actor, at)) ?? NAMING_MESSAGES.not_permitted
      );
    }
    if (PAYLOAD_VALIDATORS[NAMING_TYPE](event.payload).length > 0) {
      return NAMING_MESSAGES.unreadable;
    }
    await view.put("community/name", str(event.payload, "name") ?? "");
    await view.put("community/rules", str(event.payload, "rules") ?? "");
    return undefined;
  }

  /**
   * A small retailer's business profile (story 9.1): the writer must be a member now, the shape must hold, and the
   * signature must be the writer's over the shown fields and this community's key. A later profile replaces the earlier.
   */
  async function businessProfileRecorded(
    event: EventEnvelope,
    view: ViewWriter,
  ): Promise<string | undefined> {
    if ((await view.get(`members/${event.actor}`)) === undefined) {
      return PROFILE_MESSAGES.not_a_member;
    }
    if (PAYLOAD_VALIDATORS[PROFILE_TYPE](event.payload).length > 0) {
      return PROFILE_MESSAGES.unreadable;
    }
    const fields = profileFieldsOfPayload(event.payload);
    const signature = str(event.payload, "signature") ?? "";
    const signed = await env.auth.verifySignature(
      event.actor as Did,
      businessProfileBytes(env.spaceKey, fields),
      signature as Signature,
    );
    if (!signed) return PROFILE_MESSAGES.bad_signature;
    await view.put(profileKey(event.actor), { ...fields, signature });
    return undefined;
  }

  /** A quote is the treasurer's: the creator or a co-treasurer. Its shape is checked as in the form. */
  async function quoteAdded(
    event: EventEnvelope,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    if (!(await isTreasurer(standing, view, event.actor, at))) {
      return (
        (await coTreasurerProblem(standing, view, event.actor, at)) ?? QUOTE_MESSAGES.not_permitted
      );
    }
    const checked = checkQuote(event.payload);
    if (!checked.ok) return checked.problems.join(" ");
    // The second line for a quote: `checkQuote` gives the quote's own sentences, this catches anything else.
    if (checkPersonalFields(event.payload).length > 0) return PERSONAL_DATA_MESSAGE;
    // A quote waits for the treasurer's approval and stops at the deadline, judged at log time (story 8.2).
    const gate = orderGateProblem(
      storedOrderOf(await view.get(orderKey(checked.value.order))),
      "quote",
      at,
    );
    if (gate !== undefined) return gate;
    await view.put(quoteKey(checked.value.order, checked.value.supplier), quoteJson(checked.value));
    return undefined;
  }

  /**
   * A proposed order (story 8.2): from a member, in the strict form, with the rules judged at log time. One open order at
   * a time. The proposal's event id is its identity, and the order is kept under its tidied name (the key every view uses).
   */
  async function orderProposed(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    if ((await view.get(orderIdKey(entry.id))) !== undefined) return ORDER_MESSAGES.duplicate;
    if ((await view.get(`members/${event.actor}`)) === undefined) return ORDER_MESSAGES.not_member;
    const checked = checkOrder(event.payload, at);
    if (!checked.ok) return checked.problems.join(" ");
    // The second line for an order: `checkOrder` gives the order's own sentences, this catches anything else.
    if (checkPersonalFields(event.payload).length > 0) return PERSONAL_DATA_MESSAGE;
    const problem = proposalProblem(await ordersOf(view));
    if (problem !== undefined) return problem;
    const order = checked.value;
    await view.put(
      orderKey(order.name),
      orderJson({ ...order, id: entry.id, proposedBy: event.actor, status: "proposed" }),
    );
    await view.put(orderIdKey(entry.id), { name: order.name });
    return undefined;
  }

  /**
   * The treasurer's approval of a proposed order (story 8.2): the creator, or a co-treasurer whose role stands at log time.
   * It names the proposal by its event id. Approving an open order again is refused.
   */
  async function orderApproved(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    if (!(await isTreasurer(standing, view, event.actor, at))) {
      return (
        (await coTreasurerProblem(standing, view, event.actor, at)) ??
        ORDER_MESSAGES.approve_not_permitted
      );
    }
    const id = str(event.payload, "order") ?? "";
    const named = (await view.get(orderIdKey(id))) as { name?: unknown } | undefined;
    if (typeof named?.name !== "string") return ORDER_MESSAGES.unknown_order;
    const stored = storedOrderOf(await view.get(orderKey(named.name)));
    if (stored === undefined || stored.id !== id) return ORDER_MESSAGES.unknown_order;
    if (stored.status === "open") return ORDER_MESSAGES.already_approved;
    await view.put(orderKey(stored.name), orderJson({ ...stored, status: "open" }));
    return undefined;
  }

  /**
   * The treasurer's choice of a supplier (story 8.3): the creator, or a co-treasurer whose role stands at log time. The order
   * must be approved and on the record, and the supplier must have a complete quote for its wanted items. The total is
   * recomputed from that quote; a total claimed in the event is ignored when it differs. The latest accepted choice stands.
   */
  async function supplierSelected(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    if (!(await isTreasurer(standing, view, event.actor, at))) {
      return (
        (await coTreasurerProblem(standing, view, event.actor, at)) ??
        SELECTION_MESSAGES.not_permitted
      );
    }
    if (PAYLOAD_VALIDATORS["quote.selected"](event.payload).length > 0) {
      return SELECTION_MESSAGES.unreadable;
    }
    const order = storedOrderOf(await view.get(orderKey(str(event.payload, "order") ?? "")));
    if (order === undefined) return ORDER_MESSAGES.unknown_order;
    if (order.status !== "open") return SELECTION_MESSAGES.not_approved;
    const supplier = str(event.payload, "supplier") ?? "";
    const priced = supplierTotalOf(await quotesOf(view, order.name), order.items, supplier);
    if (!priced.ok) return priced.problem;
    await view.put(
      selectionKey(order.name),
      selectionJson({
        order: order.name,
        supplier: tidy(supplier),
        totalMinor: priced.totalMinor,
        by: event.actor,
        eventId: entry.id,
      }),
    );
    return undefined;
  }

  /**
   * A file is named by its event only when the event is in the strict form, its sender may attach that purpose at log
   * time, and the file is recorded under its order (story 3.7). The bytes are the Node's; the record holds the reference.
   */
  async function fileAttached(
    event: EventEnvelope,
    view: ViewWriter,
    at: EpochMs,
  ): Promise<string | undefined> {
    const shape = fileShapeProblem(event.payload);
    if (shape !== undefined) return shape;
    const payload = event.payload as unknown as FileAttachedPayload;
    const refused = await fileUploadProblem(standing, view, event.actor, payload.purpose, at);
    if (refused !== undefined) return refused;
    await view.put(fileOfOrderKey(payload.order, payload.hash), {
      ...(event.payload as JsonObject),
      by: event.actor,
    });
    return undefined;
  }

  return async (entries, view, host) => {
    for (const entry of entries) {
      const event = entry.event;
      // Before anything else (review items 3 and 4): a claimed time that is not a safe, non-negative whole number
      // of milliseconds, or a payload that is not an object, is refused, so nothing below sees a value it cannot
      // judge. `apply` never throws on a stored event.
      if (!isValidClaim(event.claimedAt) || !isPlainObject(event.payload)) {
        const reason = isValidClaim(event.claimedAt) ? EVENT_UNREADABLE : CLAIM_MESSAGE;
        await view.put(`rejected/${entry.id}`, {
          type: typeof event.type === "string" ? event.type : "unknown",
          reason,
        });
        continue;
      }
      // Personal values first, before any effect (AGENTS rule 6, shortcut S-2.7-3). A quote is the exception:
      // `quoteAdded` gives the quote's own sentences first and then this same guard (review H2), and it still
      // writes nothing before that.
      if (
        event.type !== "quote.added" &&
        event.type !== "order.proposed" &&
        checkPersonalFields(event.payload).length > 0
      ) {
        await view.put(`rejected/${entry.id}`, { type: event.type, reason: PERSONAL_DATA_MESSAGE });
        continue;
      }
      if (!CHECKED.has(event.type)) continue;
      // Log time, then the checks: judged at log time before this event. The event's own claim moves log
      // time only once its checks pass, and by at most the cap (log-time.ts, the clamp).
      const logTime = await logTimeOf(view);
      const at = logTime ?? 0;
      const next = advanceLogTime(logTime, event.claimedAt);
      const reason =
        entry.writer !== event.actor
          ? NOT_THE_WRITER
          : event.space !== env.spaceKey
            ? INVITATION_MESSAGES.unreadable
            : await checkEvent(entry, view, host, at, next);
      if (reason !== undefined) {
        await view.put(`rejected/${entry.id}`, { type: event.type, reason });
      } else {
        await view.put(LOG_TIME_KEY, next);
      }
    }
  };

  async function checkEvent(
    entry: RecordEntry<EventEnvelope>,
    view: ViewWriter,
    host: Parameters<Apply<EventEnvelope>>[2],
    at: EpochMs,
    next: EpochMs,
  ): Promise<string | undefined> {
    const event = entry.event;
    switch (event.type) {
      case "member.invited":
        return invited(event, view, host, at);
      case "member.joined":
        return joined(entry, view, at, next);
      case "member.removed":
        return removed(event, view, host, at);
      case "role.granted":
        return recordRoleGrant(env, view, event, at);
      case "role.revoked":
        return recordRoleRevocation(env, view, event);
      case "pledge.created":
        return pledgeCreated(entry, view, at);
      case "order.proposed":
        return orderProposed(entry, view, at);
      case "order.approved":
        return orderApproved(entry, view, at);
      case "quote.selected":
        return supplierSelected(entry, view, at);
      case "payment.requested":
        return paymentRequested(entry, view);
      case "file.attached":
        return fileAttached(event, view, at);
      case "place.registered":
        return placeRegisteredCheck(event, view, at);
      case "delivery.planned":
        return deliveryPlannedCheck(entry, view, at);
      case "delivery.confirmed":
        return deliveryConfirmedCheck(entry, view, at);
      case "member.area":
        return memberAreaRecorded(event, view);
      case "collection.confirmed":
        return collectionConfirmedCheck(entry, view);
      case "delivery.disputed":
        return deliveryDisputedCheck(entry, view);
      case PAYOUT_TYPE:
        return payoutRecorded(entry, view, at);
      case APPROVAL_TYPE:
        return approvalRecorded(entry, view, at);
      case NAMING_TYPE:
        return communityNamed(event, view, at);
      case PROFILE_TYPE:
        return businessProfileRecorded(event, view);
      default:
        return quoteAdded(event, view, at);
    }
  }
}
