// The app's side of a community: one in-memory record network for this run of the app, and the few
// actions the screens need. The rules live in `@shopong/community`. Nothing here is saved: closing the
// app loses the community (shortcut S-2.3-4).
import {
  INVITATION_MESSAGES,
  checkInvitation,
  coTreasurerJoinRecorded,
  createCommunity,
  type ActionRequest,
  type CheckedInvitation,
  type Community,
  type CommunityDeps,
  type CommunityError,
  type GrantOptions,
  type Invitation,
  type InvitationError,
  type Member,
  type RoleCheck,
  type RoleDraft,
  type RoleError,
  type RoleRecord,
} from "@shopong/community";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import { err, type CapabilityAuth, type Did, type EpochMs, type Result } from "@shopong/ports";

export type CommunityIdentity = { did: Did; auth: CapabilityAuth };

export type CommunityServiceOptions = {
  randomBytes: (length: number) => Uint8Array;
  now?: () => EpochMs;
  network?: MemoryRecordNetwork;
};

export type CommunityService = {
  community: () => Community | null;
  create: (name: string) => Promise<Result<Community, CommunityError>>;
  invite: (invitee: string) => Promise<Result<Invitation, InvitationError | CommunityError>>;
  /** Check pasted text on this phone with no network. Joining for real waits for epic 3. */
  check: (text: string) => Promise<Result<CheckedInvitation, InvitationError>>;
  members: () => Promise<readonly Member[]>;
  /** Give a role (the creator; a holder passes on part of theirs). */
  grant: (
    grantee: string,
    role: string,
    options: GrantOptions,
  ) => Promise<Result<RoleDraft, RoleError | CommunityError>>;
  /** The roles recorded for me. */
  roles: () => Promise<readonly RoleRecord[]>;
  /** "What can I do?" */
  checkAction: (request: ActionRequest) => Promise<Result<RoleCheck, RoleError>>;
};

export function createCommunityService(
  identity: CommunityIdentity | null,
  options: CommunityServiceOptions,
): CommunityService {
  const now = options.now ?? Date.now;
  const network = options.network ?? createMemoryRecordNetwork();
  let current: Community | null = null;
  const deps = (auth: CapabilityAuth): CommunityDeps => ({
    auth,
    sha512: webCryptoSha512,
    randomBytes: options.randomBytes,
  });

  return {
    community: () => current,
    async create(name) {
      if (identity === null) return err("refused", "Make your identity first.");
      const made = await createCommunity(
        deps(identity.auth),
        network.peer<EventEnvelope>(identity.did),
        name,
        now(),
      );
      if (made.ok) current = made.value;
      return made;
    },
    async invite(invitee) {
      if (current === null) return err("refused", "Make a community first.");
      return current.invite(invitee, now());
    },
    async check(text) {
      if (identity === null) return err("no_identity", INVITATION_MESSAGES.no_identity);
      const held = current;
      if (held !== null) await held.space.update();
      return checkInvitation({
        auth: identity.auth,
        text,
        me: identity.did,
        now: now(),
        isUsed: async (id) =>
          held !== null && (await held.space.view.get(`joined/${id}`)) !== undefined,
        mayPassOn: (inviter, parentId) =>
          held !== null && coTreasurerJoinRecorded(held.space.view, inviter, parentId, now()),
      });
    },
    members: async () => (current === null ? [] : current.members()),
    async grant(grantee, role, options) {
      if (current === null) return err("refused", "Make a community first.");
      return current.grantRole(grantee, role, options, now());
    },
    async roles() {
      return current === null ? [] : current.roles();
    },
    async checkAction(request) {
      if (current === null) return err("outside", "Your role doesn't cover that.");
      return current.checkAction(request, now());
    },
  };
}
