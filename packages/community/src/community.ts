// A community on a shared record, from one person's phone: create it, invite a person, join with an
// invitation, list the members. The record is any `SharedRecord`; the app uses the in-memory one.

import {
  createEvent,
  eventIdOf,
  type EventEnvelope,
  type EventType,
  type JsonObject,
  type Sha512,
} from "@shopong/events";
import {
  err,
  ok,
  type CapabilityAuth,
  type Did,
  type EpochMs,
  type JsonValue,
  type PortError,
  type Result,
  type SharedRecord,
  type Space,
  type SpaceDefinition,
} from "@shopong/ports";
import { createCommunityApply, FOUNDER_INVITATION } from "./apply.js";
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

/** The definition (apply + event id) every phone of one community uses. */
export function communityDefinition(
  deps: Pick<CommunityDeps, "auth" | "sha512">,
  creator: Did,
  spaceKey: string,
): SpaceDefinition<EventEnvelope> {
  return {
    apply: createCommunityApply({ auth: deps.auth, creator, spaceKey }),
    eventId: (event) => eventIdOf(event, deps.sha512),
  };
}

export interface Member {
  readonly did: Did;
  readonly joinedAt: EpochMs;
}

export type CommunityError = PortError<"empty_name" | "refused" | "not_creator">;

export const EMPTY_NAME_MESSAGE = "Give your community a name.";

function field(value: JsonValue, key: string): JsonValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })[key]
    : undefined;
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
  const receipt = await space.append(event);
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
  readonly space: Space<EventEnvelope>;
  /** Invite a person by their full DID. Only the creator can. */
  invite(
    invitee: string,
    now: EpochMs,
  ): Promise<Result<Invitation, InvitationError | CommunityError>>;
  members(): Promise<readonly Member[]>;
}

function wrap(
  deps: CommunityDeps,
  me: Did,
  key: string,
  name: string,
  creator: Did,
  space: Space<EventEnvelope>,
): Community {
  return {
    key,
    name,
    creator,
    space,
    async invite(invitee, now) {
      if (me !== creator) return err("not_creator", "Only the creator can invite.");
      const issued = await issueInvitation({
        auth: deps.auth,
        creator,
        spaceKey: key,
        invitee,
        now,
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

/** Make a community with me as its creator and only member. */
export async function createCommunity(
  deps: CommunityDeps,
  record: SharedRecord<EventEnvelope>,
  name: string,
  now: EpochMs,
): Promise<Result<Community, CommunityError>> {
  const trimmed = name.trim();
  if (trimmed === "") return err("empty_name", EMPTY_NAME_MESSAGE);
  const key = newCommunityKey(deps.randomBytes);
  const creator = record.local;
  const space = await record.create(communityDefinition(deps, creator, key));
  const founded = await append(
    deps,
    space,
    key,
    "member.joined",
    { invitation: FOUNDER_INVITATION },
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
