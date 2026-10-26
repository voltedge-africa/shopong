// The signed-request check every caller-facing route of the OCN Node uses (story 2.5, shared by 2.7). A caller
// signs each request with its own key (`@shopong/community` request-proof). Before any route looks at a
// capability or a record, the Node checks: the request names a caller and carries a well-formed one-time
// number, time and signature; the signature is the caller's; and the time is within the skew of the Node's
// clock. A route may then pass a gate (for example "is this caller a treasurer?") that runs before the
// one-time number is recorded, so a stranger's request cannot fill the nonce table (review M4). Last, the
// one-time number is recorded and a replay is refused. One memory of one-time numbers is shared by every route,
// and so is the per-caller limiter (`spend`), both in memory and both held by this instance.

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  REQUEST_SKEW_MS,
  isRequestNonce,
  verifyRequestSignature,
  type RequestParts,
} from "@shopong/community";
import { webCryptoSha512 } from "@shopong/events";
import type { CapabilityAuth, Did, EpochMs, Signature } from "@shopong/ports";

/** Why a signed request was refused before any route ran. */
export type SignedProblem = "unsigned" | "bad_nonce" | "clock_skew" | "replayed" | "busy";

/** A refusal a route's gate gives, named by the route (for example `not_treasurer`). */
export type GateProblem = string;

export type SignedCheck =
  | { readonly ok: true; readonly actor: string }
  | {
      readonly ok: false;
      /** A `SignedProblem`, or the gate's own refusal (a `GateProblem`). */
      readonly problem: string;
      /** The caller, once its signature has passed. Before that the claim is not trusted and is not returned. */
      readonly verifiedActor?: string;
    };

/** Runs after the signature and skew checks, before the one-time number is recorded. `undefined` lets it pass. */
export type SignedGate = (actor: string) => Promise<GateProblem | undefined>;

/** A one-time number is remembered for twice the skew: a request time within skew can be up to that late. */
const NONCE_MEMORY_MS = 2 * REQUEST_SKEW_MS;
const DEFAULT_MAX_NONCES = 10_000;

declare module "fastify" {
  interface FastifyRequest {
    /** The body as text, exactly as it was signed. */
    rawBody: string;
  }
}

export interface SignedRequestOptions {
  readonly auth: CapabilityAuth;
  /** The Node's own clock. Defaults to `Date.now`. */
  readonly now?: () => EpochMs;
  /** How many one-time numbers are held at once. Default 10,000. */
  readonly maxNonces?: number;
}

export interface SignedRequests {
  /** Once per app: keeps the raw body text as it was signed, and parses JSON from it. */
  register(app: FastifyInstance): void;
  /** The checks on the request. `gate`, when given, runs before the one-time number is recorded. Never throws. */
  check(request: FastifyRequest, gate?: SignedGate): Promise<SignedCheck>;
  /**
   * Counts one use of the named limit by `key`. False once `max` uses have fallen in the last `windowMs`
   * (fixed windows, started by the first use). Kept in memory beside the one-time numbers (shortcut S-2.7-14).
   */
  spend(limit: string, key: string, max: number, windowMs: number): boolean;
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

export function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Builds the shared signed-request check. One instance serves every route of one app. */
export function createSignedRequests(options: SignedRequestOptions): SignedRequests {
  const { auth } = options;
  const nonces = new SeenNonces(options.maxNonces ?? DEFAULT_MAX_NONCES);
  const clock = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: EpochMs; count: number }>();

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
    },

    spend(limit, key, max, windowMs) {
      const now = clock();
      const id = `${limit}\n${key}`;
      const window = windows.get(id);
      if (window === undefined || now - window.startedAt >= windowMs) {
        windows.set(id, { startedAt: now, count: 1 });
        return true;
      }
      if (window.count >= max) return false;
      window.count += 1;
      return true;
    },

    async check(request, gate) {
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
        return { ok: false, problem: "unsigned" };
      }
      if (!isRequestNonce(nonce)) return { ok: false, problem: "bad_nonce" };

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
        return { ok: false, problem: "unsigned" };
      }

      // 3. The request is recent by the Node's own clock.
      const now = clock();
      if (Math.abs(time - now) > REQUEST_SKEW_MS) {
        return { ok: false, problem: "clock_skew", verifiedActor: actor };
      }

      // 4. The route's gate, before the one-time number is recorded.
      if (gate !== undefined) {
        const refused = await gate(actor);
        if (refused !== undefined) return { ok: false, problem: refused, verifiedActor: actor };
      }

      // 5. The one-time number is recorded now, and a replay is refused.
      const seen = nonces.offer(`${actor}\n${nonce}`, now);
      if (seen === "replayed") return { ok: false, problem: "replayed", verifiedActor: actor };
      if (seen === "full") return { ok: false, problem: "busy", verifiedActor: actor };
      return { ok: true, actor };
    },
  };
}
