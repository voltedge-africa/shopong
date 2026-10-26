// The deterministic `apply` of a community (AGENTS.md rule 3): it reads only the entry and the view,
// never the wall clock, the network or randomness. An invitation is checked with `CapabilityAuth.verify`
// against the event's own `claimedAt` as log time.
//
// An event that fails a check is not dropped (logs cannot be edited): the view records
// `rejected/<event id>` with the plain reason, so every device sees the same thing.
//
// Every decision here is made on `event.actor`, a field the sender writes, so `apply` first requires it
// to be the writer who actually appended the entry (`entry.writer`). Without that, any admitted writer
// (an invitee, before they have even joined) could claim to be the creator and invite anyone.
//
// View keys: `members/<did>` { invitation, joinedAt }, `invitations/<id>` { invitee, expiresAt },
// `joined/<invitation id>` { member }, `roles/<did>/<role>` (see roles.ts), `quotes/<order>/<supplier>`
// (see quotes.ts), `rejected/<event id>` { type, reason }.

import {
  PERSONAL_DATA_MESSAGE,
  checkPersonalFields,
  type EventEnvelope,
  type JsonObject,
} from "@shopong/events";
import type { Apply, CapabilityAuth, Did, RecordEntry, ViewWriter } from "@shopong/ports";
import { invitePassOnAllowed } from "./chain.js";
import { verifyAuthority } from "./authority.js";
import { INVITATION_MESSAGES, JOIN_ABILITY, problemOf } from "./invitation.js";
import { decodeProof } from "./proof.js";
import { QUOTE_MESSAGES, checkQuote, isTreasurer, quoteJson, quoteKey } from "./quotes.js";
import {
  coTreasurerJoinRecorded,
  isCoTreasurer,
  isCurrentGrantIn,
  recordRoleGrant,
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

export function createCommunityApply(env: CommunityApplyEnvironment): Apply<EventEnvelope> {
  async function invited(
    event: EventEnvelope,
    view: ViewWriter,
    host: Parameters<Apply<EventEnvelope>>[2],
  ): Promise<string | undefined> {
    if (event.actor !== env.creator && !(await isCoTreasurer(view, event.actor, event.claimedAt))) {
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

  async function joined(entry: RecordEntry<EventEnvelope>, view: ViewWriter) {
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
        at: event.claimedAt,
        required: { with: spaceUri(env.spaceKey), can: JOIN_ABILITY },
        isCurrentGrant: (who, id) => isCurrentGrantIn(view, who, id),
      });
      if (!verified.ok) return INVITATION_MESSAGES[problemOf(verified.error.code)];
      const passedOn = await invitePassOnAllowed(
        env.auth,
        verified.value.chain,
        (inviter, parentId) => coTreasurerJoinRecorded(view, inviter, parentId, event.claimedAt),
      );
      if (!passedOn) return INVITATION_MESSAGES.unreadable;
      // The token must be the one the event names, so its id cannot be swapped to dodge the reuse check.
      if ((await env.auth.tokenId(token)) !== invitation) return INVITATION_MESSAGES.unreadable;
      await view.put(`joined/${invitation}`, { member: event.actor });
    }
    await view.put(`members/${event.actor}`, { invitation, joinedAt: event.claimedAt });
    return undefined;
  }

  /** A quote is the treasurer's: the creator or a co-treasurer. Its shape is checked as in the form. */
  async function quoteAdded(event: EventEnvelope, view: ViewWriter): Promise<string | undefined> {
    if (!(await isTreasurer(view, env.creator, event.actor, event.claimedAt))) {
      return QUOTE_MESSAGES.not_permitted;
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
      // Personal values first, before any effect (AGENTS rule 6). A quote is checked by `quoteAdded`, which
      // gives the quote's own sentences first and then this same guard.
      if (event.type !== "quote.added" && checkPersonalFields(event.payload).length > 0) {
        await view.put(`rejected/${entry.id}`, { type: event.type, reason: PERSONAL_DATA_MESSAGE });
        continue;
      }
      if (
        event.type !== "member.invited" &&
        event.type !== "member.joined" &&
        event.type !== "role.granted" &&
        event.type !== "quote.added"
      ) {
        continue;
      }
      const reason =
        entry.writer !== event.actor
          ? NOT_THE_WRITER
          : event.space !== env.spaceKey
            ? INVITATION_MESSAGES.unreadable
            : event.type === "member.invited"
              ? await invited(event, view, host)
              : event.type === "role.granted"
                ? await recordRoleGrant(env, view, event)
                : event.type === "quote.added"
                  ? await quoteAdded(event, view)
                  : await joined(entry, view);
      if (reason !== undefined) {
        await view.put(`rejected/${entry.id}`, { type: event.type, reason });
      }
    }
  };
}
