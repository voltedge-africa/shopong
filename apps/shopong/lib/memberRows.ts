// The rows of the member list on the Settings card (story 8.1). The creator started the community and is its treasurer,
// so the row says that rather than "no role": the creator is not given a role, and holds every ability from the start.
import type { HeldRole, Member } from "@shopong/community";

/** What the creator's row says. Plain words: the person started the community and is its treasurer. */
export const CREATOR_NOTE = "Started this community (treasurer)";

/** What a member's row says when no role has been given to them. */
export const NO_ROLE_NOTE = "No role given yet";

export interface MemberRow {
  readonly did: string;
  /** The muted line under the member, or `undefined` when there is nothing to say beyond the roles. */
  readonly note: string | undefined;
  /** The roles given to this member, ended ones included, each with its end date. */
  readonly roles: readonly HeldRole[];
}

/**
 * One row per member, in the record's order. The creator gets the treasurer note; every other member with no role gets
 * "No role given yet". A creator is only known once the phone has it; until then no note is guessed.
 */
export function memberRowsOf(input: {
  readonly members: readonly Member[];
  readonly roleHolders: readonly HeldRole[];
  readonly creator: string | undefined;
}): MemberRow[] {
  return input.members.map((member) => {
    const roles = input.roleHolders.filter((record) => record.holder === member.did);
    const isCreator = input.creator !== undefined && member.did === input.creator;
    const note = isCreator ? CREATOR_NOTE : roles.length === 0 ? NO_ROLE_NOTE : undefined;
    return { did: member.did, note, roles };
  });
}
