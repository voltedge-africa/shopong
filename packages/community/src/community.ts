// A community on a shared record, from one person's phone: create it, invite a person, join with an
// invitation, list the members. The record is any `SharedRecord`; the app uses the in-memory one.

import {
  PERSONAL_DATA_MESSAGE,
  PersonalDataError,
  assertNoPersonalData,
  coarseArea,
  createEvent,
  encodeUtf8,
  eventIdOf,
  sha512Hex,
  type EventEnvelope,
  type EventId,
  type DeliveryPlannedPayload,
  type EventType,
  type JsonObject,
  type Sha512,
} from "@shopong/events";
import {
  err,
  ok,
  type AppendReceipt,
  type CapabilityAuth,
  type Did,
  type EpochMs,
  type CapabilityToken,
  type JsonValue,
  type Money,
  type PortError,
  type Result,
  type SharedRecord,
  type Space,
  type SpaceDefinition,
} from "@shopong/ports";
import { createCommunityApply, FOUNDER_INVITATION } from "./apply.js";
import {
  deliveriesOf,
  driverStands,
  placeAdderProblem,
  placeJson,
  plannerProblem,
  type PlannedDelivery,
} from "./delivery.js";
import { CLOSE_MESSAGES, closeBlocker, closingSummary, type ClosingSummary } from "./closing.js";
import { PROOF_MESSAGES, progressOf, type OrderProgress } from "./delivery-proof.js";
import { logTimeOf } from "./log-time.js";
import type { PoolView } from "./pool.js";
import {
  QUOTE_MESSAGES,
  checkQuote,
  isTreasurer,
  quoteJson,
  quotesOf,
  type Quote,
} from "./quotes.js";
import {
  checkAction,
  coTreasurerJoinGrant,
  coTreasurerProblem,
  type StandingContext,
  issueRole,
  rolesOf,
  type ActionRequest,
  type RoleCheck,
  type RoleDraft,
  type HeldRole,
  type RoleError,
  type RoleRecord,
  holdersOf,
} from "./roles.js";
import {
  INVITATION_MESSAGES,
  issueInvitation,
  type CheckedInvitation,
  type Invitation,
  type InvitationError,
} from "./invitation.js";
import { encodeProof } from "./proof.js";
import { EMPTY_NAME_MESSAGE, NAMING_TYPE, namingProblem } from "./naming.js";
import {
  ORDER_MESSAGES,
  checkOrder,
  orderKey,
  orderPayloadOf,
  ordersOf,
  proposalProblem,
  storedOrderOf,
  type StoredOrder,
} from "./orders.js";
import {
  SELECTION_MESSAGES,
  selectionOf,
  selectionPayloadOf,
  supplierTotalOf,
  type Selection,
} from "./selection.js";
import { newCommunityKey, toHex } from "./space.js";

export interface CommunityDeps {
  readonly auth: CapabilityAuth;
  readonly sha512: Sha512;
  readonly randomBytes: (length: number) => Uint8Array;
}

/**
 * The event id the record uses. An event that cannot be canonicalised (a NaN or infinite number, a value JSON
 * cannot hold) gets the id of its JSON form, which is what the record holds once the event has travelled. So
 * the record never throws, and `apply` refuses the event for its time (review items 3 and 4). A last resort
 * is one fixed id, used only when even the JSON form cannot be hashed.
 */
export async function eventIdFor(event: EventEnvelope, sha512: Sha512): Promise<EventId> {
  try {
    return await eventIdOf(event, sha512);
  } catch {
    try {
      return await eventIdOf(JSON.parse(JSON.stringify(event)) as unknown, sha512);
    } catch {
      return (await sha512Hex(encodeUtf8("ocn:unhashable-event"), sha512)) as EventId;
    }
  }
}

/** The definition (apply + event id) every phone of one community uses. */
export function communityDefinition(
  deps: Pick<CommunityDeps, "auth" | "sha512">,
  creator: Did,
  spaceKey: string,
): SpaceDefinition<EventEnvelope> {
  return {
    apply: createCommunityApply({ auth: deps.auth, creator, spaceKey }),
    eventId: (event) => eventIdFor(event, deps.sha512),
  };
}

export interface Member {
  readonly did: Did;
  readonly joinedAt: EpochMs;
}

export type CommunityError = PortError<"empty_name" | "refused" | "not_creator">;

export interface GrantOptions {
  /** The rand limit. Required for the co-treasurer role, refused for the others. */
  readonly limit?: Money;
  /** 7, 30 or 90 days. Default 30. */
  readonly days?: number;
}

export { EMPTY_NAME_MESSAGE };

/** `not_permitted`: not the treasurer. `incomplete`: nothing is recorded; the reasons are in the message. */
export type QuoteError = PortError<"not_permitted" | "incomplete" | "refused">;

/** A place the Node made (story 7.4): its opaque id, label, coarse area and the commitment of its exact address. */
export interface PlaceRecord {
  readonly id: string;
  readonly label: string;
  readonly area: string;
  readonly addressCommitment: string;
}

/** The route an order is planned on, as the record names it: place ids and the fingerprint, never a coordinate. */
export type DeliveryPlan = DeliveryPlannedPayload;

export type PlanError = PortError<"not_permitted" | "refused">;

/**
 * The arrival a driver confirms (story 7.6): the order, the SHA-512 of the photo the Node holds, and optionally a coarse
 * place (`lat` and `lng`: decimal strings of two decimal places at most, rounded on the phone) or an opaque place id.
 */
export interface DeliveryConfirmation {
  readonly order: string;
  readonly photoSha512: string;
  readonly lat?: string;
  readonly lng?: string;
  readonly place?: string;
}

/** A member's own share (story 7.6): the order and the event id of the delivery confirmation it collects from. */
export interface CollectionConfirmation {
  readonly order: string;
  readonly delivery: string;
}

/** A dispute (story 7.6): the order, the event id of the confirmation disputed, and the person's short note. */
export interface DeliveryDispute {
  readonly order: string;
  readonly delivery: string;
  readonly note?: string;
}

export type ProofError = PortError<"refused">;

export type OrderError = PortError<"not_permitted" | "incomplete" | "refused">;

export interface OrderReceipt {
  /** The event id of the `order.proposed` or `order.approved` entry. */
  readonly id: string;
  /** True when this exact event was already in the log. */
  readonly duplicate: boolean;
}

export interface QuoteReceipt {
  /** The event id of the `quote.added` entry. */
  readonly id: string;
  /** True when this exact event was already in the log: nothing new was written, so one quote stands. */
  readonly duplicate: boolean;
}

/** Log time as the phone's copy of the view holds it. Authority is checked at this time, as `apply` checks it. */
async function logAt(space: Space<EventEnvelope>): Promise<EpochMs> {
  return (await logTimeOf(space.view)) ?? 0;
}

function field(value: JsonValue, key: string): JsonValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })[key]
    : undefined;
}

/**
 * The one way this service appends an event. A payload with a raw phone or ID number is refused before
 * `space.append`, so the log never holds it (AGENTS rule 6). `apply` checks again as the second line.
 */
export async function appendChecked(
  space: Space<EventEnvelope>,
  event: EventEnvelope,
): Promise<Result<AppendReceipt, PortError<"personal_data" | "not_writable" | "closed">>> {
  try {
    assertNoPersonalData(event.payload);
  } catch (error) {
    if (error instanceof PersonalDataError) return err("personal_data", PERSONAL_DATA_MESSAGE);
    throw error;
  }
  const receipt = await space.append(event);
  if (!receipt.ok) return err(receipt.error.code, receipt.error.message);
  return ok(receipt.value);
}

async function append(
  deps: CommunityDeps,
  space: Space<EventEnvelope>,
  spaceKey: string,
  type: EventType,
  payload: JsonObject,
  proof: readonly string[],
  at: EpochMs,
): Promise<Result<EventEnvelope, PortError<"refused">>> {
  const event = createEvent({
    type,
    space: spaceKey,
    actor: space.local,
    proof,
    claimedAt: at,
    nonce: toHex(deps.randomBytes(16)),
    payload,
  } as never) as EventEnvelope;
  const receipt = await appendChecked(space, event);
  if (!receipt.ok) return err("refused", receipt.error.message);
  await space.update();
  const rejected = await space.view.get(`rejected/${receipt.value.id}`);
  if (rejected !== undefined) {
    const reason = field(rejected, "reason");
    return err("refused", typeof reason === "string" ? reason : INVITATION_MESSAGES.unreadable);
  }
  return ok(event);
}

/**
 * Appends a proof event (story 7.6). A payload the envelope cannot take is refused with the plain sentence, not thrown, so
 * the screen always has something to show. `apply` judges the rest.
 */
async function appendProof(
  deps: CommunityDeps,
  space: Space<EventEnvelope>,
  spaceKey: string,
  type: EventType,
  payload: object,
  at: EpochMs,
): Promise<Result<EventEnvelope, ProofError>> {
  try {
    // Undefined fields (an optional place, say) are left out, so the payload is plain JSON.
    const plain = JSON.parse(JSON.stringify(payload)) as JsonObject;
    return await append(deps, space, spaceKey, type, plain, [], at);
  } catch {
    return err("refused", PROOF_MESSAGES.unreadable);
  }
}

export interface Community {
  /** The 64-hex community key (the envelope `space`). */
  readonly key: string;
  readonly name: string;
  readonly creator: Did;
  /** The person this phone belongs to. */
  readonly me: Did;
  readonly space: Space<EventEnvelope>;
  /**
   * Invite a person by their full DID. The creator can; so can a co-treasurer, whose invitation is
   * passed on from their own role (story 2.4).
   */
  invite(
    invitee: string,
    now: EpochMs,
  ): Promise<Result<Invitation, InvitationError | CommunityError>>;
  members(): Promise<readonly Member[]>;
  /** Give `grantee` a role until it ends. The creator can; a holder can pass on part of their own role. */
  grantRole(
    grantee: string,
    role: string,
    options: GrantOptions,
    now: EpochMs,
  ): Promise<Result<RoleDraft, RoleError | CommunityError>>;
  /** The roles recorded for me, ended ones included. */
  roles(): Promise<readonly RoleRecord[]>;
  /** Every role recorded in this community, with its holder, ended ones included (story 8.1). */
  roleHolders(): Promise<readonly HeldRole[]>;
  /** "What can I do?": may I do this? Judged at log time, as `apply` judges it (story 3.6). */
  checkAction(request: ActionRequest): Promise<Result<RoleCheck, RoleError>>;
  /**
   * Record a typed quote (story 6.8). Only the treasurer may; an incomplete quote is refused with the
   * reasons and nothing is written. A quote for the same supplier and order replaces the older one.
   */
  addQuote(input: unknown, now: EpochMs): Promise<Result<QuoteReceipt, QuoteError>>;
  /** The quotes recorded for one order, as the view holds them now. */
  quotesFor(order: string): Promise<readonly Quote[]>;
  /**
   * Propose a bulk order (story 8.2): any member may. Its name, items, budget per member and deadline are checked first;
   * a refusal is a plain sentence and nothing is written. The proposal's event id is the order's identity.
   */
  proposeOrder(input: unknown, now: EpochMs): Promise<Result<OrderReceipt, OrderError>>;
  /** Approve a proposed order by its event id (story 8.2). Only the treasurer may; this opens quotes and pledges. */
  approveOrder(id: string, now: EpochMs): Promise<Result<OrderReceipt, OrderError>>;
  /** Every order on the record, as this phone's copy of the view holds it. */
  orders(): Promise<readonly StoredOrder[]>;
  /**
   * Choose a supplier for an approved order (story 8.3). Only the treasurer may. The total is the one the ranking shows for
   * that supplier's complete quote; `apply` recomputes it and keeps the latest choice.
   */
  chooseSupplier(
    order: string,
    supplier: string,
    now: EpochMs,
  ): Promise<Result<QuoteReceipt, QuoteError>>;
  /** The latest choice of a supplier for an order, as the view holds it now. */
  selectionOf(order: string): Promise<Selection | undefined>;
  /** The driver whose role stands at log time, judged as `apply` judges a driver (patch of story 7.4). */
  currentDriver(now: EpochMs): Promise<string | undefined>;
  /** Every driver whose role stands at log time: the ones the treasurer may name for a delivery (story 8.6). */
  drivers(now: EpochMs): Promise<readonly string[]>;
  /** The planned deliveries on the record, one per order, as this phone's copy of the view holds them (story 8.6). */
  deliveries(): Promise<readonly PlannedDelivery[]>;
  /** Record a place the Node made (story 7.4). Only the treasurer may. */
  registerPlace(place: PlaceRecord, now: EpochMs): Promise<Result<EventEnvelope, PlanError>>;
  /**
   * Record my suburb or town (story 7.3). The name is coarsened here as the phone does (`coarseArea`); a street, a
   * number or an erf is refused with the plain sentence and nothing is written.
   */
  setMemberArea(area: string, now: EpochMs): Promise<Result<EventEnvelope, PlanError>>;
  /**
   * Record an order's route between two registered places (story 7.4). The treasurer, or a driver whose role stands
   * at log time, may plan it. Refused with the plain reason otherwise.
   */
  planDelivery(plan: DeliveryPlan, now: EpochMs): Promise<Result<EventEnvelope, PlanError>>;
  /** The assigned driver confirms the arrival at an order (story 7.6). Refused with the plain reason otherwise. */
  confirmDelivery(
    input: DeliveryConfirmation,
    now: EpochMs,
  ): Promise<Result<EventEnvelope, ProofError>>;
  /** A member confirms their own share of a delivery (story 7.6). The treasurer cannot do it for a member. */
  confirmCollection(
    input: CollectionConfirmation,
    now: EpochMs,
  ): Promise<Result<EventEnvelope, ProofError>>;
  /** A member, or the treasurer, disputes a delivery. The confirmation stays; the dispute is a later event (story 7.6). */
  disputeDelivery(input: DeliveryDispute, now: EpochMs): Promise<Result<EventEnvelope, ProofError>>;
  /** An order's proof as the view holds it now: arrived, collected of members, disputes (story 7.6). */
  orderProgress(order: string): Promise<OrderProgress>;
  /**
   * The treasurer closes an order (story 8.7). Refused with the plain reason unless every member with a share has collected.
   * No money moves.
   */
  closeOrder(order: string, now: EpochMs): Promise<Result<EventEnvelope, ProofError>>;
  /** Why this person cannot close the order right now, or undefined when they can (the same checks `apply` makes). */
  closeProblem(order: string): Promise<string | undefined>;
  /** The closing summary read from the record, with the pool view when the Node gave one (story 8.7). */
  closingOf(order: string, pool?: PoolView): Promise<ClosingSummary>;
}

function wrap(
  deps: CommunityDeps,
  me: Did,
  key: string,
  name: string,
  creator: Did,
  space: Space<EventEnvelope>,
): Community {
  const standingOf = (): StandingContext => ({ auth: deps.auth, creator, spaceKey: key });
  return {
    key,
    name,
    creator,
    me,
    space,
    async invite(invitee, now) {
      let via: { issuer: Did; token: CapabilityToken } | undefined;
      if (me !== creator) {
        await space.update();
        const at = await logAt(space);
        const grant = await coTreasurerJoinGrant(space.view, me, at);
        const problem = await coTreasurerProblem(standingOf(), space.view, me, at);
        if (grant === undefined || problem !== undefined) {
          return err("not_creator", problem ?? "Only the creator can invite.");
        }
        via = { issuer: me, token: grant.token };
      }
      const issued = await issueInvitation({
        auth: deps.auth,
        creator,
        spaceKey: key,
        invitee,
        now,
        ...(via === undefined ? {} : { via }),
      });
      if (!issued.ok) return issued;
      const recorded = await append(
        deps,
        space,
        key,
        "member.invited",
        {
          invitation: issued.value.id,
          invitee: issued.value.invitee,
          expiresAt: issued.value.expiresAt,
        },
        [],
        now,
      );
      return recorded.ok ? issued : recorded;
    },
    async grantRole(grantee, role, options, now) {
      await space.update();
      const drafted = await issueRole({
        auth: deps.auth,
        view: space.view,
        creator,
        spaceKey: key,
        grantor: me,
        grantee,
        role,
        now,
        logTime: await logAt(space),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.days === undefined ? {} : { days: options.days }),
      });
      if (!drafted.ok) return drafted;
      const recorded = await append(
        deps,
        space,
        key,
        "role.granted",
        {
          role: drafted.value.role,
          grantee: drafted.value.grantee,
          expiresAt: drafted.value.expiresAt,
        },
        drafted.value.tokens.map((token) => encodeProof(token)),
        now,
      );
      return recorded.ok ? drafted : recorded;
    },
    async roles() {
      await space.update();
      return rolesOf(space.view, me);
    },
    async roleHolders() {
      await space.update();
      return holdersOf(await space.view.list("roles/"));
    },
    async checkAction(request) {
      await space.update();
      return checkAction(
        { auth: deps.auth, view: space.view, creator, spaceKey: key },
        me,
        request,
        await logAt(space),
      );
    },
    async currentDriver(now) {
      await space.update();
      const at = (await logAt(space)) || now;
      for (const row of await space.view.list("roles/")) {
        if (!row.key.endsWith("/driver")) continue;
        const who = row.key.slice("roles/".length, -"/driver".length);
        if (await driverStands(standingOf(), space.view, who, at)) return who;
      }
      return undefined;
    },
    async drivers(now) {
      await space.update();
      const at = (await logAt(space)) || now;
      const out: string[] = [];
      for (const row of await space.view.list("roles/")) {
        if (!row.key.endsWith("/driver")) continue;
        const who = row.key.slice("roles/".length, -"/driver".length);
        if (await driverStands(standingOf(), space.view, who, at)) out.push(who);
      }
      return out;
    },
    async deliveries() {
      await space.update();
      return deliveriesOf(await space.view.list("delivery/"));
    },
    async registerPlace(place, now) {
      await space.update();
      const at = await logAt(space);
      const problem = await placeAdderProblem(standingOf(), space.view, me, at);
      if (problem !== undefined) return err("not_permitted", problem);
      const payload = {
        place: place.id,
        ...placeJson({
          label: place.label,
          area: place.area,
          addressCommitment: place.addressCommitment,
        }),
      };
      return append(deps, space, key, "place.registered", payload, [], now);
    },
    async setMemberArea(area, now) {
      const coarse = coarseArea(area);
      if (!coarse.ok) return err("refused", coarse.reason);
      await space.update();
      return append(deps, space, key, "member.area", { area: coarse.area }, [], now);
    },
    async planDelivery(plan, now) {
      await space.update();
      const at = await logAt(space);
      const problem = await plannerProblem(standingOf(), space.view, me, at);
      if (problem !== undefined) return err("not_permitted", problem);
      return append(deps, space, key, "delivery.planned", plan as unknown as JsonObject, [], now);
    },
    async confirmDelivery(input, now) {
      return appendProof(deps, space, key, "delivery.confirmed", input, now);
    },
    async confirmCollection(input, now) {
      return appendProof(
        deps,
        space,
        key,
        "collection.confirmed",
        { order: input.order, delivery: input.delivery, member: me },
        now,
      );
    },
    async disputeDelivery(input, now) {
      return appendProof(deps, space, key, "delivery.disputed", input, now);
    },
    async orderProgress(order) {
      await space.update();
      return progressOf(space.view, order);
    },
    async closeOrder(order, now) {
      return appendProof(deps, space, key, "order.closed", { order }, now);
    },
    async closeProblem(order) {
      await space.update();
      const at = await logAt(space);
      if (!(await isTreasurer(standingOf(), space.view, me, at))) {
        return (
          (await coTreasurerProblem(standingOf(), space.view, me, at)) ??
          CLOSE_MESSAGES.not_permitted
        );
      }
      return closeBlocker(space.view, order);
    },
    async closingOf(order, pool) {
      await space.update();
      return closingSummary(space.view, order, me, pool);
    },
    async addQuote(input, now) {
      await space.update();
      const at = await logAt(space);
      if (!(await isTreasurer(standingOf(), space.view, me, at))) {
        const problem = await coTreasurerProblem(standingOf(), space.view, me, at);
        return err("not_permitted", problem ?? QUOTE_MESSAGES.not_permitted);
      }
      const checked = checkQuote(input);
      if (!checked.ok) return err("incomplete", checked.problems.join(" "));
      // Every refusal here is a plain sentence: a raw port or envelope message can name a DID or a path.
      let event: EventEnvelope;
      try {
        event = createEvent({
          type: "quote.added",
          space: key,
          actor: space.local,
          proof: [],
          claimedAt: now,
          nonce: toHex(deps.randomBytes(16)),
          payload: quoteJson(checked.value),
        } as never) as EventEnvelope;
      } catch {
        return err("refused", QUOTE_MESSAGES.save_failed);
      }
      const receipt = await appendChecked(space, event);
      if (!receipt.ok) {
        return err(
          "refused",
          receipt.error.code === "personal_data"
            ? receipt.error.message
            : QUOTE_MESSAGES.not_writable,
        );
      }
      await space.update();
      const rejected = await space.view.get(`rejected/${receipt.value.id}`);
      if (rejected !== undefined) {
        const reason = field(rejected, "reason");
        return err("refused", typeof reason === "string" ? reason : INVITATION_MESSAGES.unreadable);
      }
      return ok({ id: receipt.value.id, duplicate: receipt.value.duplicate });
    },
    async quotesFor(order) {
      await space.update();
      return quotesOf(space.view, order);
    },
    async proposeOrder(input, now) {
      await space.update();
      const at = await logAt(space);
      if ((await space.view.get(`members/${me}`)) === undefined) {
        return err("not_permitted", ORDER_MESSAGES.not_member);
      }
      const checked = checkOrder(input, at);
      if (!checked.ok) return err("incomplete", checked.problems.join(" "));
      const problem = proposalProblem(await ordersOf(space.view));
      if (problem !== undefined) return err("refused", problem);
      let event: EventEnvelope;
      try {
        event = createEvent({
          type: "order.proposed",
          space: key,
          actor: space.local,
          proof: [],
          claimedAt: now,
          nonce: toHex(deps.randomBytes(16)),
          payload: orderPayloadOf(checked.value),
        } as never) as EventEnvelope;
      } catch {
        return err("refused", ORDER_MESSAGES.save_failed);
      }
      const receipt = await appendChecked(space, event);
      if (!receipt.ok) {
        return err(
          "refused",
          receipt.error.code === "personal_data"
            ? receipt.error.message
            : ORDER_MESSAGES.not_writable,
        );
      }
      await space.update();
      const rejected = await space.view.get(`rejected/${receipt.value.id}`);
      if (rejected !== undefined) {
        const reason = field(rejected, "reason");
        return err("refused", typeof reason === "string" ? reason : ORDER_MESSAGES.unreadable);
      }
      return ok({ id: receipt.value.id, duplicate: receipt.value.duplicate });
    },
    async approveOrder(id, now) {
      await space.update();
      const at = await logAt(space);
      if (!(await isTreasurer(standingOf(), space.view, me, at))) {
        const problem = await coTreasurerProblem(standingOf(), space.view, me, at);
        return err("not_permitted", problem ?? ORDER_MESSAGES.approve_not_permitted);
      }
      if (!/^[0-9a-f]{128}$/.test(id)) return err("refused", ORDER_MESSAGES.unknown_order);
      let event: EventEnvelope;
      try {
        event = createEvent({
          type: "order.approved",
          space: key,
          actor: space.local,
          proof: [],
          claimedAt: now,
          nonce: toHex(deps.randomBytes(16)),
          payload: { order: id },
        } as never) as EventEnvelope;
      } catch {
        return err("refused", ORDER_MESSAGES.save_failed);
      }
      const receipt = await appendChecked(space, event);
      if (!receipt.ok) return err("refused", ORDER_MESSAGES.not_writable);
      await space.update();
      const rejected = await space.view.get(`rejected/${receipt.value.id}`);
      if (rejected !== undefined) {
        const reason = field(rejected, "reason");
        return err("refused", typeof reason === "string" ? reason : ORDER_MESSAGES.unreadable);
      }
      return ok({ id: receipt.value.id, duplicate: receipt.value.duplicate });
    },
    async orders() {
      await space.update();
      return ordersOf(space.view);
    },
    async chooseSupplier(order, supplier, now) {
      await space.update();
      const at = await logAt(space);
      if (!(await isTreasurer(standingOf(), space.view, me, at))) {
        const problem = await coTreasurerProblem(standingOf(), space.view, me, at);
        return err("not_permitted", problem ?? SELECTION_MESSAGES.not_permitted);
      }
      const stored = storedOrderOf(await space.view.get(orderKey(order)));
      if (stored === undefined) return err("refused", ORDER_MESSAGES.unknown_order);
      if (stored.status !== "open") return err("refused", SELECTION_MESSAGES.not_approved);
      const priced = supplierTotalOf(
        await quotesOf(space.view, stored.name),
        stored.items,
        supplier,
      );
      if (!priced.ok) return err("refused", priced.problem);
      let event: EventEnvelope;
      try {
        event = createEvent({
          type: "quote.selected",
          space: key,
          actor: space.local,
          proof: [],
          claimedAt: now,
          nonce: toHex(deps.randomBytes(16)),
          payload: selectionPayloadOf({
            order: stored.name,
            supplier,
            totalMinor: priced.totalMinor,
          }),
        } as never) as EventEnvelope;
      } catch {
        return err("refused", SELECTION_MESSAGES.save_failed);
      }
      const receipt = await appendChecked(space, event);
      if (!receipt.ok) {
        return err(
          "refused",
          receipt.error.code === "personal_data"
            ? receipt.error.message
            : SELECTION_MESSAGES.not_writable,
        );
      }
      await space.update();
      const rejected = await space.view.get(`rejected/${receipt.value.id}`);
      if (rejected !== undefined) {
        const reason = field(rejected, "reason");
        return err("refused", typeof reason === "string" ? reason : SELECTION_MESSAGES.unreadable);
      }
      return ok({ id: receipt.value.id, duplicate: receipt.value.duplicate });
    },
    async selectionOf(order) {
      await space.update();
      return selectionOf(space.view, order);
    },
    async members() {
      await space.update();
      const out: Member[] = [];
      for (const entry of await space.view.list("members/")) {
        const joinedAt = field(entry.value, "joinedAt");
        out.push({
          did: entry.key.slice("members/".length) as Did,
          joinedAt: typeof joinedAt === "number" ? joinedAt : 0,
        });
      }
      return out;
    },
  };
}

/**
 * Make a community with me as its creator and only member. `key` is the community key; pass one when the Node
 * must hold the same key (story 3.4), otherwise a new random key is made. The name and the rules note are written
 * as one `community.named` event straight after the founding, so every member sees them (story 8.1).
 */
export async function createCommunity(
  deps: CommunityDeps,
  record: SharedRecord<EventEnvelope>,
  name: string,
  now: EpochMs,
  key: string = newCommunityKey(deps.randomBytes),
  /** How many people must approve a supplier payment (story 4.7): 1 to 5. Absent, the founding event says nothing and two apply. */
  approvals?: number,
  /** A short rules note, plain text, up to 500 characters. Empty when left out. */
  rules: string = "",
): Promise<Result<Community, CommunityError>> {
  const trimmed = name.trim();
  const trimmedRules = rules.trim();
  const problem = namingProblem(trimmed, trimmedRules);
  if (problem !== undefined) {
    return err(problem === EMPTY_NAME_MESSAGE ? "empty_name" : "refused", problem);
  }
  const creator = record.local;
  const space = await record.create(communityDefinition(deps, creator, key));
  const founded = await append(
    deps,
    space,
    key,
    "member.joined",
    approvals === undefined
      ? { invitation: FOUNDER_INVITATION }
      : { invitation: FOUNDER_INVITATION, approvals },
    [],
    now,
  );
  if (!founded.ok) return founded;
  const named = await append(
    deps,
    space,
    key,
    NAMING_TYPE,
    { name: trimmed, rules: trimmedRules },
    [],
    now,
  );
  if (!named.ok) return named;
  return ok(wrap(deps, creator, key, trimmed, creator, space));
}

/** Join a community with an invitation this phone already checked. The record must already hold the space. */
export async function joinCommunity(
  deps: CommunityDeps,
  space: Space<EventEnvelope>,
  checked: CheckedInvitation,
  now: EpochMs,
): Promise<Result<Community, PortError<"refused">>> {
  const joined = await append(
    deps,
    space,
    checked.spaceKey,
    "member.joined",
    { invitation: checked.id },
    [encodeProof(checked.token)],
    now,
  );
  if (!joined.ok) return joined;
  return ok(wrap(deps, space.local, checked.spaceKey, "", checked.creator, space));
}
