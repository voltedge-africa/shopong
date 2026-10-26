// Proof that a caller holds its identity key (story 2.5). A caller signs each request to the OCN Node
// with its own key: the method, the path, a SHA-512 of the body, a one-time number, the time it was sent
// and its DID. The Node rebuilds the same bytes and checks the signature before it looks at any capability.
// Pure apart from the injected hash and signer: no clock is read here.

import { encodeUtf8, sha512Hex, type Sha512 } from "@shopong/events";
import {
  err,
  ok,
  type CapabilityAuth,
  type Did,
  type EpochMs,
  type PortError,
  type Result,
  type Signature,
} from "@shopong/ports";

/** A request time this far from the Node's clock (either way) is refused. */
export const REQUEST_SKEW_MS = 2 * 60 * 1000;

const VERSION = "ocn-request/v1";
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

export interface RequestParts {
  readonly method: string;
  readonly path: string;
  /** The raw body text, exactly as sent. An empty body is the empty string. */
  readonly body: string;
  /** A one-time value: never reused for the same caller. 16 to 128 URL-safe characters. */
  readonly nonce: string;
  /** When the request was sent, from the caller's clock. */
  readonly time: EpochMs;
  readonly actor: Did;
}

export function isRequestNonce(value: string): boolean {
  return NONCE.test(value);
}

/** The bytes that are signed. Every field is on its own line, so no field can be moved into another. */
export async function requestBytes(parts: RequestParts, sha512: Sha512): Promise<Uint8Array> {
  const bodyHash = await sha512Hex(encodeUtf8(parts.body), sha512);
  return encodeUtf8(
    [
      VERSION,
      parts.method.toUpperCase(),
      parts.path,
      bodyHash,
      parts.nonce,
      String(parts.time),
      parts.actor,
    ].join("\n"),
  );
}

/** The headers a signed request carries. */
export interface RequestHeaders {
  readonly "x-ocn-actor": string;
  readonly "x-ocn-nonce": string;
  readonly "x-ocn-time": string;
  readonly "x-ocn-signature": string;
}

/** Signs a request with the key of `parts.actor`. Refused when this adapter does not hold that key. */
export async function signRequest(
  auth: CapabilityAuth,
  parts: RequestParts,
  sha512: Sha512,
): Promise<Result<RequestHeaders, PortError<"unknown_issuer" | "invalid_request">>> {
  if (!isRequestNonce(parts.nonce)) return err("invalid_request", "nonce is not well formed");
  const signed = await auth.sign(parts.actor, await requestBytes(parts, sha512));
  if (!signed.ok) return err("unknown_issuer", signed.error.message);
  return ok({
    "x-ocn-actor": parts.actor,
    "x-ocn-nonce": parts.nonce,
    "x-ocn-time": String(parts.time),
    "x-ocn-signature": signed.value,
  });
}

/** Whether `signature` is `actor`'s signature over the request. Never throws. */
export async function verifyRequestSignature(
  auth: CapabilityAuth,
  parts: RequestParts,
  signature: Signature,
  sha512: Sha512,
): Promise<boolean> {
  return auth.verifySignature(parts.actor, await requestBytes(parts, sha512), signature);
}
