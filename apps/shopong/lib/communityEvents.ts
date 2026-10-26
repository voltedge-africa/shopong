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
  type: "member.joined" | "member.invited";
  space: string;
  actor: Did;
  proof: readonly string[];
  claimedAt: number;
  nonce: string;
  payload: Record<string, string | number>;
}): EventEnvelope => createEvent(fields as never) as EventEnvelope;

/** The founding `member.joined` of a community the phone created. Apply admits the creator on it. */
export function founderEvent(input: Base & { readonly me: Did }): EventEnvelope {
  return build({
    type: "member.joined",
    space: input.community,
    actor: input.me,
    proof: [],
    claimedAt: input.now,
    nonce: hex(input.randomBytes(16)),
    payload: { invitation: FOUNDER_INVITATION },
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
