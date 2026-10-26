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
import { driverStands, placeAdderProblem, placeJson, plannerProblem } from "./delivery.js";
import { logTimeOf } from "./log-time.js";
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
  type RoleError,
  type RoleRecord,
} from "./roles.js";
import {
  INVITATION_MESSAGES,
  issueInvitation,
  type CheckedInvitation,
  type Invitation,
  type InvitationError,
} from "./invitation.js";
import { encodeProof } from "./proof.js";
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

export const EMPTY_NAME_MESSAGE = "Give your community a name.";

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
  /** "What can I do?": may I do this? Judged at log time, as `apply` judges it (story 3.6). */
  checkAction(request: ActionRequest): Promise<Result<RoleCheck, RoleError>>;
  /**
   * Record a typed quote (story 6.8). Only the treasurer may; an incomplete quote is refused with the
   * reasons and nothing is written. A quote for the same supplier and order replaces the older one.
   */
  addQuote(input: unknown, now: EpochMs): Promise<Result<QuoteReceipt, QuoteError>>;
  /** The quotes recorded for one order, as the view holds them now. */
  quotesFor(order: string): Promise<readonly Quote[]>;
  /** The driver whose role stands at log time, judged as `apply` judges a driver (patch of story 7.4). */
  currentDriver(now: EpochMs): Promise<string | undefined>;
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
 * must hold the same key (story 3.4), otherwise a new random key is made.
 */
export async function createCommunity(
  deps: CommunityDeps,
  record: SharedRecord<EventEnvelope>,
  name: string,
  now: EpochMs,
  key: string = newCommunityKey(deps.randomBytes),
  /** How many people must approve a supplier payment (story 4.7): 1 to 5. Absent, the founding event says nothing and two apply. */
  approvals?: number,
): Promise<Result<Community, CommunityError>> {
  const trimmed = name.trim();
  if (trimmed === "") return err("empty_name", EMPTY_NAME_MESSAGE);
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
