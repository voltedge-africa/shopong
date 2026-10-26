// The events a phone writes for a community (story 3.4), built the way `@shopong/community` builds them: the same
// envelope, a random nonce, the phone's clock as `claimedAt`. The proof is the invitation token where one is needed.

import {
  encodeProof,
  FOUNDER_INVITATION,
  type CheckedInvitation,
  type Invitation,
} from "@shopong/community";
import { createEvent, type EventEnvelope } from "@shopong/events";
import type { Did } from "@shopong/ports";

export type RandomBytes = (length: number) => Uint8Array;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Base {
  readonly community: string;
  readonly now: number;
  readonly randomBytes: RandomBytes;
}

const build = (fields: {
  type:
    | "member.joined"
    | "member.invited"
    | "pledge.created"
    | "payment.payout"
    | "payment.approved"
    | "community.named";
  space: string;
  actor: Did;
  proof: readonly string[];
  claimedAt: number;
  nonce: string;
  payload: Record<string, unknown>;
}): EventEnvelope => createEvent(fields as never) as EventEnvelope;

/**
 * The founding `member.joined` of a community the phone created. Apply admits the creator on it. `approvals` is how many
 * people must approve a supplier payment (story 4.7): 1 to 5. Left out, the record uses two.
 */
export function founderEvent(
  input: Base & { readonly me: Did; readonly approvals?: number },
): EventEnvelope {
  return build({
    type: "member.joined",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload:
      input.approvals === undefined
        ? { invitation: FOUNDER_INVITATION }
        : { invitation: FOUNDER_INVITATION, approvals: input.approvals },
  });
}

/** The treasurer's payment of a supplier from the pool (story 4.7). Amount in whole rand cents. */
export function payoutEvent(
  input: Base & {
    readonly me: Did;
    readonly order: string;
    readonly supplier: string;
    readonly amountMinor: number;
    readonly recommendation: string;
    /** The keyed commitment of the supplier's bank details, from the Node (128 hex). Approvers sign it. */
    readonly bank: string;
  },
): EventEnvelope {
  return build({
    type: "payment.payout",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: {
      order: input.order,
      supplier: input.supplier,
      amount: { currency: "ZAR", minor: input.amountMinor },
      recommendation: input.recommendation,
      bank: input.bank,
    },
  });
}

/**
 * One approver's approval of a payment (story 4.7). `signature` is the approver's own signature over `approvalBytes` for
 * this community, payment and terms, made on their phone after they confirmed it.
 */
export function approvalEvent(
  input: Base & {
    readonly me: Did;
    readonly payout: string;
    readonly order: string;
    readonly supplier: string;
    readonly amountMinor: number;
    readonly bank: string;
    readonly signature: string;
  },
): EventEnvelope {
  return build({
    type: "payment.approved",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: {
      payout: input.payout,
      order: input.order,
      supplier: input.supplier,
      amount: { currency: "ZAR", minor: input.amountMinor },
      bank: input.bank,
      signature: input.signature,
    },
  });
}

/**
 * The community's name and rules note (story 8.1), written by the creator after the founding event. Plain text; the
 * registry and `apply` refuse anything else. Every member sees these words once they are on the Node.
 */
export function namingEvent(
  input: Base & { readonly me: Did; readonly name: string; readonly rules: string },
): EventEnvelope {
  return build({
    type: "community.named",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: { name: input.name, rules: input.rules },
  });
}

/** The creator's `member.invited`, which makes the invitee a writer in apply. */
export function inviteEvent(
  input: Base & { readonly me: Did; readonly invitation: Invitation },
): EventEnvelope {
  return build({
    type: "member.invited",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: {
      invitation: input.invitation.id,
      invitee: input.invitation.invitee,
      expiresAt: input.invitation.expiresAt,
    },
  });
}

/** The invitee's `member.joined`, carrying the invitation token as its proof. */
export function joinEvent(
  input: Base & { readonly me: Did; readonly checked: CheckedInvitation },
): EventEnvelope {
  return build({
    type: "member.joined",
    space: input.community,
    actor: input.me,
    proof: [encodeProof(input.checked.token)],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: { invitation: input.checked.id },
  });
}

/**
 * The member's pledge of `minor` cents to `order` (story 4.3). The payload names the member, who must be the actor, and
 * the amount in whole rand cents. The phone never writes a payment: that is the Node's, from this event's id.
 */
export function pledgeEvent(
  input: Base & { readonly me: Did; readonly order: string; readonly minor: number },
): EventEnvelope {
  return build({
    type: "pledge.created",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: {
      order: input.order,
      member: input.me,
      amount: { currency: "ZAR", minor: input.minor },
    },
  });
}
