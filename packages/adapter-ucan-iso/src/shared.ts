// Helpers that encode the port's rules (architecture 4.1) so the adapter only has to map them onto
// the library.
import { base64urlnopad } from "@scure/base";
import {
  capabilityCovers,
  err,
  isDid,
  type CapabilityPayload,
  type EpochMs,
  type IssueError,
  type IssueRequest,
  type VerifyError,
} from "@shopong/ports";

export const MAX_DEPTH = 16;

/** UCAN time fields are whole seconds. The port speaks milliseconds. */
export function toSeconds(ms: EpochMs): number {
  return ms / 1000;
}

export function isWholeSecond(ms: EpochMs): boolean {
  return Number.isSafeInteger(ms) && ms % 1000 === 0;
}

/** Shape checks every adapter applies before signing. Returns an error or undefined. */
export function checkIssueShape(
  request: IssueRequest,
): ReturnType<typeof err<IssueError["code"]>> | undefined {
  const notBefore = request.notBefore ?? 0;
  if (!isDid(request.audience)) return err("invalid_request", "audience must be a DID");
  if (request.capabilities.length === 0) return err("invalid_request", "at least one capability");
  if (!isWholeSecond(notBefore) || !isWholeSecond(request.expiresAt)) {
    return err("invalid_request", "UCAN times are whole seconds: notBefore and expiresAt % 1000");
  }
  if (request.expiresAt <= notBefore) {
    return err("invalid_request", "expiresAt must be after notBefore");
  }
  return undefined;
}

/** Attenuation check at issue time against already-decoded parents. */
export function checkIssueAttenuation(
  request: IssueRequest,
  parents: readonly CapabilityPayload[],
): ReturnType<typeof err<IssueError["code"]>> | undefined {
  if (parents.length === 0) return undefined; // a root grant
  const notBefore = request.notBefore ?? 0;
  if (parents.some((p) => p.audience !== request.issuer)) {
    return err("invalid_request", "a proof was not delegated to the issuer");
  }
  const widensWindow = parents.some(
    (p) => request.expiresAt > p.expiresAt || notBefore < p.notBefore,
  );
  const amplifies = request.capabilities.some(
    (child) =>
      !parents.some((p) => p.capabilities.some((parent) => capabilityCovers(parent, child))),
  );
  if (widensWindow || amplifies) return err("not_attenuated", "delegation exceeds its proofs");
  return undefined;
}

/** Validity window at log time: `notBefore` inclusive, `expiresAt` exclusive. */
export function windowError(payload: CapabilityPayload, logTime: EpochMs): VerifyError | undefined {
  if (logTime < payload.notBefore)
    return { code: "not_yet_valid", message: "not valid yet at log time" };
  if (logTime >= payload.expiresAt) return { code: "expired", message: "expired at log time" };
  return undefined;
}

/** A child's window must sit inside its parent's (the port rule; UCAN 1.0 does not require it). */
export function outlivesParent(child: CapabilityPayload, parent: CapabilityPayload): boolean {
  return child.expiresAt > parent.expiresAt || child.notBefore < parent.notBefore;
}

/** 12 random bytes as base64url, from WebCrypto (`expo-crypto` polyfills it on Hermes). */
export function randomNonce(): string {
  return base64urlnopad.encode(globalThis.crypto.getRandomValues(new Uint8Array(12)));
}
