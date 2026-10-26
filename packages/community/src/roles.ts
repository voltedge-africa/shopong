// Roles with limits as delegated capabilities (story 2.4).
//
// A role is a fixed set of abilities. The creator (or a holder, within what they hold) gives it to one
// member for 7, 30 or 90 days, with an optional rand limit on payment approval. It is one UCAN delegation
// per ability, carried in the `role.granted` event's proof. `apply` checks those tokens with
// `CapabilityAuth.verify` against the event's own time; the phone checks them against the device clock
// for "What can I do?". Every refusal a person sees is one plain sentence in `ROLE_MESSAGES`.
//
// Story 3.6: every check here is judged at log time (log-time.ts), never at the time an event claims, so a
// backdated event cannot use a role that ended. A role is taken back with `role.revoked` (a record event):
// each grant of it is marked in the view as revoked, and a later use of any of those grants is refused.
//
// View keys: `roles/<did>/<role>` { role, grantor, expiresAt, grants: [{ ability, token, id, limit }] },
// `revoked/<grant id>` { role, grantee }. The `id` of each grant is what an invitation passed on by a
// co-treasurer must name as its parent.

import type { EventEnvelope } from "@shopong/events";
import {
  err,
  money,
  ok,
  type Err,
  type Ability,
  type Capability,
  type CapabilityAuth,
  type CapabilityToken,
  type Did,
  type EpochMs,
  type JsonValue,
  type Money,
  type PortError,
  type Result,
  type ViewReader,
  type ViewWriter,
  isDid,
  isMoney,
} from "@shopong/ports";
import { decodeProof } from "./proof.js";
import { verifyAuthority, type AuthorityFailure } from "./authority.js";
import { DAY_MS, INVITATION_MESSAGES } from "./invitation.js";
import { spaceUri } from "./space.js";

export const ROLE_NAMES = ["co-treasurer", "driver", "supplier"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export interface RoleDefinition {
  readonly label: string;
  readonly abilities: readonly Ability[];
  /** The one ability the role's rand limit applies to. Absent for a role with no limit. */
  readonly limited?: Ability;
}

/** The fixed role list (decision 3). The payment, delivery and quote abilities are names until their epics. */
export const ROLES: { readonly [R in RoleName]: RoleDefinition } = {
  "co-treasurer": {
    label: "Co-treasurer",
    abilities: ["payment/approve", "member/invite", "member/join"],
    limited: "payment/approve",
  },
  driver: { label: "Driver", abilities: ["delivery/confirm"] },
  supplier: { label: "Supplier", abilities: ["quote/offer"] },
};

/** The lengths a treasurer can pick (decision 4). */
export const ROLE_DAYS = [7, 30, 90] as const;
export const DEFAULT_ROLE_DAYS = 30;

/** What "What can I do?" asks about. `limited` marks the ability that takes an amount. */
export const ACTIONS: readonly {
  readonly ability: Ability;
  readonly label: string;
  readonly limited: boolean;
}[] = [
  { ability: "payment/approve", label: "Approve a payment", limited: true },
  { ability: "member/invite", label: "Invite a member", limited: false },
  { ability: "delivery/confirm", label: "Confirm a delivery", limited: false },
  { ability: "quote/offer", label: "Offer a quote", limited: false },
];

const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;

export function isRoleName(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}

export const roleKey = (grantee: string, role: string) => `roles/${grantee}/${role}`;
/** The view key that marks a grant (by its token id) as taken back. */
export const revokedKey = (grantId: string) => `revoked/${grantId}`;

// ---- plain words ----------------------------------------------------------------------

export type RoleProblem =
  | "unknown_role"
  | "bad_grantee"
  | "self"
  | "self_creator"
  | "not_member"
  | "bad_days"
  | "no_limit"
  | "limit_needed"
  | "cant_grant"
  | "cant_pass_more"
  | "unreadable"
  | "not_yours"
  | "ended"
  | "not_started"
  | "outside"
  | "over_limit"
  | "no_amount"
  | "not_original_giver"
  | "revoked"
  | "nothing_to_revoke"
  | "cant_revoke";

export type RoleError = PortError<RoleProblem>;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** A day as the words say it. UTC, so `apply` gives the same text on every device (see S-2.4-6). */
export function formatDay(ms: EpochMs): string {
  const day = new Date(ms);
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}

/** R1000 or R1000.50 from an amount in cents. */
export function formatRand(amount: Money): string {
  const rands = amount.minor / 100;
  return `R${Number.isInteger(rands) ? rands : rands.toFixed(2)}`;
}

const FIXED_MESSAGES: { readonly [P in RoleProblem]?: string } = {
  unknown_role: "That is not a role in this community.",
  bad_grantee: "That doesn't look like an identity.",
  self: "You can't give a role to yourself.",
  self_creator: "You already hold every role.",
  not_member: "Invite them to the community first.",
  bad_days: "Pick 7, 30 or 90 days.",
  no_limit: "This role has no limit.",
  limit_needed: "Set a limit for this role.",
  cant_grant: "You can't give roles in this community.",
  cant_pass_more: "You can't give more than you have.",
  unreadable: "This role can't be checked.",
  not_yours: "This role isn't yours.",
  outside: "Your role doesn't cover that.",
  no_amount: "Say how much.",
  not_original_giver: "Only the person who gave this role, or the creator, can replace it.",
  revoked: "This role has been taken back.",
  nothing_to_revoke: "There is no such role to take back.",
  cant_revoke: "Only the person who gave this role, or the creator, can take it back.",
};

/** The plain sentence for a refusal. `at` is the day for `ended` and `not_started`; `limit` for `over_limit`. */
export function roleMessage(
  problem: RoleProblem,
  detail: { readonly at?: EpochMs; readonly limit?: Money } = {},
): string {
  if (problem === "ended") return `Your role ended on ${formatDay(detail.at ?? 0)}.`;
  if (problem === "not_started") return `Your role starts on ${formatDay(detail.at ?? 0)}.`;
  if (problem === "over_limit")
    return `That is above your limit of ${formatRand(detail.limit ?? money("ZAR", 0))}.`;
  return FIXED_MESSAGES[problem] ?? INVITATION_MESSAGES.unreadable;
}

function fail(problem: RoleProblem, detail?: { readonly at?: EpochMs; readonly limit?: Money }) {
  return err(problem, roleMessage(problem, detail));
}

// ---- the record in the view -------------------------------------------------------------

export interface RoleGrant {
  readonly ability: Ability;
  readonly token: CapabilityToken;
  /** Token id (`CapabilityAuth.tokenId`). */
  readonly id: string;
  /** The rand limit this ability carries, if any. */
  readonly limit?: Money;
}

export interface RoleRecord {
  readonly role: RoleName;
  readonly grantor: Did;
  /** When the role ends (milliseconds). */
  readonly expiresAt: EpochMs;
  readonly grants: readonly RoleGrant[];
}

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: JsonValue | undefined): RoleRecord | undefined {
  if (!isObject(value)) return undefined;
  const { role, grantor, expiresAt, grants } = value;
  if (!isRoleName(role) || typeof grantor !== "string" || typeof expiresAt !== "number") {
    return undefined;
  }
  if (!Array.isArray(grants)) return undefined;
  const parsed: RoleGrant[] = [];
  for (const grant of grants) {
    if (!isObject(grant)) return undefined;
    const { ability, token, id, limit } = grant;
    if (typeof ability !== "string" || typeof token !== "string" || typeof id !== "string") {
      return undefined;
    }
    if (limit !== null && !isMoney(limit)) return undefined;
    const limitValue: Money | undefined = limit === null ? undefined : limit;
    parsed.push({
      ability,
      token: token as CapabilityToken,
      id,
      ...(limitValue === undefined ? {} : { limit: limitValue }),
    });
  }
  return { role, grantor: grantor as Did, expiresAt, grants: parsed };
}

function toJson(record: RoleRecord): JsonValue {
  return {
    role: record.role,
    grantor: record.grantor,
    expiresAt: record.expiresAt,
    grants: record.grants.map((grant) => ({
      ability: grant.ability,
      token: grant.token,
      id: grant.id,
      limit:
        grant.limit === undefined
          ? null
          : { currency: grant.limit.currency, minor: grant.limit.minor },
    })),
  };
}

/** Whether the grant with this token id has been taken back (`role.revoked`) in the view as it stands. */
export async function isRevokedIn(view: ViewReader, tokenId: string): Promise<boolean> {
  return (await view.get(revokedKey(tokenId))) !== undefined;
}

/** Whether a recorded role has been taken back: its grants are all marked, so any one of them is enough. */
async function roleRevokedIn(view: ViewReader, record: RoleRecord): Promise<boolean> {
  for (const grant of record.grants) {
    if (await isRevokedIn(view, grant.id)) return true;
  }
  return false;
}

/** Whether `tokenId` is a grant recorded for `holder` in the view as it stands (review finding 1). */
export async function isCurrentGrantIn(
  view: ViewReader,
  holder: string,
  tokenId: string,
): Promise<boolean> {
  return (await rolesOf(view, holder)).some((record) =>
    record.grants.some((grant) => grant.id === tokenId),
  );
}

export async function readRole(
  view: ViewReader,
  holder: string,
  role: RoleName,
): Promise<RoleRecord | undefined> {
  return parseRecord(await view.get(roleKey(holder, role)));
}

/** Every role recorded for a member, ended or not. */
export async function rolesOf(view: ViewReader, holder: string): Promise<readonly RoleRecord[]> {
  const out: RoleRecord[] = [];
  for (const entry of await view.list(`roles/${holder}/`)) {
    const record = parseRecord(entry.value);
    if (record !== undefined) out.push(record);
  }
  return out;
}

/** The co-treasurer's recorded `member/join` grant, if they hold the role, it has not ended at `at` and it was not taken back. */
export async function coTreasurerJoinGrant(
  view: ViewReader,
  inviter: string,
  at: EpochMs,
): Promise<RoleGrant | undefined> {
  const record = await readRole(view, inviter, "co-treasurer");
  if (record === undefined || at >= record.expiresAt) return undefined;
  if (await roleRevokedIn(view, record)) return undefined;
  return record.grants.find((grant) => grant.ability === "member/join");
}

/**
 * Who a co-treasurer's standing is judged against: the record's creator, the space, and the verifier. The same
 * `CapabilityAuth` the join checks use, so `apply`, the phone and the Node agree (review item 2).
 */
export interface StandingContext {
  readonly auth: CapabilityAuth;
  readonly creator: Did;
  readonly spaceKey: string;
}

/**
 * Why a co-treasurer does not stand at `at`, in the plain words of the role. `undefined` when they hold no
 * co-treasurer role, or it stands. A role stands only when every grant it holds still verifies at `at`: the
 * chain is sound and in time, no grant in it has been taken back, and every link above is a current grant.
 */
export async function coTreasurerProblem(
  ctx: StandingContext,
  view: ViewReader,
  who: string,
  at: EpochMs,
): Promise<string | undefined> {
  const record = await readRole(view, who, "co-treasurer");
  if (record === undefined) return undefined;
  if (await roleRevokedIn(view, record)) return roleMessage("revoked");
  for (const grant of record.grants) {
    const verified = await verifyAuthority(ctx.auth, grant.token, {
      holder: who as Did,
      rootIssuer: ctx.creator,
      at,
      required: {
        with: spaceUri(ctx.spaceKey),
        can: grant.ability,
        ...(grant.limit === undefined ? {} : { ceiling: grant.limit }),
      },
      isRevoked: (id) => isRevokedIn(view, id),
      isCurrentGrant: (holder, id) => isCurrentGrantIn(view, holder, id),
    });
    if (!verified.ok) return roleFailure(verified.error).error.message;
  }
  return undefined;
}

/** Whether `inviter` holds the co-treasurer role and it stands at `at` (may send `member.invited`). */
export async function isCoTreasurer(
  ctx: StandingContext,
  view: ViewReader,
  inviter: string,
  at: EpochMs,
): Promise<boolean> {
  const record = await readRole(view, inviter, "co-treasurer");
  return record !== undefined && (await coTreasurerProblem(ctx, view, inviter, at)) === undefined;
}

/** Whether `parentId` is the `member/join` grant recorded for `inviter` as co-treasurer, at `at`. */
export async function coTreasurerJoinRecorded(
  view: ViewReader,
  inviter: string,
  parentId: string,
  at: EpochMs,
): Promise<boolean> {
  const grant = await coTreasurerJoinGrant(view, inviter, at);
  return grant !== undefined && grant.id === parentId;
}

// ---- checking an action on a holder's own chain -----------------------------------------

interface CheckContext {
  readonly auth: CapabilityAuth;
  readonly creator: Did;
  readonly spaceKey: string;
}

function capabilityFor(spaceKey: string, ability: Ability, limit?: Money): Capability {
  return limit === undefined
    ? { with: spaceUri(spaceKey), can: ability }
    : { with: spaceUri(spaceKey), can: ability, ceiling: limit };
}

/** The plain reason for a shared authority refusal, in the words of a role. */
function roleFailure(failure: AuthorityFailure): Err<RoleError> {
  // `missing_proof` cannot happen on the phone for a role: each grant is read from the record. If it ever
  // did, it shares the "can't be checked" sentence on purpose, rather than a new one nobody sees.
  switch (failure.code) {
    case "ended":
    case "not_started":
      return fail(failure.code, { at: failure.at });
    case "over_limit":
      return fail("over_limit", failure.limit === undefined ? {} : { limit: failure.limit });
    case "outside":
    case "not_current":
    case "not_yours":
      return fail(failure.code === "not_current" ? "outside" : failure.code);
    case "revoked":
      return fail("revoked");
    default:
      return fail("unreadable");
  }
}

/**
 * One token, checked for `holder` in the order the plain reasons follow (see `verifyAuthority`).
 * `amount` is only given for the limited ability.
 */
async function checkToken(
  ctx: CheckContext,
  view: ViewReader,
  holder: string,
  token: CapabilityToken,
  ability: Ability,
  logTime: EpochMs,
  amount?: Money,
): Promise<Result<{ readonly limit?: Money; readonly endsAt: EpochMs }, RoleError>> {
  const verified = await verifyAuthority(ctx.auth, token, {
    holder: holder as Did,
    rootIssuer: ctx.creator,
    at: logTime,
    isRevoked: (id) => isRevokedIn(view, id),
    isCurrentGrant: (who, id) => isCurrentGrantIn(view, who, id),
    required: {
      with: spaceUri(ctx.spaceKey),
      can: ability,
      ...(amount === undefined ? {} : { ceiling: amount }),
    },
  });
  if (!verified.ok) return roleFailure(verified.error);
  return ok({
    ...(verified.value.limit === undefined ? {} : { limit: verified.value.limit }),
    endsAt: verified.value.endsAt,
  });
}

export interface ActionRequest {
  readonly ability: Ability;
  /** Required for the limited ability (payment approval); ignored otherwise. */
  readonly amount?: Money;
}

export interface RoleCheck {
  readonly role: RoleName;
  readonly limit?: Money;
  readonly endsAt: EpochMs;
}

/** Whether the record's `member/join` grant is a direct grant from the creator, with no link above it. */
async function joinIsDirect(ctx: CheckContext, record: RoleRecord): Promise<boolean> {
  const join = record.grants.find((grant) => grant.ability === "member/join");
  if (join === undefined) return false;
  const decoded = await ctx.auth.decode(join.token);
  return decoded.ok && decoded.value.proofs.length === 0 && decoded.value.issuer === ctx.creator;
}

/**
 * "What can I do?": may `holder` do `request` at log time? Returns the role that allows it, or the plain
 * reason from the first role that could have allowed it.
 */
export async function checkAction(
  ctx: CheckContext & { readonly view: ViewReader },
  holder: string,
  request: ActionRequest,
  logTime: EpochMs,
): Promise<Result<RoleCheck, RoleError>> {
  const limited = Object.values(ROLES).some((role) => role.limited === request.ability);
  if (limited && request.amount === undefined) return fail("no_amount");
  const candidates: { readonly role: RoleName; readonly token: CapabilityToken }[] = [];
  for (const record of await rolesOf(ctx.view, holder)) {
    // Inviting needs the co-treasurer's own member/join to come straight from the creator (one link).
    if (request.ability === "member/invite" && !(await joinIsDirect(ctx, record))) continue;
    for (const grant of record.grants) {
      if (grant.ability === request.ability)
        candidates.push({ role: record.role, token: grant.token });
    }
  }
  if (candidates.length === 0) return fail("outside");
  let first: RoleError | undefined;
  for (const candidate of candidates) {
    const checked = await checkToken(
      ctx,
      ctx.view,
      holder,
      candidate.token,
      request.ability,
      logTime,
      limited ? request.amount : undefined,
    );
    if (checked.ok) return ok({ role: candidate.role, ...checked.value });
    first ??= checked.error;
  }
  return err((first ?? fail("outside").error).code, (first ?? fail("outside").error).message);
}

// ---- giving a role ------------------------------------------------------------------

export interface IssueRoleRequest extends CheckContext {
  readonly view: ViewReader;
  /** Who is giving the role: the creator, or a holder passing on part of their own role. */
  readonly grantor: Did;
  readonly grantee: string;
  readonly role: string;
  /** The rand limit for the limited ability. Required for that role; refused for the others. */
  readonly limit?: Money;
  /** 7, 30 or 90. Default 30. */
  readonly days?: number;
  /** The time the role's delegations start from and are checked at: the record's log time (story 3.6). */
  readonly logTime: EpochMs;
  /** The device clock when the role is given. It sets how long the role lasts. */
  readonly now: EpochMs;
}

export interface RoleDraft {
  readonly role: RoleName;
  readonly grantee: Did;
  readonly expiresAt: EpochMs;
  /** One token per ability of the role, in the role's order. These are the event's proof. */
  readonly tokens: readonly CapabilityToken[];
}

function capabilitiesFor(definition: RoleDefinition, spaceKey: string, limit?: Money) {
  return definition.abilities.map((ability) =>
    capabilityFor(spaceKey, ability, definition.limited === ability ? limit : undefined),
  );
}

/** Make the delegation tokens for a role. Nothing is recorded here; the caller appends the event. */
export async function issueRole(request: IssueRoleRequest): Promise<Result<RoleDraft, RoleError>> {
  const { auth, view, creator, spaceKey, grantor, grantee, limit, now, logTime } = request;
  if (!isRoleName(request.role)) return fail("unknown_role");
  const definition = ROLES[request.role];
  if (!isDid(grantee) || !DID_KEY.test(grantee)) return fail("bad_grantee");
  if (grantee === grantor) return fail(grantor === creator ? "self_creator" : "self");
  if ((await view.get(`members/${grantee}`)) === undefined) return fail("not_member");
  const days = request.days ?? DEFAULT_ROLE_DAYS;
  if (!(ROLE_DAYS as readonly number[]).includes(days)) return fail("bad_days");
  if (definition.limited === undefined && limit !== undefined) return fail("no_limit");
  if (definition.limited !== undefined && limit === undefined) return fail("limit_needed");

  // UCAN times are whole seconds (as for invitations). A role starts at log time, so `apply` (which checks
  // it at log time) accepts it, and it lasts the days chosen from the giver's clock.
  const notBefore = Math.floor(logTime / 1000) * 1000;
  const expiresAt = Math.floor((now + days * DAY_MS) / 1000) * 1000;
  const capabilities = capabilitiesFor(definition, spaceKey, limit);
  const tokens: CapabilityToken[] = [];

  if (grantor === creator) {
    for (const capability of capabilities) {
      const issued = await auth.issue({
        issuer: grantor,
        audience: grantee as Did,
        capabilities: [capability],
        notBefore,
        expiresAt,
      });
      if (!issued.ok) return fail("unreadable");
      tokens.push(issued.value);
    }
  } else {
    // A holder passes on only what they hold for each ability, and no more. The first failure decides
    // the reason, unless some ability is simply not held at all.
    const held: (CapabilityToken | undefined)[] = [];
    let failure: RoleError | undefined;
    for (const ability of definition.abilities) {
      const grants = (await rolesOf(view, grantor))
        .flatMap((record) => record.grants)
        .filter((grant) => grant.ability === ability);
      let proof: CapabilityToken | undefined;
      let abilityFailure: RoleError | undefined;
      for (const grant of grants) {
        const checked = await checkToken(
          { auth, creator, spaceKey },
          view,
          grantor,
          grant.token,
          ability,
          logTime,
          definition.limited === ability ? limit : undefined,
        );
        if (checked.ok) {
          proof = grant.token;
          break;
        }
        abilityFailure ??= checked.error;
      }
      if (proof === undefined) failure ??= abilityFailure;
      held.push(proof);
    }
    // Someone with no role at all may not give roles. A holder who lacks what they try to give gets
    // "more than you have"; a role that ended earlier in their chain gets the day it ended.
    if ((await rolesOf(view, grantor)).length === 0) return fail("cant_grant");
    if (
      failure?.code === "ended" ||
      failure?.code === "not_started" ||
      failure?.code === "unreadable"
    ) {
      return err(failure.code, failure.message);
    }
    if (failure !== undefined || held.some((proof) => proof === undefined))
      return fail("cant_pass_more");

    for (let i = 0; i < capabilities.length; i++) {
      const issued = await auth.issue({
        issuer: grantor,
        audience: grantee as Did,
        capabilities: [capabilities[i] as Capability],
        notBefore,
        expiresAt,
        proofs: [held[i] as CapabilityToken],
      });
      if (!issued.ok) {
        return fail(issued.error.code === "not_attenuated" ? "cant_pass_more" : "unreadable");
      }
      tokens.push(issued.value);
    }
  }
  return ok({ role: request.role, grantee: grantee as Did, expiresAt, tokens });
}

// ---- recording a role in apply ------------------------------------------------------

/**
 * `apply` for a `role.granted` event: checks every token at log time `at` (the time before this event), and
 * records the role for the grantee. Returns the plain reason to refuse the event, or `undefined` when it is
 * recorded. Reads only the event and the view.
 */
export async function recordRoleGrant(
  ctx: CheckContext,
  view: ViewWriter,
  event: EventEnvelope,
  at: EpochMs,
): Promise<string | undefined> {
  const { auth, creator } = ctx;
  const payload = event.payload;
  const role = payload.role;
  const grantee = payload.grantee;
  const expiresAt = payload.expiresAt;
  if (!isRoleName(role) || typeof grantee !== "string" || typeof expiresAt !== "number") {
    return roleMessage("unreadable");
  }
  const definition = ROLES[role];
  if (grantee === event.actor) {
    return roleMessage(event.actor === creator ? "self_creator" : "self");
  }
  if ((await view.get(`members/${grantee}`)) === undefined) return roleMessage("not_member");
  if (event.proof.length !== definition.abilities.length) return roleMessage("unreadable");

  const grants: RoleGrant[] = [];
  const seen = new Set<string>();
  for (const proof of event.proof) {
    const token = decodeProof(proof);
    if (token === undefined) return roleMessage("unreadable");
    const decoded = await auth.decode(token);
    if (!decoded.ok) return roleMessage("unreadable");
    // A token carries one command; anything else is not one of our role tokens.
    if (decoded.value.capabilities.length !== 1) return roleMessage("unreadable");
    const capability = decoded.value.capabilities[0];
    if (capability === undefined || seen.has(capability.can)) return roleMessage("unreadable");
    const ability = capability.can;
    if (!definition.abilities.includes(ability)) return roleMessage("unreadable");
    // A role from another community's space is not this community's role.
    if (capability.with !== spaceUri(ctx.spaceKey)) return roleMessage("unreadable");
    seen.add(ability);
    if (
      decoded.value.issuer !== event.actor ||
      decoded.value.audience !== grantee ||
      decoded.value.expiresAt !== expiresAt
    ) {
      return roleMessage("unreadable");
    }
    if ((definition.limited === ability) !== (capability.ceiling !== undefined)) {
      return roleMessage("unreadable");
    }

    const verified = await verifyAuthority(auth, token, {
      holder: grantee as Did,
      rootIssuer: creator,
      at,
      required: capability,
      isRevoked: (id) => isRevokedIn(view, id),
      isCurrentGrant: (who, id) => isCurrentGrantIn(view, who, id),
    });
    if (!verified.ok) {
      switch (verified.error.code) {
        case "ended":
        case "not_started":
          return roleMessage(verified.error.code, { at: verified.error.at });
        case "revoked":
          return roleMessage("revoked");
        case "outside":
        case "not_current":
        case "over_limit": {
          const held = (await rolesOf(view, event.actor)).some((record) =>
            record.grants.some((grant) => definition.abilities.includes(grant.ability)),
          );
          return roleMessage(held ? "cant_pass_more" : "cant_grant");
        }
        default:
          return roleMessage("unreadable");
      }
    }
    grants.push({
      ability,
      token,
      id: await auth.tokenId(token),
      ...(capability.ceiling === undefined ? {} : { limit: capability.ceiling }),
    });
  }

  // Replacing a role someone else recorded is for its giver or the creator only (S-2.4-16).
  const existing = await readRole(view, grantee, role);
  if (existing !== undefined && event.actor !== creator && event.actor !== existing.grantor) {
    return roleMessage("not_original_giver");
  }

  await view.put(
    roleKey(grantee, role),
    toJson({ role, grantor: event.actor as Did, expiresAt, grants }),
  );
  return undefined;
}

/**
 * `apply` for a `role.revoked` event: takes back the role `grantee` holds, so every grant of it is refused
 * from here on. Its payload is `{ role, grantee }`, read loosely (story 2.6 gives it a strict schema).
 * Only the creator or the person who gave the role may take it back, the same people who may replace it
 * (S-2.4-16); story 2.6 owns that rule and the screen. Returns the plain reason, or `undefined` when taken back.
 */
export async function recordRoleRevocation(
  ctx: CheckContext,
  view: ViewWriter,
  event: EventEnvelope,
): Promise<string | undefined> {
  const { role, grantee } = event.payload;
  if (!isRoleName(role) || typeof grantee !== "string") return roleMessage("unreadable");
  const record = await readRole(view, grantee, role);
  if (record === undefined) return roleMessage("nothing_to_revoke");
  if (event.actor !== ctx.creator && event.actor !== record.grantor) {
    return roleMessage("cant_revoke");
  }
  for (const grant of record.grants) {
    await view.put(revokedKey(grant.id), { role, grantee });
  }
  return undefined;
}
