// The Node's signed pool route (story 4.6):
//
//   GET /communities/:key/pool   the pool as the books hold it, the record's reading beside it, and the caller's own
//                                contribution. Members only. Each member sees their own amount and every member's
//                                status; another member's amount is never sent. A difference between the books and
//                                the record is sent as a flag with both amounts, and the books' total still shows.
//
// The request passes the request-proof gate (`signed.ts`) before anything is read, the same as the other signed routes.
// 503 with a plain sentence when the books cannot be read or are not set up: no figures are sent then.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isCommunityKey } from "@shopong/community";
import type { CapabilityAuth, CurrencyCode, Did, Ledger } from "@shopong/ports";
import { HTTP_STATUS, nodeMessage } from "./authority.ts";
import { readPool, type PoolHub } from "./pool-read.ts";
import { claimNonce, SeenNonces, verifySignedRequest, type SignedGate } from "./signed.ts";

export const BOOKS_UNREADABLE = "The books can't be read right now.";
export const NOT_A_MEMBER = "You are not a member of this community.";
export const NOT_HELD = "This Node does not hold that community.";
/** Said beside the figures whenever the Node's payments are the simulation (review item 1). */
export const SIMULATED_POOL_NOTE =
  "These figures include test payments (simulated). No real money has moved.";

export interface PoolRouteOptions {
  /** Absent when the record is off: the route then answers 503. */
  readonly hub?: PoolHub;
  /** Absent when the books are not set up on this Node: the route then answers 503. */
  readonly ledger?: Ledger;
  /** The Node's master key: member ids in the books are keyed by it. */
  readonly masterKey?: Uint8Array;
  /** The Node's identity. Only postings it wrote count as money in the record. */
  readonly nodeIdentity?: Did;
  readonly currency?: CurrencyCode;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly maxNonces?: number;
  /** True while the payments are the simulation: the answer then says so beside the figures. */
  readonly simulated?: boolean;
}

export function registerPoolRoute(
  app: FastifyInstance,
  auth: CapabilityAuth,
  options: PoolRouteOptions,
): void {
  const gate: Pick<SignedGate, "auth" | "clock"> = { auth, clock: options.now ?? Date.now };
  const nonces = new SeenNonces(options.maxNonces);
  const currency: CurrencyCode = options.currency ?? "ZAR";

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
        audit: "pool",
        outcome: "refused",
        problem,
        ...(actor === undefined ? {} : { actor }),
        requestId: request.id,
      },
      reason,
    );
    return reply.code(status).send({ problem, reason, requestId: request.id });
  };

  app.get<{ Params: { key: string } }>("/communities/:key/pool", async (request, reply) => {
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
    const { hub, ledger, masterKey, nodeIdentity } = options;
    if (hub === undefined) {
      return refuse(request, reply, 503, "record_off", "The Node record is not running.", actor);
    }

    const { key } = request.params;
    const registered = isCommunityKey(key) ? hub.registrationOf(key) : undefined;
    if (registered === undefined) return refuse(request, reply, 404, "not_held", NOT_HELD, actor);
    const member = await hub.isMember(actor, key);
    if (!member) return refuse(request, reply, 403, "not_member", NOT_A_MEMBER, actor);

    const used = claimNonce(nonces, verdict);
    if (used !== undefined) {
      return refuse(request, reply, HTTP_STATUS[used] ?? 409, used, nodeMessage(used), actor);
    }
    if (ledger === undefined || masterKey === undefined || nodeIdentity === undefined) {
      return refuse(request, reply, 503, "books_unavailable", BOOKS_UNREADABLE, actor);
    }

    try {
      const view = await readPool({
        ledger,
        hub,
        communityKey: key,
        caller: actor,
        auth,
        masterKey,
        nodeIdentity,
        currency,
      });
      request.log.info(
        { audit: "pool", outcome: "accepted", actor, requestId: request.id },
        "pool read answered",
      );
      return reply.code(200).send({
        ...view,
        requestId: request.id,
        ...(options.simulated === true
          ? { simulated: true, simulatedNote: SIMULATED_POOL_NOTE }
          : {}),
      });
    } catch (error) {
      // The reason is logged without the figures or the error text, which may name a path.
      request.log.error(
        {
          audit: "pool",
          outcome: "failed",
          actor,
          requestId: request.id,
          name: (error as Error).name,
        },
        "pool read failed",
      );
      return refuse(request, reply, 503, "books_unavailable", BOOKS_UNREADABLE, actor);
    }
  });
}
