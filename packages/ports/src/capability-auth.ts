import type { Brand, Did, EpochMs, JsonValue, Money, PortError, Result } from "./common.js";

/**
 * A resource a capability applies to: `ocn:space/<spaceKey>[/<path>]`. A child resource
 * is the same string or a `/`-separated path below it.
 */
export type ResourceUri = string;

/**
 * An ability such as `order/propose`, `payment/approve` or `agent/act`. `<namespace>/*`
 * grants every ability in a namespace and `*` grants every ability (UCAN superuser).
 */
export type Ability = string;

/** One grant: may do `can` on `with`, optionally up to a money ceiling (architecture 4.1). */
export interface Capability {
  readonly with: ResourceUri;
  readonly can: Ability;
  /** Maximum amount per action. Attenuation may only lower it; once set it cannot be dropped. */
  readonly ceiling?: Money;
}

/** A signature over some bytes, as base64url text. Opaque to callers. */
export type Signature = Brand<string, "Signature">;

/** An encoded, signed capability token (a UCAN JWT for the ts-ucan adapter). Opaque to callers. */
export type CapabilityToken = Brand<string, "CapabilityToken">;

/** The decoded body of a token. */
export interface CapabilityPayload {
  readonly issuer: Did;
  readonly audience: Did;
  readonly capabilities: readonly Capability[];
  /** Valid from this time (inclusive). */
  readonly notBefore: EpochMs;
  /** Valid until this time (exclusive). */
  readonly expiresAt: EpochMs;
  /** Encoded parent tokens this token is delegated from. Empty for a root grant. */
  readonly proofs: readonly CapabilityToken[];
  readonly facts?: { readonly [key: string]: JsonValue };
  readonly nonce?: string;
}

export interface IssueRequest {
  /** Must be an identity whose signing key this adapter holds. */
  readonly issuer: Did;
  readonly audience: Did;
  readonly capabilities: readonly Capability[];
  readonly notBefore?: EpochMs;
  readonly expiresAt: EpochMs;
  /** Parent tokens. Omit for a root grant, give one or more to delegate. */
  readonly proofs?: readonly CapabilityToken[];
  readonly facts?: { readonly [key: string]: JsonValue };
  readonly nonce?: string;
}

export type IssueError = PortError<"unknown_issuer" | "invalid_request" | "not_attenuated">;

/** Returns whether the token with this id has been revoked. Revocations are record events (architecture 4.1). */
export type RevocationLookup = (tokenId: string) => boolean | Promise<boolean>;

export interface VerifyRequest {
  /** The capability the caller needs. */
  readonly required: Capability;
  /** The DID every chain must start from (the space's creator). */
  readonly rootIssuer: Did;
  /**
   * The time to evaluate validity against. Inside Autobase `apply` this is log time,
   * never the wall clock (AD-6). Adapters must not read the clock during `verify`.
   */
  readonly logTime: EpochMs;
  /** If given, the leaf token's audience must equal it. */
  readonly audience?: Did;
  /** Checked for every token in the chain. Absent means nothing is revoked. */
  readonly isRevoked?: RevocationLookup;
}

export type VerifyErrorCode =
  | "malformed"
  | "bad_signature"
  | "not_yet_valid"
  | "expired"
  | "revoked"
  | "wrong_audience"
  | "broken_chain"
  | "wrong_root"
  | "not_attenuated"
  | "insufficient_capability";

export type VerifyError = PortError<VerifyErrorCode>;

export interface VerifiedChain {
  /** Leaf first, root last. */
  readonly chain: readonly CapabilityPayload[];
  /** The leaf token's audience: who is authorised. */
  readonly holder: Did;
}

/**
 * Identity and delegated authority (UCAN). Owning epic: 2.
 *
 * Rules every adapter must follow:
 * - A delegation may only attenuate: resources narrow, abilities narrow, ceilings
 *   decrease and the validity window cannot extend beyond the parent's. See
 *   `capabilityCovers` for the exact rule.
 * - `issue` may reject an amplifying delegation with `not_attenuated`; `verify` must
 *   reject one whether or not `issue` did.
 * - `verify` is a pure function of its inputs and the tokens: no clock, no network.
 *   That makes it safe inside Autobase `apply`.
 */
export interface CapabilityAuth {
  /** Create a new identity whose signing key this adapter keeps. */
  createIdentity(): Promise<Did>;
  /** Sign a root grant or a delegation. */
  issue(request: IssueRequest): Promise<Result<CapabilityToken, IssueError>>;
  /** Decode without verifying. */
  decode(token: CapabilityToken): Promise<Result<CapabilityPayload, PortError<"malformed">>>;
  /** Stable id for a token (the UCAN CID), used as the revocation key. */
  tokenId(token: CapabilityToken): Promise<string>;
  /** Verify a token and its whole proof chain against a required capability. */
  verify(
    token: CapabilityToken,
    request: VerifyRequest,
  ): Promise<Result<VerifiedChain, VerifyError>>;
  /**
   * Sign bytes with the key of an identity this adapter holds. A signature proves the caller holds
   * that key (story 2.5): a token copied from a record is useless without it.
   */
  sign(identity: Did, bytes: Uint8Array): Promise<Result<Signature, PortError<"unknown_issuer">>>;
  /**
   * Whether `signature` is `did`'s signature over `bytes`. Reads only its inputs: no clock, no
   * network. A DID or signature that cannot be read is simply not valid.
   */
  verifySignature(did: Did, bytes: Uint8Array, signature: Signature): Promise<boolean>;
}

function resourceCovers(parent: ResourceUri, child: ResourceUri): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

function abilityCovers(parent: Ability, child: Ability): boolean {
  if (parent === "*" || parent === child) return true;
  if (parent.endsWith("/*")) {
    const namespace = parent.slice(0, -1);
    return child.startsWith(namespace) && child !== "*";
  }
  return false;
}

function ceilingCovers(parent: Money | undefined, child: Money | undefined): boolean {
  if (parent === undefined) return true;
  if (child === undefined) return false;
  return parent.currency === child.currency && child.minor <= parent.minor;
}

/**
 * Whether `parent` grants everything `child` asks for. This is the attenuation rule of
 * the port: same or narrower resource, same or narrower ability, same or lower ceiling.
 */
export function capabilityCovers(parent: Capability, child: Capability): boolean {
  return (
    resourceCovers(parent.with, child.with) &&
    abilityCovers(parent.can, child.can) &&
    ceilingCovers(parent.ceiling, child.ceiling)
  );
}
