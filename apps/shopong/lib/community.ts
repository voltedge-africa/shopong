// The app's side of a community: one in-memory record network for this run of the app, and the few
// actions the screens need. The rules live in `@shopong/community`. Nothing here is saved: closing the
// app loses the community (shortcut S-2.3-4).
import {
  INVITATION_MESSAGES,
  checkInvitation,
  coTreasurerJoinRecorded,
  isCurrentGrantIn,
  isRevokedIn,
  logTimeOf,
  createCommunity,
  type ActionRequest,
  type CheckedInvitation,
  type Community,
  type CommunityDeps,
  type CommunityError,
  type GrantOptions,
  type HeldRole,
  type Invitation,
  type InvitationError,
  type Member,
  type Quote,
  type QuoteError,
  type QuoteReceipt,
  type RoleCheck,
  type RoleDraft,
  type RoleError,
  type RoleRecord,
  OrderError,
  OrderReceipt,
  StoredOrder,
} from "@shopong/community";
import { createMemoryRecordNetwork, type MemoryRecordNetwork } from "@shopong/adapters-memory";
import { addRefusal, type DeliveryPlan, type PlanError, type Refusal } from "@shopong/community";
import { webCryptoSha512, type EventEnvelope } from "@shopong/events";
import {
  err,
  type CapabilityAuth,
  type Did,
  type EpochMs,
  type PortError,
  type Result,
} from "@shopong/ports";

export type CommunityIdentity = { did: Did; auth: CapabilityAuth };

export type CommunityServiceOptions = {
  randomBytes: (length: number) => Uint8Array;
  now?: () => EpochMs;
  network?: MemoryRecordNetwork;
};

export type CommunityService = {
  community: () => Community | null;
  /** `key` is the community key; the app passes the key the Node registered (story 3.4). */
  create: (
    name: string,
    key?: string,
    approvals?: number,
    rules?: string,
  ) => Promise<Result<Community, CommunityError>>;
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
  /** Every role recorded in the community, with its holder: what every member sees (story 8.1). */
  roleHolders: () => Promise<readonly HeldRole[]>;
  /** "What can I do?" */
  checkAction: (request: ActionRequest) => Promise<Result<RoleCheck, RoleError>>;
  /** Record a typed quote (story 6.8). Only the treasurer can. */
  addQuote: (input: unknown) => Promise<Result<QuoteReceipt, QuoteError>>;
  /** The driver whose role stands on the record's clock, judged as the record judges it (patch of story 7.4). */
  currentDriver: (now: number) => Promise<string | undefined>;
  /** Records an order's planned route (story 7.4): place ids and the fingerprint, queued like every other event. */
  planDelivery: (plan: DeliveryPlan) => Promise<Result<unknown, PlanError>>;
  /** The quotes recorded for one order. */
  quotesFor: (order: string) => Promise<readonly Quote[]>;
  /** Propose a bulk order (story 8.2). Any member can; the record judges it at its log time. */
  proposeOrder: (input: unknown) => Promise<Result<OrderReceipt, OrderError>>;
  /** Approve a proposed order by its event id (story 8.2). Only the treasurer can. */
  approveOrder: (id: string) => Promise<Result<OrderReceipt, OrderError>>;
  /** The orders on the record, as this phone's copy holds them. */
  orders: () => Promise<readonly StoredOrder[]>;
  /** The last refusals on this phone, newest first (story 2.5). Kept on the device only. */
  refusals: () => readonly Refusal[];
};

export function createCommunityService(
  identity: CommunityIdentity | null,
  options: CommunityServiceOptions,
): CommunityService {
  const now = options.now ?? Date.now;
  const network = options.network ?? createMemoryRecordNetwork();
  let current: Community | null = null;
  let log: readonly Refusal[] = [];
  /** Every refusal a person is shown is also kept here, on this phone, with the device clock. */
  const logged = <T extends { ok: boolean }>(action: string, result: T): T => {
    if (!result.ok) {
      const error = (result as unknown as { error: PortError }).error;
      log = addRefusal(log, { at: now(), action, reason: error.message });
    }
    return result;
  };
  const deps = (auth: CapabilityAuth): CommunityDeps => ({
    auth,
    sha512: webCryptoSha512,
    randomBytes: options.randomBytes,
  });

  return {
    community: () => current,
    async create(name, key, approvals, rules) {
      if (identity === null)
        return logged("Make a community", err("refused", "Make your identity first."));
      const made = await createCommunity(
        deps(identity.auth),
        network.peer<EventEnvelope>(identity.did),
        name,
        now(),
        key,
        approvals,
        rules,
      );
      if (made.ok) current = made.value;
      return logged("Make a community", made);
    },
    async invite(invitee) {
      if (current === null)
        return logged("Invite a person", err("refused", "Make a community first."));
      return logged("Invite a person", await current.invite(invitee, now()));
    },
    async check(text) {
      if (identity === null) {
        return logged("Check an invitation", err("no_identity", INVITATION_MESSAGES.no_identity));
      }
      const held = current;
      if (held !== null) await held.space.update();
      return logged(
        "Check an invitation",
        await checkInvitation({
          auth: identity.auth,
          text,
          me: identity.did,
          now: now(),
          isUsed: async (id) =>
            held !== null && (await held.space.view.get(`joined/${id}`)) !== undefined,
          // Pass-on and grant checks run at log time, as `apply` runs them (story 3.6). The invitation's own
          // end is still checked with the device clock (S-2.3-7).
          mayPassOn: async (inviter, parentId) =>
            held !== null &&
            coTreasurerJoinRecorded(
              held.space.view,
              inviter,
              parentId,
              (await logTimeOf(held.space.view)) ?? 0,
            ),
          isCurrentGrant: (holder, id) =>
            held !== null && isCurrentGrantIn(held.space.view, holder, id),
          isRevoked: (id) => held !== null && isRevokedIn(held.space.view, id),
        }),
      );
    },
    members: async () => (current === null ? [] : current.members()),
    async grant(grantee, role, options) {
      if (current === null) return logged("Give a role", err("refused", "Make a community first."));
      return logged("Give a role", await current.grantRole(grantee, role, options, now()));
    },
    async roles() {
      return current === null ? [] : current.roles();
    },
    async roleHolders() {
      return current === null ? [] : current.roleHolders();
    },
    async checkAction(request) {
      if (current === null) {
        return logged("What can I do?", err("outside", "Your role doesn't cover that."));
      }
      return logged("What can I do?", await current.checkAction(request));
    },
    async currentDriver(now) {
      return current === null ? undefined : current.currentDriver(now);
    },
    async planDelivery(plan) {
      if (current === null)
        return logged("Plan a route", err("refused", "Make a community first."));
      return logged("Plan a route", await current.planDelivery(plan, now()));
    },
    async addQuote(input) {
      if (current === null) return logged("Add a quote", err("refused", "Make a community first."));
      return logged("Add a quote", await current.addQuote(input, now()));
    },
    async quotesFor(order) {
      return current === null ? [] : current.quotesFor(order);
    },
    async proposeOrder(input) {
      if (current === null)
        return logged("Propose an order", err("refused", "Make a community first."));
      return logged("Propose an order", await current.proposeOrder(input, now()));
    },
    async approveOrder(id) {
      if (current === null)
        return logged("Approve an order", err("refused", "Make a community first."));
      return logged("Approve an order", await current.approveOrder(id, now()));
    },
    async orders() {
      return current === null ? [] : current.orders();
    },
    refusals: () => log,
  };
}
