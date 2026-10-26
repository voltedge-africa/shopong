// The request-proof gate shared by the Node's signed routes: `POST /authority/check` (story 2.5) and the sync
// routes (story 3.5). A caller signs each request with its own key (`@shopong/community` request-proof). The
// gate rebuilds the same bytes and checks, in this order: the headers are present, the one-time number is
// well formed, the signature is the claimed actor's, the time is within skew of the Node's clock, and the
// one-time number has not been used. The body is buffered by Fastify before the handler runs, but it is neither
// parsed nor used until the signature has passed.

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  REQUEST_SKEW_MS,
  isRequestNonce,
  verifyRequestSignature,
  type RequestParts,
} from "@shopong/community";
import { webCryptoSha512 } from "@shopong/events";
import type { CapabilityAuth, Did, EpochMs, Signature } from "@shopong/ports";

/** A one-time number is remembered for twice the skew: a request time within skew can be up to that late. */
const NONCE_MEMORY_MS = 2 * REQUEST_SKEW_MS;
export const DEFAULT_MAX_NONCES = 10_000;

declare module "fastify" {
  interface FastifyRequest {
    /** The body as text, exactly as it was signed. */
    rawBody: string;
  }
}

/**
 * The one-time numbers seen recently. A `Map` iterates in insertion order and every entry lives the same
 * length of time, so expired entries are always at the front: pruning drops from the front and stops at
 * the first live one, which is amortised constant work per request. Full means refuse, never evict live ones.
 */
export class SeenNonces {
  readonly #entries = new Map<string, EpochMs>();
  readonly #max: number;

  constructor(max: number = DEFAULT_MAX_NONCES) {
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
 * Keeps a JSON body as the raw text it arrived as, which is what the caller signed. It is not parsed here,
 * so a request with a bad body still reaches the signature check; the route parses it after the check.
 */
export function keepRawJsonBody(app: FastifyInstance): void {
  app.decorateRequest("rawBody", "");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser<string>(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      request.rawBody = body;
      done(null, body);
    },
  );
}

export type SignedProblem = "unsigned" | "bad_nonce" | "clock_skew" | "replayed" | "busy";

/** `actor` is set once the signature has passed, so a later refusal can name the verified caller. */
export type SignedCheck =
  | { readonly ok: true; readonly actor: Did; readonly now: EpochMs }
  | { readonly ok: false; readonly problem: SignedProblem; readonly actor?: Did };

export interface SignedGate {
  readonly auth: CapabilityAuth;
  readonly nonces: SeenNonces;
  /** The Node's own clock. */
  readonly clock: () => EpochMs;
}

export function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export type SignedVerdict =
  | { readonly ok: true; readonly actor: Did; readonly now: EpochMs; readonly nonce: string }
  | { readonly ok: false; readonly problem: SignedProblem; readonly actor?: Did };

/**
 * Checks a request's proof: the headers, the signature over the method and the full URL (query string included)
 * and the body, and the time against the Node's clock. It does NOT record the one-time number: a caller claims it
 * with `claimNonce` once it has also passed whatever check the route makes first (for example membership), so
 * a stranger whose signature is valid cannot use up the table.
 */
export async function verifySignedRequest(
  gate: Pick<SignedGate, "auth" | "clock">,
  request: FastifyRequest,
): Promise<SignedVerdict> {
  const actor = headerOf(request, "x-ocn-actor");
  const nonce = headerOf(request, "x-ocn-nonce");
  const signature = headerOf(request, "x-ocn-signature");
  const time = Number(headerOf(request, "x-ocn-time"));
  if (
    actor === undefined ||
    nonce === undefined ||
    signature === undefined ||
    !Number.isSafeInteger(time)
  ) {
    return { ok: false, problem: "unsigned" };
  }
  if (!isRequestNonce(nonce)) return { ok: false, problem: "bad_nonce" };

  // The bytes signed are the method, the URL exactly as sent (so a changed query string breaks it), and the body.
  const parts: RequestParts = {
    method: request.method,
    path: request.url,
    body: request.rawBody,
    nonce,
    time,
    actor: actor as Did,
  };
  if (!(await verifyRequestSignature(gate.auth, parts, signature as Signature, webCryptoSha512))) {
    return { ok: false, problem: "unsigned" };
  }

  const now = gate.clock();
  if (Math.abs(time - now) > REQUEST_SKEW_MS)
    return { ok: false, problem: "clock_skew", actor: actor as Did };
  return { ok: true, actor: actor as Did, now, nonce };
}

/** Records a verified request's one-time number. `replayed` when already used, `busy` when the table is full. */
export function claimNonce(
  nonces: SeenNonces,
  verdict: { readonly actor: Did; readonly nonce: string; readonly now: EpochMs },
): SignedProblem | undefined {
  const seen = nonces.offer(`${verdict.actor}\n${verdict.nonce}`, verdict.now);
  if (seen === "replayed") return "replayed";
  if (seen === "full") return "busy";
  return undefined;
}

/** The whole gate for a route that needs nothing else first (`/authority/check`). Never throws. */
export async function checkSignedRequest(
  gate: SignedGate,
  request: FastifyRequest,
): Promise<SignedCheck> {
  const verdict = await verifySignedRequest(gate, request);
  if (!verdict.ok) return verdict;
  const refused = claimNonce(gate.nonces, verdict);
  if (refused !== undefined) return { ok: false, problem: refused, actor: verdict.actor };
  return { ok: true, actor: verdict.actor, now: verdict.now };
}
