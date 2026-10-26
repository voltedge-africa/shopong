// The treasurer's "Needs checking" list (story 4.5), SIMULATED payments only:
//
//   GET /communities/:key/needs-checking   the flags from verified webhooks and the reconciler's last list, for one
//                                          community. Treasurers only (the creator, or a co-treasurer whose role
//                                          stands). Items with no community (a payment matching no pledge, or an
//                                          unknown request) are shown to every treasurer, with no member's name in them.
//
// Nothing here changes a payment, the books or the record. The list is the whole of the response's content.
// The request passes the signature gate first, then membership, then the treasurer check, then the one-time number.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isCommunityKey, isTreasurer, logTimeOf } from "@shopong/community";
import type { CapabilityAuth, Did, ViewReader } from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import type { PoolHub } from "./pool-read.ts";
import type { CheckingStore } from "./payment-confirmation.ts";
import { claimNonce, SeenNonces, verifySignedRequest, type SignedGate } from "./signed.ts";

export const NOT_TREASURER = "Only the treasurer or a co-treasurer can see the list.";
export const NOT_A_MEMBER = "You are not a member of this community.";

export interface CheckingRouteOptions {
  readonly hub: Pick<PoolHub, "registrationOf" | "isMember" | "indexedView">;
  readonly store: CheckingStore;
  readonly now?: () => number;
  readonly maxNonces?: number;
}

export function registerCheckingRoute(
  app: FastifyInstance,
  auth: CapabilityAuth,
  options: CheckingRouteOptions,
): void {
  const gate: Pick<SignedGate, "auth" | "clock"> = { auth, clock: options.now ?? Date.now };
  const nonces = new SeenNonces(options.maxNonces);

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
        audit: "payment_checking",
        simulated: true,
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      `${reason} (simulated)`,
    );
    // Every refusal names the simulation (review item 9).
    return reply
      .code(status)
      .send({ simulated: true, problem, reason: `${reason} (simulated)`, requestId: request.id });
  };

  app.get<{ Params: { key: string } }>(
    "/communities/:key/needs-checking",
    async (request, reply) => {
      const verdict = await verifySignedRequest(gate, request);
      if (!verdict.ok) {
        return refuse(
          request,
          reply,
          HTTP_STATUS[verdict.problem] ?? 401,
          verdict.problem,
          nodeMessage(verdict.problem),
          verdict.actor,
        );
      }
      const { actor } = verdict;
      const { key } = request.params;
      // An unknown community and a stranger get the same answer, so the list does not reveal which communities the
      // Node holds (review item 10).
      const notMember = () => refuse(request, reply, 403, "not_member", NOT_A_MEMBER, actor);
      const registered = isCommunityKey(key) ? options.hub.registrationOf(key) : undefined;
      if (registered === undefined) return notMember();
      if (!(await options.hub.isMember(actor, key))) return notMember();
      const view: ViewReader | undefined = await options.hub.indexedView(key);
      if (view === undefined) return notMember();
      const at = Math.max(verdict.now, (await logTimeOf(view)) ?? 0);
      const standing = { auth, creator: registered.creator, spaceKey: key };
      if (!(await isTreasurer(standing, view, actor, at))) {
        return refuse(request, reply, 403, "not_treasurer", NOT_TREASURER, actor);
      }
      const used = claimNonce(nonces, verdict);
      if (used !== undefined) {
        return refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
      }

      const mine = (communityKey: string | undefined) =>
        communityKey === undefined || communityKey === key;
      const flags = options.store
        .flags()
        .filter((f) => mine(f.communityKey))
        .map((f) => ({ kind: f.kind, text: f.text, at: f.at }));
      const checking = options.store.checking();
      const reconciled = checking.items
        .filter((item) => mine(item.communityKey))
        .map((item) => ({ kind: item.kind, text: item.text }));
      request.log.info(
        {
          audit: "payment_checking",
          simulated: true,
          outcome: "accepted",
          actor,
          requestId: request.id,
        },
        "needs-checking list read (simulated)",
      );
      return reply.code(200).send({
        simulated: true,
        flags,
        reconciled,
        checkedAt: checking.checkedAt ?? null,
        requestId: request.id,
      });
    },
  );
}
