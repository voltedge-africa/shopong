// The OCN Node's check of authority (story 2.5). A caller must first prove it holds its identity key
// (a signature over the request, see `@shopong/community` request-proof). The Node refuses a request
// whose one-time number, signature, time or replay fails before it looks at any capability. Then it checks
// the token with its own clock (the same `verifyAuthority` the phone and the record use), and every grant
// the chain goes through against the record as it now stands (review finding 1).
//
// Refusals are audit-logged with the reason and the request id. The actor is logged as verified only after
// the signature passes; before that, the claimed value is logged truncated, under `claimedActor`.
// Signatures and tokens are never logged (`redact.ts`).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  REQUEST_SKEW_MS,
  formatDay,
  formatRand,
  isCurrentGrantIn,
  isRequestNonce,
  rolesOf,
  verifyAuthority,
  verifyRequestSignature,
  type AuthorityProblem,
  type RequestParts,
} from "@shopong/community";
import { webCryptoSha512 } from "@shopong/events";
import {
  type CapabilityAuth,
  type CapabilityToken,
  type Did,
  type EpochMs,
  type Money,
  type Signature,
  type ViewReader,
} from "@shopong/ports";

/** The community this Node checks against. Its record view is injected until the Node reads it (story 3.2). */
export interface AuthorityConfig {
  readonly creator: Did;
  readonly spaceKey: string;
  readonly view: ViewReader;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => EpochMs;
  /** How many one-time numbers are held at once. Default 10,000. */
  readonly maxNonces?: number;
}

/** A one-time number is remembered for twice the skew: a request time within skew can be up to that late. */
const NONCE_MEMORY_MS = 2 * REQUEST_SKEW_MS;
const DEFAULT_MAX_NONCES = 10_000;
/** The most of a claimed actor value that is written to the log. */
const CLAIMED_ACTOR_LOG_LIMIT = 80;

/** Why the Node refused a request. The first group is about the request, the second about the capability. */
export type NodeProblem =
  | "unsigned"
  | "bad_nonce"
  | "clock_skew"
  | "replayed"
  | "busy"
  | "invalid_request"
  | "not_configured"
  | AuthorityProblem;

const NODE_MESSAGES: {
  readonly [P in Exclude<NodeProblem, "ended" | "not_started" | "over_limit">]: string;
} = {
  unsigned: "This request isn't signed by the person it names.",
  bad_nonce: "The request's one-time number is not well formed.",
  clock_skew: "Check your phone's clock.",
  replayed: "That request was already used.",
  busy: "The Node is busy. Try again in a moment.",
  invalid_request: "Send the capability you need, and the proof of your role.",
  not_configured: "This Node has no community to check against yet.",
  missing_proof: "Send the proof of your role with the request.",
  tampered: "This proof can't be checked.",
  not_yours: "This role isn't yours.",
  outside: "Your role doesn't cover that.",
  not_current: "Your role doesn't cover that.",
  revoked: "This role has been taken back.",
};

/** The plain sentence for a refusal. `at` is the day for `ended` and `not_started`; `limit` for `over_limit`. */
export function nodeMessage(
  problem: NodeProblem,
  detail: { readonly at?: EpochMs; readonly limit?: Money } = {},
): string {
  if (problem === "ended") return `Your role ended on ${formatDay(detail.at ?? 0)}.`;
  if (problem === "not_started") return `Your role starts on ${formatDay(detail.at ?? 0)}.`;
  if (problem === "over_limit")
    return `That is above your limit of ${formatRand(detail.limit ?? { currency: "ZAR", minor: 0 })}.`;
  return NODE_MESSAGES[problem];
}

const HTTP_STATUS: { readonly [P in NodeProblem]?: number } = {
  unsigned: 401,
  bad_nonce: 400,
  clock_skew: 401,
  replayed: 409,
  busy: 429,
  invalid_request: 400,
  not_configured: 503,
};

const checkBody = z.strictObject({
  token: z.string().min(1).optional(),
  required: z.strictObject({
    with: z.string().min(1),
    can: z.string().min(1),
    ceiling: z
      .strictObject({ currency: z.string().length(3), minor: z.number().int().nonnegative() })
      .optional(),
  }),
});

declare module "fastify" {
  interface FastifyRequest {
    /** The body as text, exactly as it was signed. */
    rawBody: string;
  }
}

export interface AuthorityGuard {
  /** Registers the signed `POST /authority/check` route on the app. */
  register(app: FastifyInstance): void;
}

/**
 * The one-time numbers seen recently. A `Map` iterates in insertion order and every entry lives the same
 * length of time, so expired entries are always at the front: pruning drops from the front and stops at
 * the first live one, which is amortised constant work per request. Full means refuse, never evict live ones.
 */
class SeenNonces {
  readonly #entries = new Map<string, EpochMs>();
  readonly #max: number;

  constructor(max: number) {
    this.#max = max;
  }

  /** `new` when recorded, `replayed` when already seen and still remembered, `full` when no room is left. */
  offer(key: string, now: EpochMs): "new" | "replayed" | "full" {
    for (const [oldKey, expiresAt] of this.#entries) {
      if (expiresAt > now) break;
      this.#entries.delete(oldKey);
    }
    if (this.#entries.has(key)) return "replayed";
    if (this.#entries.size >= this.#max) return "full";
    this.#entries.set(key, now + NONCE_MEMORY_MS);
    return "new";
  }
}

/**
 * Builds the authority guard. `auth` verifies signatures and capability chains (`did:key` only, no network).
 * Without `config` the route still checks signatures and then answers `not_configured`.
 */
export function createAuthorityGuard(options: {
  auth: CapabilityAuth;
  config: AuthorityConfig | undefined;
}): AuthorityGuard {
  const { auth, config } = options;
  const nonces = new SeenNonces(config?.maxNonces ?? DEFAULT_MAX_NONCES);
  const clock = config?.now ?? Date.now;

  return {
    register(app) {
      app.decorateRequest("rawBody", "");
      app.removeContentTypeParser("application/json");
      app.addContentTypeParser<string>(
        "application/json",
        { parseAs: "string" },
        (request, body, done) => {
          // The raw text is what the caller signed, so it is kept as it arrived.
          request.rawBody = body;
          try {
            done(null, JSON.parse(body) as unknown);
          } catch {
            done(new SyntaxError("body is not JSON"), undefined);
          }
        },
      );

      app.post("/authority/check", async (request, reply) => {
        // Until the signature passes, the actor is only a claim: it is logged truncated, under another key.
        let verifiedActor: string | undefined;
        const refuse = (problem: NodeProblem, detail: { at?: EpochMs; limit?: Money } = {}) => {
          const message = nodeMessage(problem, detail);
          const status = HTTP_STATUS[problem] ?? 403;
          const who =
            verifiedActor !== undefined
              ? { actor: verifiedActor }
              : { claimedActor: truncated(header(request, "x-ocn-actor")) };
          request.log.warn(
            {
              audit: "authority.check",
              outcome: "refused",
              problem,
              ...who,
              requestId: request.id,
            },
            message,
          );
          return reply
            .code(status)
            .send({ allowed: false, problem, reason: message, requestId: request.id });
        };

        // 1. The request names a caller and carries a well-formed one-time number, a time and a signature.
        const actor = header(request, "x-ocn-actor");
        const nonce = header(request, "x-ocn-nonce");
        const signature = header(request, "x-ocn-signature");
        const time = Number(header(request, "x-ocn-time"));
        if (
          actor === undefined ||
          nonce === undefined ||
          signature === undefined ||
          !Number.isSafeInteger(time)
        ) {
          return refuse("unsigned");
        }
        if (!isRequestNonce(nonce)) return refuse("bad_nonce");

        // 2. The caller proves it holds its key. Nothing else is looked at before this.
        const parts: RequestParts = {
          method: request.method,
          path: request.url.split("?")[0] ?? request.url,
          body: request.rawBody,
          nonce,
          time,
          actor: actor as Did,
        };
        if (!(await verifyRequestSignature(auth, parts, signature as Signature, webCryptoSha512))) {
          return refuse("unsigned");
        }
        verifiedActor = actor;

        // 3. The request is recent by the Node's own clock, and its one-time number has not been used.
        const now = clock();
        if (Math.abs(time - now) > REQUEST_SKEW_MS) return refuse("clock_skew");
        const seen = nonces.offer(`${actor}\n${nonce}`, now);
        if (seen === "replayed") return refuse("replayed");
        if (seen === "full") return refuse("busy");

        // 4. The capability, checked by the Node's clock and against the record as it now stands.
        const parsed = checkBody.safeParse(parseJson(request.rawBody));
        if (!parsed.success) return refuse("invalid_request");
        if (config === undefined) return refuse("not_configured");
        const token = parsed.data.token as CapabilityToken | undefined;
        const required = {
          with: parsed.data.required.with,
          can: parsed.data.required.can,
          ...(parsed.data.required.ceiling === undefined
            ? {}
            : { ceiling: parsed.data.required.ceiling }),
        };
        const verified = await verifyAuthority(auth, token, {
          holder: actor as Did,
          rootIssuer: config.creator,
          at: now,
          required,
          isCurrentGrant: (who, id) => isCurrentGrantIn(config.view, who, id),
        });
        if (!verified.ok) {
          return refuse(verified.error.code, {
            ...(verified.error.at === undefined ? {} : { at: verified.error.at }),
            ...(verified.error.limit === undefined ? {} : { limit: verified.error.limit }),
          });
        }
        // The leaf is also a grant to the caller: it must be in the caller's record now.
        const leafId = await auth.tokenId(token as CapabilityToken);
        const current = (await rolesOf(config.view, actor)).find((record) =>
          record.grants.some((grant) => grant.id === leafId),
        );
        if (current === undefined) return refuse("not_current");

        request.log.info(
          {
            audit: "authority.check",
            outcome: "allowed",
            actor,
            requestId: request.id,
            role: current.role,
          },
          "authority allowed",
        );
        return reply.code(200).send({
          allowed: true,
          role: current.role,
          endsAt: verified.value.endsAt,
          requestId: request.id,
        });
      });
    },
  };
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function truncated(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.slice(0, CLAIMED_ACTOR_LOG_LIMIT);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
