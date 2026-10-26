// The Node's signed community routes (story 3.4). Both pass the request-proof gate (`signed.ts`) before they read
// the body, as the sync routes do.
//
//   POST /communities             create a community on the Node's record, register the caller as its creator,
//                                 and say so. The caller chooses the key (64 hex) and sends the founding
//                                 `member.joined` next through `POST /spaces/:key/events`. Each creator may hold
//                                 `COMMUNITY_LIMIT` communities; the same key again from the same creator is a
//                                 success with `duplicate: true`.
//   POST /communities/:key/members  admit the caller as a member, when the invitation text checks out against the
//                                 Node's own view of the community (`checkInvitation`). The phone then sends
//                                 `member.joined` through the events route.
//
// Refusals carry a plain `reason` and a `problem`, and are audit-logged with the request id. Neither the
// invitation text nor the signature is logged.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  checkInvitation,
  coTreasurerJoinRecorded,
  INVITATION_MESSAGES,
  isCommunityKey,
  isCurrentGrantIn,
} from "@shopong/community";
import type { CapabilityAuth, Did, ViewReader } from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import type { CommunityReservation } from "./hub.ts";
import {
  claimNonce,
  SeenNonces,
  verifySignedRequest,
  type SignedGate,
  type SignedProblem,
} from "./signed.ts";

/** How many communities one creator may hold on this Node. */
export const COMMUNITY_LIMIT = 3;

/** The part of the replica hub these routes use. `ReplicaHub` implements it. */
export interface CommunityHub {
  reserveCommunity(creator: Did, communityKey: string, limit: number): CommunityReservation;
  releaseCommunity(communityKey: string): void;
  createCommunity(communityKey: string, creator: Did): Promise<string>;
  registrationOf(communityKey: string): { spaceKey: string; creator: Did } | undefined;
  indexedView(communityKey: string): Promise<ViewReader | undefined>;
  admitMember(communityKey: string, did: Did): Promise<void>;
}

export interface CommunityRouteOptions {
  readonly hub: CommunityHub;
  readonly auth: CapabilityAuth;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly maxNonces?: number;
  readonly limit?: number;
  /** DIDs allowed to create communities. Empty means open (local development only). Checked first (review N1). */
  readonly allowedCreators?: readonly string[];
  /** Each route's own one-time-number table size (review N2). */
  readonly nonces?: { readonly create?: number; readonly members?: number };
  /** Called after a community is made (story 4.5: its books' chart is configured then). A failure is logged, not fatal. */
  readonly onCreated?: (communityKey: string) => Promise<void>;
}

const COUNT_WORDS = ["none", "one", "two", "three", "four", "five"];

const COMMUNITY_MESSAGES = {
  invalid_request: "The request is not in the form the Node expects.",
  community_limit: `You already have ${COUNT_WORDS[COMMUNITY_LIMIT] ?? String(COMMUNITY_LIMIT)} communities on this Node, which is the most one person can make.`,
  community_exists: "That community key is already used on this Node by someone else.",
  not_allowed: "This Node is not open to new communities from this account.",
  node_full: "This Node has reached the most communities it will host.",
  not_held: "This Node does not hold that community.",
  removed: "You were taken out of this community. Ask the treasurer for a new invitation.",
} as const;

/** The invitation text the phone sends: the link or code it was given. */
function invitationOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const text = (body as { invitation?: unknown }).invitation;
  return typeof text === "string" && text.length > 0 && text.length <= 4096 ? text : undefined;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function registerCommunityRoutes(
  app: FastifyInstance,
  options: CommunityRouteOptions,
): void {
  const { hub, auth } = options;
  const limit = options.limit ?? COMMUNITY_LIMIT;
  const gate: Pick<SignedGate, "auth" | "clock"> = { auth, clock: options.now ?? Date.now };
  // Each route has its own table, so a flood on one cannot starve the other (review N2).
  const createNonces = new SeenNonces(options.nonces?.create ?? options.maxNonces);
  const memberNonces = new SeenNonces(options.nonces?.members ?? options.maxNonces);
  const allowed = options.allowedCreators ?? [];

  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    status: number,
    problem: string,
    reason: string,
    actor?: Did,
  ) => {
    request.log.warn(
      {
        audit: "community",
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      reason,
    );
    return reply.code(status).send({ problem, reason, requestId: request.id });
  };

  const refuseSigned = (
    request: FastifyRequest,
    reply: FastifyReply,
    problem: SignedProblem,
    actor?: Did,
  ) => refuse(request, reply, HTTP_STATUS[problem] ?? 401, problem, nodeMessage(problem), actor);

  app.post("/communities", async (request, reply) => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) return refuseSigned(request, reply, verdict.problem, verdict.actor);
    const { actor } = verdict;
    // The allow-list comes before the one-time number is claimed and before any store is touched (review N1).
    if (allowed.length > 0 && !allowed.includes(actor)) {
      return refuse(request, reply, 403, "not_allowed", COMMUNITY_MESSAGES.not_allowed, actor);
    }
    const body = parseBody(request.rawBody);
    const key =
      typeof body === "object" && body !== null ? (body as { key?: unknown }).key : undefined;
    if (!isCommunityKey(key)) {
      return refuse(
        request,
        reply,
        400,
        "invalid_request",
        COMMUNITY_MESSAGES.invalid_request,
        actor,
      );
    }

    const reserved = hub.reserveCommunity(actor, key, limit);
    if (reserved === "duplicate") {
      const registered = hub.registrationOf(key);
      const used = claimNonce(createNonces, verdict);
      if (used !== undefined)
        return refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
      return reply.code(200).send({
        key,
        spaceKey: registered?.spaceKey,
        duplicate: true,
        requestId: request.id,
      });
    }
    if (reserved === "taken") {
      return refuse(
        request,
        reply,
        409,
        "community_exists",
        COMMUNITY_MESSAGES.community_exists,
        actor,
      );
    }
    if (reserved === "node_full") {
      return refuse(request, reply, 403, "node_full", COMMUNITY_MESSAGES.node_full, actor);
    }
    if (reserved === "limit") {
      return refuse(
        request,
        reply,
        403,
        "community_limit",
        COMMUNITY_MESSAGES.community_limit,
        actor,
      );
    }
    const used = claimNonce(createNonces, verdict);
    if (used !== undefined) {
      hub.releaseCommunity(key);
      return refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
    }

    const spaceKey = await hub.createCommunity(key, actor);
    if (options.onCreated !== undefined) {
      await options.onCreated(key).catch((error: unknown) => {
        request.log.warn(
          {
            audit: "community",
            action: "books",
            name: (error as Error).name,
            requestId: request.id,
          },
          "the books' chart could not be set up for a new community; postings set it up before they post",
        );
      });
    }
    request.log.info(
      { audit: "community", outcome: "accepted", action: "create", actor, requestId: request.id },
      "community created",
    );
    return reply.code(200).send({ key, spaceKey, duplicate: false, requestId: request.id });
  });

  app.post<{ Params: { key: string } }>("/communities/:key/members", async (request, reply) => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) return refuseSigned(request, reply, verdict.problem, verdict.actor);
    const { actor } = verdict;
    const { key } = request.params;
    const registered = isCommunityKey(key) ? hub.registrationOf(key) : undefined;
    if (registered === undefined) {
      return refuse(request, reply, 404, "not_held", COMMUNITY_MESSAGES.not_held, actor);
    }
    const text = invitationOf(parseBody(request.rawBody));
    if (text === undefined) {
      return refuse(
        request,
        reply,
        400,
        "invalid_request",
        COMMUNITY_MESSAGES.invalid_request,
        actor,
      );
    }

    // The Node checks the invitation against its own view, not the phone's word for it.
    const view = await hub.indexedView(key);
    if (view === undefined)
      return refuse(request, reply, 404, "not_held", COMMUNITY_MESSAGES.not_held, actor);
    const now = gate.clock();
    const checked = await checkInvitation({
      auth,
      text,
      me: actor,
      now,
      isUsed: async (id) => (await view.get(`joined/${id}`)) !== undefined,
      mayPassOn: (inviter, parentId) => coTreasurerJoinRecorded(view, inviter, parentId, now),
      isCurrentGrant: (holder, id) => isCurrentGrantIn(view, holder, id),
    });
    if (!checked.ok) {
      return refuse(request, reply, 403, "bad_invitation", checked.error.message, actor);
    }
    if (checked.value.spaceKey !== key || checked.value.creator !== registered.creator) {
      return refuse(request, reply, 403, "bad_invitation", INVITATION_MESSAGES.unreadable, actor);
    }
    // A person the record shows as removed is not admitted again by an old invitation: only a fresh invitation clears
    // the mark (story 3.3). It is read from the same view as the invitation, so both see the same record.
    if ((await view.get(`removed/${actor}`)) !== undefined) {
      return refuse(request, reply, 403, "removed", COMMUNITY_MESSAGES.removed, actor);
    }

    const used = claimNonce(memberNonces, verdict);
    if (used !== undefined)
      return refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
    await hub.admitMember(key, actor);
    request.log.info(
      { audit: "community", outcome: "accepted", action: "admit", actor, requestId: request.id },
      "member admitted",
    );
    return reply.code(200).send({ key, admitted: true, requestId: request.id });
  });
}
