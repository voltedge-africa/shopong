import type { Brand, PortError, Result } from "./common.js";

/** Lowercase hex HMAC-SHA512 (128 characters) of a normalised personal value, keyed by one community's secret. */
export type CommitmentHex = Brand<string, "Commitment">;

/** What kind of personal value is committed. Each kind has its own normalisation (`@shopong/events`). */
export type PersonalKind = "phone" | "id-number";

/**
 * `not_recognised`: the value is not a phone or ID number, so nothing is committed.
 * `unknown_community`: this Node holds no secret for that community.
 * `secret_too_short`: the community's secret is under 32 bytes, so it is refused.
 */
export type CommitmentErrorCode = "not_recognised" | "unknown_community" | "secret_too_short";

/**
 * Commits to a personal value (AGENTS.md rule 6). The raw value is normalised first, then committed with
 * the community's secret. The secret never leaves the adapter: callers get only the commitment.
 * Owning story: 2.7. The Node holds the secret; a phone asks for a commitment over its signed link.
 */
export interface Commitments {
  commit(
    community: string,
    kind: PersonalKind,
    value: string,
  ): Promise<Result<CommitmentHex, PortError<CommitmentErrorCode>>>;
}
