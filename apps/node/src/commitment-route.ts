// `POST /commitments` (story 2.7): the treasurer (the creator, or a current co-treasurer, the people who invite)
// asks the Node for the commitment of a phone or ID number. The phone sends the raw value over its signed link;
// the Node holds the community secret and answers with the commitment only. Checked in this order: the
// signature and time (shared check), then the caller's role in the record, then the per-caller limit, then the
// one-time number is recorded, then the value is committed. A refused stranger does not use up its one-time
// number (review M4). The value is never logged.

import type { FastifyInstance } from "fastify";
import { isTreasurer } from "@shopong/community";
import { z } from "zod";
import type { Commitments } from "@shopong/ports";
import type { AuthorityConfig, NodeProblem } from "./authority.ts";
import { nodeMessage } from "./authority.ts";
import type { SignedRequests } from "./signed.ts";

export const COMMITMENT_MESSAGES = {
  invalid_request: "Send a phone number or an ID number to commit.",
  not_treasurer: "Only the treasurer or a co-treasurer can ask for a commitment.",
  rate_limited: "Too many requests. Try again later.",
  no_secret: "This Node has no secret for this community yet.",
} as const;

/** At most this many commitment requests per caller in each window: 30 in ten minutes (review H3). */
export const COMMITMENT_RATE = { max: 30, windowMs: 10 * 60 * 1000 } as const;

const HTTP_STATUS: Record<string, number> = {
  invalid_request: 400,
  not_recognised: 400,
  not_treasurer: 403,
  rate_limited: 429,
  not_configured: 503,
  no_secret: 503,
  secret_too_short: 503,
  unsigned: 401,
  bad_nonce: 400,
  clock_skew: 401,
  replayed: 409,
  busy: 429,
};

const body = z.strictObject({
  kind: z.enum(["phone", "id-number"]),
  value: z.string().min(1).max(200),
});

export interface CommitmentRouteOptions {
  readonly signed: SignedRequests;
  /** Undefined when this Node has no commitments configured: the route answers `not_configured`. */
  readonly commitments: Commitments | undefined;
  /** The community this Node serves: its creator, its key and its record view for the role check. */
  readonly config: AuthorityConfig | undefined;
}

/** Registers `POST /commitments` on the app, behind the same signed-request check as `/authority/check`. */
export function registerCommitmentRoute(
  app: FastifyInstance,
  options: CommitmentRouteOptions,
): void {
  app.post("/commitments", async (request, reply) => {
    const refuse = (problem: string, reason: string, verifiedActor?: string) => {
      request.log.warn(
        {
          audit: "commitment",
          outcome: "refused",
          problem,
          ...(verifiedActor === undefined ? {} : { actor: verifiedActor }),
          requestId: request.id,
        },
        reason,
      );
      return reply
        .code(HTTP_STATUS[problem] ?? 403)
        .send({ problem, reason, requestId: request.id });
    };

    const { commitments, config } = options;
    const gate = async (actor: string): Promise<string | undefined> => {
      if (commitments === undefined || config === undefined) return "not_configured";
      const now = (config.now ?? Date.now)();
      if (!(await isTreasurer(config.view, config.creator, actor, now))) return "not_treasurer";
      if (
        !options.signed.spend("commitments", actor, COMMITMENT_RATE.max, COMMITMENT_RATE.windowMs)
      ) {
        return "rate_limited";
      }
      return undefined;
    };

    const checked = await options.signed.check(request, gate);
    if (!checked.ok) {
      const problem = checked.problem;
      const reason =
        problem === "rate_limited"
          ? COMMITMENT_MESSAGES.rate_limited
          : problem === "not_treasurer"
            ? COMMITMENT_MESSAGES.not_treasurer
            : nodeMessage(problem as NodeProblem);
      return refuse(problem, reason, checked.verifiedActor);
    }
    const actor = checked.actor;

    const parsed = body.safeParse(parseJson(request.rawBody));
    if (!parsed.success)
      return refuse("invalid_request", COMMITMENT_MESSAGES.invalid_request, actor);
    if (commitments === undefined || config === undefined) {
      return refuse("not_configured", nodeMessage("not_configured"), actor);
    }

    const result = await commitments.commit(config.spaceKey, parsed.data.kind, parsed.data.value);
    if (!result.ok) {
      if (result.error.code === "unknown_community") {
        return refuse("no_secret", COMMITMENT_MESSAGES.no_secret, actor);
      }
      return refuse(result.error.code, result.error.message, actor);
    }

    request.log.info(
      {
        audit: "commitment",
        outcome: "allowed",
        actor,
        kind: parsed.data.kind,
        requestId: request.id,
      },
      "commitment made",
    );
    return reply.code(200).send({ commitment: result.value, requestId: request.id });
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
