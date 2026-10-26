// `POST /commitments` (story 2.7): the treasurer (the creator, or a current co-treasurer, the people who invite)
// asks the Node for the commitment of a phone or ID number. The phone sends the raw value over its signed link;
// the Node holds the community secret and answers with the commitment only. The order is the signed-request
// split of story 3.5: verify the signature and the time, then the treasurer's role and the per-caller limit,
// and only then claim the one-time number. A stranger with a valid key cannot use up the table (review M4).
// The value is never logged.

import type { FastifyInstance } from "fastify";
import { isTreasurer, logTimeOf } from "@shopong/community";
import { z } from "zod";
import type { CapabilityAuth, Commitments } from "@shopong/ports";
import { nodeMessage, type AuthorityConfig, type NodeProblem } from "./authority.ts";
import {
  claimNonce,
  DEFAULT_MAX_NONCES,
  FixedWindows,
  SeenNonces,
  verifySignedRequest,
} from "./signed.ts";

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
  /** Verifies the signature and the capability chains of the caller. */
  readonly auth: CapabilityAuth;
  /** Undefined when this Node has no commitments configured: the route answers `not_configured`. */
  readonly commitments: Commitments | undefined;
  /** The community this Node serves: its creator, its key, its record view and the Node's clock. */
  readonly config: AuthorityConfig | undefined;
}

/** Registers `POST /commitments` on the app. Always registered: without a configured Node it answers 503. */
export function registerCommitmentRoute(
  app: FastifyInstance,
  options: CommitmentRouteOptions,
): void {
  const { commitments, config } = options;
  const clock = config?.now ?? Date.now;
  const gate = { auth: options.auth, clock };
  const nonces = new SeenNonces(config?.maxNonces ?? DEFAULT_MAX_NONCES);
  const limits = new FixedWindows(clock);

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

    // 1. The signature and the time. Nothing is claimed yet.
    const verdict = await verifySignedRequest(gate, request);
    if (!verdict.ok) {
      const reason = nodeMessage(verdict.problem as NodeProblem);
      return refuse(verdict.problem, reason, verdict.actor);
    }
    const actor = verdict.actor;

    // 2. The treasurer's role in the record, and the per-caller limit. Only a treasurer's request is counted.
    if (commitments === undefined || config === undefined) {
      return refuse("not_configured", nodeMessage("not_configured"), actor);
    }
    // Judged at the later of the record's log time and the Node's clock, as the authority check is (story 3.6).
    const at = Math.max(verdict.now, (await logTimeOf(config.view)) ?? 0);
    const standing = { auth: options.auth, creator: config.creator, spaceKey: config.spaceKey };
    if (!(await isTreasurer(standing, config.view, actor, at))) {
      return refuse("not_treasurer", COMMITMENT_MESSAGES.not_treasurer, actor);
    }
    if (!limits.spend("commitments", actor, COMMITMENT_RATE.max, COMMITMENT_RATE.windowMs)) {
      return refuse("rate_limited", COMMITMENT_MESSAGES.rate_limited, actor);
    }

    // 3. Only now is the one-time number recorded.
    const used = claimNonce(nonces, verdict);
    if (used !== undefined) return refuse(used, nodeMessage(used as NodeProblem), actor);

    // 4. The value, committed with the community's secret.
    const parsed = body.safeParse(parseJson(request.rawBody));
    if (!parsed.success)
      return refuse("invalid_request", COMMITMENT_MESSAGES.invalid_request, actor);

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
