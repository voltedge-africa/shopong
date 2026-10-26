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
// `quotes/<order>/<supplier>` (see quotes.ts), `log/time` (see log-time.ts), `rejected/<event id>`
// { type, reason }.

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

/** The event types `apply` checks. Other types are not applied yet, and do not move log time. */
const CHECKED: ReadonlySet<string> = new Set([
  "member.invited",
  "member.joined",
  "role.granted",
  "role.revoked",
  "quote.added",
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
      case "role.granted":
        return recordRoleGrant(env, view, event, at);
      case "role.revoked":
        return recordRoleRevocation(env, view, event);
      default:
        return quoteAdded(event, view, at);
    }
  }
}
