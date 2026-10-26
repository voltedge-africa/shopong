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
// `quotes/<order>/<supplier>` (see quotes.ts), `pledges/<order>/<member>` and `pledge-events/<event id>` (see
// pledges.ts), `payments/<pledge event id>` (the Node's request for a pledge), `log/time` (see log-time.ts), `indexers/<did>` (true; the
// creator's is seeded by the founding join, story 3.3), `removed/<did>` { by, at } (set by a removal, cleared by a
// fresh invitation to that person; story 3.3), `rejected/<event id>` { type, reason }.

import {
  PERSONAL_DATA_MESSAGE,
  checkPersonalFields,
  isPlainObject,
  type EventEnvelope,
  type JsonObject,
} from "@shopong/events";
import type { Apply, CapabilityAuth, Did, EpochMs, RecordEntry, ViewWriter } from "@shopong/ports";
import { invitePassOnAllowed } from "./chain.js";
import { verifyAuthority } from "./authority.js";
import { INVITATION_MESSAGES, JOIN_ABILITY, problemOf } from "./invitation.js";
import {
  CLAIM_MESSAGE,
  LOG_TIME_KEY,
  advanceLogTime,
  isValidClaim,
  logTimeOf,
} from "./log-time.js";
import { decodeProof } from "./proof.js";
import { QUOTE_MESSAGES, checkQuote, isTreasurer, quoteJson, quoteKey } from "./quotes.js";
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
  type StandingContext,
} from "./roles.js";
import { spaceUri } from "./space.js";

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
  ): Promise<string | undefined> {
    const event = entry.event;
    if ((await view.get(`members/${event.actor}`)) === undefined) return PLEDGE_MESSAGES.not_member;
    const checked = checkPledge(event.payload, event.actor as Did);
    if (!checked.ok) return checked.problem;
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
    await view.put(quoteKey(checked.value.order, checked.value.supplier), quoteJson(checked.value));
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
      if (event.type !== "quote.added" && checkPersonalFields(event.payload).length > 0) {
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
        return pledgeCreated(entry, view);
      case "payment.requested":
        return paymentRequested(entry, view);
      default:
        return quoteAdded(event, view, at);
    }
  }
}
