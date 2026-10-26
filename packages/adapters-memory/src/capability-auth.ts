import {
  capabilityCovers,
  err,
  isDid,
  ok,
  type Capability,
  type CapabilityAuth,
  type CapabilityPayload,
  type CapabilityToken,
  type Did,
  type IdGenerator,
  type IssueError,
  type IssueRequest,
  type PortError,
  type Result,
  type Signature,
  type VerifiedChain,
  type VerifyError,
  type VerifyRequest,
} from "@shopong/ports";
import { createCounterIds, fakeDigest, stableStringify } from "./support.js";

const PREFIX = "mem-ucan.";
const MAX_DEPTH = 16;

export interface MemoryCapabilityAuthOptions {
  ids?: IdGenerator;
  /**
   * Signing secrets by DID. Share one keyring between instances to let them verify each
   * other's tokens (it stands in for resolving a `did:key` public key).
   */
  keyring?: Map<Did, string>;
  /** Reject amplifying delegations at `issue`. Default true; tests turn it off to exercise `verify`. */
  checkAttenuationOnIssue?: boolean;
}

/**
 * In-memory `CapabilityAuth`. Tokens are `mem-ucan.<json>.<digest>` signed with a
 * NON-CRYPTOGRAPHIC digest: they detect tampering in tests and nothing more.
 */
export class MemoryCapabilityAuth implements CapabilityAuth {
  readonly #ids: IdGenerator;
  readonly #keyring: Map<Did, string>;
  readonly #own = new Set<Did>();
  readonly #checkOnIssue: boolean;

  constructor(options: MemoryCapabilityAuthOptions = {}) {
    this.#ids = options.ids ?? createCounterIds();
    this.#keyring = options.keyring ?? new Map();
    this.#checkOnIssue = options.checkAttenuationOnIssue ?? true;
  }

  async createIdentity(): Promise<Did> {
    const id = this.#ids.next("id");
    const did: Did = `did:mem:${id}`;
    this.#keyring.set(did, fakeDigest(`secret:${did}`));
    this.#own.add(did);
    return did;
  }

  async issue(request: IssueRequest): Promise<Result<CapabilityToken, IssueError>> {
    const secret = this.#keyring.get(request.issuer);
    if (!this.#own.has(request.issuer) || secret === undefined) {
      return err("unknown_issuer", `no signing key for ${request.issuer}`);
    }
    const notBefore = request.notBefore ?? 0;
    if (!isDid(request.audience)) return err("invalid_request", "audience must be a DID");
    if (request.capabilities.length === 0) return err("invalid_request", "at least one capability");
    if (
      !Number.isSafeInteger(notBefore) ||
      !Number.isSafeInteger(request.expiresAt) ||
      request.expiresAt <= notBefore
    ) {
      return err("invalid_request", "expiresAt must be an integer after notBefore");
    }
    const proofs = request.proofs ?? [];
    if (this.#checkOnIssue && proofs.length > 0) {
      const parents: CapabilityPayload[] = [];
      for (const proof of proofs) {
        const decoded = decodeToken(proof);
        if (!decoded.ok) return err("invalid_request", "a proof is malformed");
        if (decoded.value.audience !== request.issuer) {
          return err("invalid_request", "a proof was not delegated to the issuer");
        }
        parents.push(decoded.value);
      }
      const widensWindow = parents.some(
        (p) => request.expiresAt > p.expiresAt || notBefore < p.notBefore,
      );
      const amplifies = request.capabilities.some(
        (child) =>
          !parents.some((p) => p.capabilities.some((parent) => capabilityCovers(parent, child))),
      );
      if (widensWindow || amplifies) return err("not_attenuated", "delegation exceeds its proofs");
    }
    const payload: CapabilityPayload = {
      issuer: request.issuer,
      audience: request.audience,
      capabilities: request.capabilities,
      notBefore,
      expiresAt: request.expiresAt,
      proofs,
      ...(request.facts === undefined ? {} : { facts: request.facts }),
      nonce: request.nonce ?? this.#ids.next("nonce"),
    };
    const json = stableStringify(payload);
    return ok(`${PREFIX}${json}.${fakeDigest(`${secret}|${json}`)}` as CapabilityToken);
  }

  async decode(token: CapabilityToken): Promise<Result<CapabilityPayload, PortError<"malformed">>> {
    return decodeToken(token);
  }

  async tokenId(token: CapabilityToken): Promise<string> {
    return `mem-cid-${fakeDigest(token)}`;
  }

  async verify(
    token: CapabilityToken,
    request: VerifyRequest,
  ): Promise<Result<VerifiedChain, VerifyError>> {
    const leaf = decodeToken(token);
    if (!leaf.ok) return err("malformed", leaf.error.message);
    if (request.audience !== undefined && leaf.value.audience !== request.audience) {
      return err("wrong_audience", `token is for ${leaf.value.audience}`);
    }
    const chain = await this.#check(token, request.required, request, 0);
    if (!chain.ok) return chain;
    return ok({ chain: chain.value, holder: leaf.value.audience });
  }

  async sign(
    identity: Did,
    bytes: Uint8Array,
  ): Promise<Result<Signature, PortError<"unknown_issuer">>> {
    const secret = this.#keyring.get(identity);
    if (!this.#own.has(identity) || secret === undefined) {
      return err("unknown_issuer", `no signing key for ${identity}`);
    }
    return ok(fakeDigest(`${secret}|sig|${hexOf(bytes)}`) as Signature);
  }

  async verifySignature(did: Did, bytes: Uint8Array, signature: Signature): Promise<boolean> {
    const secret = this.#keyring.get(did);
    return secret !== undefined && signature === fakeDigest(`${secret}|sig|${hexOf(bytes)}`);
  }

  async #check(
    token: CapabilityToken,
    need: Capability,
    request: VerifyRequest,
    depth: number,
  ): Promise<Result<CapabilityPayload[], VerifyError>> {
    if (depth > MAX_DEPTH) return err("broken_chain", "proof chain too deep");
    const decoded = decodeToken(token);
    if (!decoded.ok) return err("malformed", decoded.error.message);
    const payload = decoded.value;
    const secret = this.#keyring.get(payload.issuer);
    const json = stableStringify(payload);
    if (secret === undefined || token !== `${PREFIX}${json}.${fakeDigest(`${secret}|${json}`)}`) {
      return err("bad_signature", "signature does not match");
    }
    if (request.logTime < payload.notBefore)
      return err("not_yet_valid", "not valid yet at log time");
    if (request.logTime >= payload.expiresAt) return err("expired", "expired at log time");
    if (request.isRevoked !== undefined && (await request.isRevoked(await this.tokenId(token)))) {
      return err("revoked", "token revoked");
    }
    const granted = payload.capabilities.find((capability) => capabilityCovers(capability, need));
    if (granted === undefined) {
      return depth === 0
        ? err("insufficient_capability", "token does not grant the required capability")
        : err("not_attenuated", "delegation exceeds its proof");
    }
    if (payload.proofs.length === 0) {
      return payload.issuer === request.rootIssuer
        ? ok([payload])
        : err("wrong_root", `chain starts at ${payload.issuer}`);
    }
    let failure: VerifyError = {
      code: "broken_chain",
      message: "no proof was delegated to the issuer",
    };
    for (const proof of payload.proofs) {
      const parent = decodeToken(proof);
      if (!parent.ok || parent.value.audience !== payload.issuer) continue;
      if (
        payload.expiresAt > parent.value.expiresAt ||
        payload.notBefore < parent.value.notBefore
      ) {
        failure = { code: "not_attenuated", message: "delegation outlives its proof" };
        continue;
      }
      const rest = await this.#check(proof, granted, request, depth + 1);
      if (rest.ok) return ok([payload, ...rest.value]);
      failure = rest.error;
    }
    return { ok: false, error: failure };
  }
}

function decodeToken(token: string): Result<CapabilityPayload, PortError<"malformed">> {
  const dot = token.lastIndexOf(".");
  if (!token.startsWith(PREFIX) || dot <= PREFIX.length)
    return err("malformed", "not a memory token");
  try {
    const payload = JSON.parse(token.slice(PREFIX.length, dot)) as CapabilityPayload;
    if (
      !isDid(payload.issuer) ||
      !isDid(payload.audience) ||
      !Array.isArray(payload.capabilities) ||
      !Array.isArray(payload.proofs) ||
      typeof payload.notBefore !== "number" ||
      typeof payload.expiresAt !== "number"
    ) {
      return err("malformed", "missing fields");
    }
    return ok(payload);
  } catch {
    return err("malformed", "payload is not JSON");
  }
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
