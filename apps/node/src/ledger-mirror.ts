// Posts to the books and mirrors the posting into the record (story 4.6, AR6). This is the Node's one path for a money
// posting: the ledger takes the posting first, keyed by the event id (AGENTS.md rule 5), and then the same posting is
// written to the record as a `ledger.posted` event. The event is written by the community's creator writer (the Node
// holds its derived keys, see hub.ts), with `by` naming the Node's own identity: the phone's pull check needs writer =
// actor, and the Node has no admitted writer identity of its own (shortcut S-4.6-2). The record can therefore rebuild
// the books, and the pool read can compare the two.
//
// The mirror event is built only from the posting, and its `claimedAt` is the ledger's posting time, so a retry of the
// same posting builds the same event and the record keeps it once. If the ledger takes the posting and the mirror
// write fails, the books and the record differ until the same posting is retried: the pool view shows that difference
// as a flag until then (it is never hidden).
//
// Payloads carry only opaque ids and amounts (no PII). Phones cannot write `ledger.posted`: the events route refuses it.

import {
  assertNoPersonalData,
  createEvent,
  PERSONAL_DATA_MESSAGE,
  PersonalDataError,
  type EventEnvelope,
} from "@shopong/events";
import {
  err,
  type Did,
  type Ledger,
  type LedgerEntry,
  type PortError,
  type PostError,
  type PostReceipt,
  type Result,
} from "@shopong/ports";
import { LEDGER_POSTED, MEMBER_LIABILITY, MEMBER_ACCOUNT_PREFIX } from "./pool-read.ts";

/**
 * A posting line as the record holds it. A member's liability is written as the account type plus the opaque member id
 * in its own field, so the id is a whole value (exempt from the personal-data shape check) and the record's own check
 * does not refuse the mirror. `memberAccountOf` puts the slug back.
 */
export function mirroredLine(entry: LedgerEntry): Record<string, string | number> {
  const base = {
    direction: entry.direction,
    currency: entry.amount.currency,
    minor: entry.amount.minor,
  };
  if (entry.account.startsWith(MEMBER_ACCOUNT_PREFIX)) {
    return {
      account: MEMBER_LIABILITY,
      member: entry.account.slice(MEMBER_ACCOUNT_PREFIX.length),
      ...base,
    };
  }
  return { account: entry.account, ...base };
}

/** The part of the replica hub the mirror needs. `ReplicaHub` implements it. */
export interface MirrorHub {
  /** The creator of a community the Node holds: the writer every mirror event is appended as. */
  creatorOf(communityKey: string): Did | undefined;
  /** Appends the event to the community's record through the Node's writer for it. Undefined when it cannot. */
  mirror(
    communityKey: string,
    event: EventEnvelope,
  ): Promise<{ id: string; duplicate: boolean } | undefined>;
}

export interface MirrorOptions {
  readonly ledger: Ledger;
  readonly hub: MirrorHub;
  /** The Node's identity: named in `by` of every mirror event. */
  readonly nodeIdentity: Did;
}

export interface PostingRequest {
  readonly communityKey: string;
  /** The event id of the money event (64 bytes of SHA-512 as 128 hex characters). */
  readonly idempotencyKey: string;
  readonly description: string;
  readonly entries: readonly LedgerEntry[];
}

export type MirrorFailure = PostError | PortError<"mirror_failed">;

/**
 * Posts the posting to the books, then mirrors it into the record. `replayed` is true when the books already had it.
 * The mirror is written in both cases, so a retry after a failed mirror repairs the record.
 */
export async function postAndMirror(
  options: MirrorOptions,
  request: PostingRequest,
): Promise<
  Result<{ receipt: PostReceipt; mirrored: { id: string; duplicate: boolean } }, MirrorFailure>
> {
  const writer = options.hub.creatorOf(request.communityKey);
  if (writer === undefined) {
    return err(
      "mirror_failed",
      "The community is not held on this Node, so the posting was not made.",
    );
  }
  // A posting's words are written to the record for ever: a phone or ID number in them is refused before the books see it.
  try {
    assertNoPersonalData({ description: request.description });
  } catch (error) {
    if (error instanceof PersonalDataError) return err("invalid_request", PERSONAL_DATA_MESSAGE);
    throw error;
  }
  const posted = await options.ledger.post({
    idempotencyKey: request.idempotencyKey,
    description: request.description,
    entries: request.entries,
  });
  if (!posted.ok) return posted;

  const event = createEvent({
    type: LEDGER_POSTED,
    space: request.communityKey,
    actor: writer,
    proof: [],
    claimedAt: posted.value.transaction.postedAt,
    nonce: request.idempotencyKey,
    payload: {
      by: options.nodeIdentity,
      key: request.idempotencyKey,
      description: request.description,
      entries: request.entries.map(mirroredLine),
    },
  } as never) as EventEnvelope;

  const mirrored = await options.hub.mirror(request.communityKey, event);
  if (mirrored === undefined) {
    return err(
      "mirror_failed",
      "The posting is in the books but could not be written to the record. Retry it.",
    );
  }
  return { ok: true, value: { receipt: posted.value, mirrored } };
}
