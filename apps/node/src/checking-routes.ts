// The treasurer's "Needs checking" list (story 4.5) and discrepancy list (story 10.3), SIMULATED payments only:
//
//   GET  /communities/:key/needs-checking                    the flags from verified webhooks and the reconciler's last
//                                                            list, for one community.
//   GET  /communities/:key/discrepancies                     every discrepancy the reconciler opened for the community,
//                                                            open ones first, each with both sides' values and the
//                                                            event id. Resolved ones stay listed with their reason.
//   POST /communities/:key/discrepancies/:id/resolve         body { "reason": "..." }: resolves one open discrepancy with
//                                                            a recorded reason. Changes nothing else.
//
// Treasurers only (the creator, or a co-treasurer whose role stands). Items with no community (a payment matching no
// pledge, or an unknown request) are shown to every treasurer, with no member's name in them.
//
// Nothing here changes a payment, the books or the record. The request passes the signature gate first, then membership,
// then the treasurer check, then the one-time number.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isCommunityKey, isTreasurer, logTimeOf } from "@shopong/community";
import type { CapabilityAuth, Did, ViewReader } from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import type { DiscrepancyStore, Discrepancy, ResolveProblem } from "./discrepancies.ts";
import type { PoolHub } from "./pool-read.ts";
import type { CheckingStore } from "./payment-confirmation.ts";
import { claimNonce, SeenNonces, verifySignedRequest, type SignedGate } from "./signed.ts";

export const NOT_TREASURER = "Only the treasurer or a co-treasurer can see the list.";
export const NOT_A_MEMBER = "You are not a member of this community.";

const RESOLVE_STATUS: Record<ResolveProblem, number> = {
  not_found: 404,
  already_resolved: 409,
  reason_required: 400,
  reason_too_long: 400,
};
const RESOLVE_WORDS: Record<ResolveProblem, string> = {
  not_found: "No discrepancy with that id is in this community's list.",
  already_resolved:
    "This discrepancy was already resolved, so its reason stays as it was recorded.",
  reason_required: "Write the reason for resolving this discrepancy before you resolve it.",
  reason_too_long: "The reason is too long. Keep it under 500 characters.",
};

export interface CheckingRouteOptions {
  readonly hub: Pick<PoolHub, "registrationOf" | "isMember" | "indexedView">;
  readonly store: CheckingStore;
  /** The discrepancy list (story 10.3). Without it, the discrepancy routes are not served. */
  readonly discrepancies?: DiscrepancyStore;
  readonly now?: () => number;
  readonly maxNonces?: number;
}

/** The reason in a resolve body, or "" when the body is not JSON or has no text reason. */
function reasonOf(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { reason?: unknown } | null;
    return typeof parsed?.reason === "string" ? parsed.reason : "";
  } catch {
    return "";
  }
}

function showDiscrepancy(d: Discrepancy) {
  return {
    id: d.id,
    kind: d.kind,
    eventId: d.eventId,
    text: d.text,
    record: d.record,
    books: d.books,
    provider: d.provider,
    openedAt: d.openedAt,
    lastSeenAt: d.lastSeenAt,
    ...(d.resolution === undefined
      ? {}
      : { resolution: { reason: d.resolution.reason, at: d.resolution.at, by: d.resolution.by } }),
  };
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

  /**
   * The gate every treasurer route passes, in order: the signature, the community and its membership, the treasurer's
   * standing, then the one-time number. Returns the refusal already sent, or the actor on success.
   */
  const treasurerGate = async (
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
  ): Promise<{ actor: Did } | { refused: true }> => {
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      await refuse(
        request,
        reply,
        HTTP_STATUS[verdict.problem] ?? 401,
        verdict.problem,
        nodeMessage(verdict.problem),
        verdict.actor,
      );
      return { refused: true };
    }
    const { actor } = verdict;
    // An unknown community and a stranger get the same answer, so the list does not reveal which communities the
    // Node holds (review item 10).
    const notMember = async () => {
      await refuse(request, reply, 403, "not_member", NOT_A_MEMBER, actor);
      return { refused: true } as const;
    };
    const registered = isCommunityKey(key) ? options.hub.registrationOf(key) : undefined;
    if (registered === undefined) return notMember();
    if (!(await options.hub.isMember(actor, key))) return notMember();
    const view: ViewReader | undefined = await options.hub.indexedView(key);
    if (view === undefined) return notMember();
    const at = Math.max(verdict.now, (await logTimeOf(view)) ?? 0);
    const standing = { auth, creator: registered.creator, spaceKey: key };
    if (!(await isTreasurer(standing, view, actor, at))) {
      await refuse(request, reply, 403, "not_treasurer", NOT_TREASURER, actor);
      return { refused: true };
    }
    const used = claimNonce(nonces, verdict);
    if (used !== undefined) {
      await refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
      return { refused: true };
    }
    return { actor };
  };

  const mine = (communityKey: string | undefined, key: string) =>
    communityKey === undefined || communityKey === key;

  app.get<{ Params: { key: string } }>(
    "/communities/:key/needs-checking",
    async (request, reply) => {
      const { key } = request.params;
      const gated = await treasurerGate(request, reply, key);
      if ("refused" in gated) return reply;
      const { actor } = gated;
      const flags = options.store
        .flags()
        .filter((f) => mine(f.communityKey, key))
        .map((f) => ({ kind: f.kind, text: f.text, at: f.at }));
      const checking = options.store.checking();
      const reconciled = checking.items
        .filter((item) => mine(item.communityKey, key))
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

  if (options.discrepancies === undefined) return;
  const discrepancies = options.discrepancies;

  app.get<{ Params: { key: string } }>(
    "/communities/:key/discrepancies",
    async (request, reply) => {
      const { key } = request.params;
      const gated = await treasurerGate(request, reply, key);
      if ("refused" in gated) return reply;
      const { actor } = gated;
      const own = discrepancies.list().filter((d) => mine(d.communityKey, key));
      request.log.info(
        {
          audit: "discrepancies",
          simulated: true,
          outcome: "accepted",
          actor,
          requestId: request.id,
        },
        "discrepancy list read (simulated)",
      );
      return reply.code(200).send({
        simulated: true,
        open: own.filter((d) => d.resolution === undefined).map(showDiscrepancy),
        resolved: own.filter((d) => d.resolution !== undefined).map(showDiscrepancy),
        requestId: request.id,
      });
    },
  );

  app.post<{ Params: { key: string; id: string } }>(
    "/communities/:key/discrepancies/:id/resolve",
    async (request, reply) => {
      const { key, id } = request.params;
      const gated = await treasurerGate(request, reply, key);
      if ("refused" in gated) return reply;
      const { actor } = gated;
      const target = discrepancies.list().find((d) => d.id === id);
      // A discrepancy of another community is reported as not found, as an unknown one is.
      const reason = reasonOf(request.rawBody);
      const result =
        target === undefined || !mine(target.communityKey, key)
          ? ({ ok: false, problem: "not_found" } as const)
          : discrepancies.resolve(id, reason, actor, (options.now ?? Date.now)());
      if (!result.ok) {
        return refuse(
          request,
          reply,
          RESOLVE_STATUS[result.problem],
          result.problem,
          RESOLVE_WORDS[result.problem],
          actor,
        );
      }
      request.log.info(
        {
          audit: "discrepancies",
          simulated: true,
          outcome: "resolved",
          actor,
          requestId: request.id,
        },
        "discrepancy resolved with a reason (simulated)",
      );
      return reply
        .code(200)
        .send({ simulated: true, item: showDiscrepancy(result.item), requestId: request.id });
    },
  );
}
