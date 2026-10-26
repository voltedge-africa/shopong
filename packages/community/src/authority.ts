// The one check of a token's authority, used in three places: the phone ("What can I do?" and
// invitations), the record (`apply`, at the event's own time) and the OCN Node (`POST /authority/check`,
// at the Node's clock). It is a pure function of its inputs: the time is passed in, and nothing is read
// from the clock or the network (AD-6, AGENTS rule 3). Each caller turns the problem into its own words.

import {
  ok,
  money,
  type Capability,
  type CapabilityAuth,
  type CapabilityPayload,
  type CapabilityToken,
  type Did,
  type EpochMs,
  type Money,
  type PortError,
  type Result,
} from "@shopong/ports";
import { chainLinks } from "./chain.js";

/** Why a token does not give the authority asked for. */
export type AuthorityProblem =
  /** No token where one is needed. */
  | "missing_proof"
  /** The token cannot be read, or its signature or chain does not verify. */
  | "tampered"
  /** The token was issued to someone other than the holder. */
  | "not_yours"
  /** A link in the chain has ended at the time asked about. */
  | "ended"
  /** A link in the chain has not started yet at the time asked about. */
  | "not_started"
  /** The token does not cover the capability asked for. */
  | "outside"
  /** The token covers the ability, but the amount is above its ceiling. */
  | "over_limit"
  /** The token was revoked (the caller's `isRevoked` said so). */
  | "revoked"
  /**
   * A link above the leaf is no longer its holder's current grant: the grant it was delegated from has
   * been replaced in the record (review finding 1).
   */
  | "not_current";

/** A refusal: `code` is the problem; `at` and `limit` carry the detail some problems need. */
export interface AuthorityFailure extends PortError<AuthorityProblem> {
  /** The day the role ended or starts, for `ended` and `not_started`. */
  readonly at?: EpochMs;
  /** The ceiling the token gives, for `over_limit`. */
  readonly limit?: Money;
}

export interface AuthorityRequest {
  /** The DID that must be the leaf's audience. */
  readonly holder: Did;
  /** The DID every chain must start from. */
  readonly rootIssuer: Did;
  /** The capability needed. A `ceiling` here is the amount being spent. */
  readonly required: Capability;
  /** The time to judge validity at (the caller's clock, or the event's own time). */
  readonly at: EpochMs;
  readonly isRevoked?: (tokenId: string) => boolean | Promise<boolean>;
  /**
   * Whether `tokenId` is a current grant to `holder`: in the holder's role record as it stands at the
   * time of the check. Every link above the leaf is a grant to the DID that delegated the link below it,
   * so each one must pass. The root issuer (the creator) holds no grant and needs no entry.
   */
  readonly isCurrentGrant: (holder: Did, tokenId: string) => boolean | Promise<boolean>;
}

export interface Authorised {
  /** The whole chain, leaf first. */
  readonly chain: readonly CapabilityPayload[];
  /** The earliest end of any link. */
  readonly endsAt: EpochMs;
  /** The leaf's ceiling, if it has one. */
  readonly limit?: Money;
}

/** Checks `token` for `request`. A missing token is refused as `missing_proof`. */
export async function verifyAuthority(
  auth: CapabilityAuth,
  token: CapabilityToken | undefined,
  request: AuthorityRequest,
): Promise<Result<Authorised, AuthorityFailure>> {
  if (token === undefined) return failure("missing_proof");
  const links = await chainLinks(auth, token);
  const leaf = links?.[0];
  if (links === undefined || leaf === undefined) return failure("tampered");
  const chain = links.map((link) => link.payload);
  if (leaf.payload.audience !== request.holder) return failure("not_yours");

  const endsAt = Math.min(...chain.map((link) => link.expiresAt));
  const ended = chain.filter((link) => request.at >= link.expiresAt);
  if (ended.length > 0) {
    return failure("ended", { at: Math.min(...ended.map((link) => link.expiresAt)) });
  }
  const notStarted = chain.filter((link) => request.at < link.notBefore);
  if (notStarted.length > 0) {
    return failure("not_started", { at: Math.max(...notStarted.map((link) => link.notBefore)) });
  }

  const limit = leaf.payload.capabilities[0]?.ceiling;
  const verifyWith = (required: Capability) =>
    auth.verify(token, {
      required,
      rootIssuer: request.rootIssuer,
      logTime: request.at,
      audience: request.holder,
      ...(request.isRevoked === undefined ? {} : { isRevoked: request.isRevoked }),
    });

  const verified = await verifyWith(request.required);
  if (verified.ok) {
    // Signatures and the chain are sound. Now every grant the chain goes through must still be current.
    for (const link of links.slice(1)) {
      const id = await auth.tokenId(link.token);
      if (!(await request.isCurrentGrant(link.payload.audience, id))) return failure("not_current");
    }
    return ok({ chain, endsAt, ...(limit === undefined ? {} : { limit }) });
  }
  switch (verified.error.code) {
    case "insufficient_capability": {
      if (request.required.ceiling === undefined || limit === undefined) return failure("outside");
      // The ability is covered when a zero amount passes, so only the amount is too high.
      const floor = await verifyWith({
        ...request.required,
        ceiling: money(request.required.ceiling.currency, 0),
      });
      return floor.ok ? failure("over_limit", { limit }) : failure("outside");
    }
    case "wrong_audience":
      return failure("not_yours");
    case "expired":
      return failure("ended", { at: endsAt });
    case "not_yet_valid":
      return failure("not_started", { at: Math.max(...chain.map((link) => link.notBefore)) });
    case "revoked":
      return failure("revoked");
    default:
      return failure("tampered");
  }
}

function failure(
  problem: AuthorityProblem,
  detail: { readonly at?: EpochMs; readonly limit?: Money } = {},
): { readonly ok: false; readonly error: AuthorityFailure } {
  return { ok: false, error: { code: problem, message: problem, ...detail } };
}
