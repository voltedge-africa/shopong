// Prototype `CapabilityAuth` on `@ucans/ucans` 0.12.0 (ts-ucan, UCAN spec 0.8.1).
//
// What the library does here: Ed25519 keys, did:key, JWT build/sign/encode/parse and the
// per-layer signature + issuer/alg check (`validate`). What it cannot do for us:
// `ucans.verify` reads `Date.now()` on every layer with no way to inject log time
// (token.ts `isExpired`/`isTooEarly`), so the chain walk, time window, attenuation and
// ceilings below are our code. See test/ts-ucan-library.test.ts for the evidence.
import * as ucans from "@ucans/ucans";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { base32nopad } from "@scure/base";
import {
  capabilityCovers,
  err,
  isDid,
  isMoney,
  ok,
  type Capability,
  type CapabilityAuth,
  type CapabilityPayload,
  type CapabilityToken,
  type Did,
  type IssueError,
  type IssueRequest,
  type JsonValue,
  type Money,
  type PortError,
  type Result,
  type VerifiedChain,
  type VerifyError,
  type VerifyRequest,
} from "@shopong/ports";
import {
  MAX_DEPTH,
  checkIssueAttenuation,
  checkIssueShape,
  outlivesParent,
  randomNonce,
  toSeconds,
  windowError,
} from "../shared.js";

/** Fact keys we own inside the UCAN `fct` array. */
const CEILINGS = "ocn/ceilings";
const FACTS = "ocn/facts";

export interface TsUcanCapabilityAuthOptions {
  /** Reject amplifying delegations at `issue`. Default true; tests turn it off to exercise `verify`. */
  checkAttenuationOnIssue?: boolean;
  /** Supply keys (for example derived from a recovery seed); otherwise `EdKeypair.create`. */
  createKeypair?: () => Promise<ucans.EdKeypair>;
}

export class TsUcanCapabilityAuth implements CapabilityAuth {
  readonly #checkOnIssue: boolean;
  readonly #keys = new Map<Did, ucans.EdKeypair>();
  readonly #createKeypair: () => Promise<ucans.EdKeypair>;

  constructor(options: TsUcanCapabilityAuthOptions = {}) {
    this.#checkOnIssue = options.checkAttenuationOnIssue ?? true;
    this.#createKeypair = options.createKeypair ?? (() => ucans.EdKeypair.create());
  }

  async createIdentity(): Promise<Did> {
    const keypair = await this.#createKeypair();
    const did = keypair.did() as Did;
    this.#keys.set(did, keypair);
    return did;
  }

  async issue(request: IssueRequest): Promise<Result<CapabilityToken, IssueError>> {
    const keypair = this.#keys.get(request.issuer);
    if (keypair === undefined) return err("unknown_issuer", `no signing key for ${request.issuer}`);
    const shape = checkIssueShape(request);
    if (shape !== undefined) return shape;
    const proofs = request.proofs ?? [];
    const parents: CapabilityPayload[] = [];
    for (const proof of proofs) {
      const decoded = decodeToken(proof);
      if (!decoded.ok) return err("invalid_request", "a proof is malformed");
      parents.push(decoded.value);
    }
    const attenuation = this.#checkOnIssue ? checkIssueAttenuation(request, parents) : undefined;
    if (attenuation !== undefined) return attenuation;

    let encodedCapabilities: ucans.Capability[];
    try {
      encodedCapabilities = request.capabilities.map((c) =>
        ucans.capability.parse({ with: c.with, can: c.can === "*" ? "*" : c.can }),
      );
    } catch (e) {
      return err("invalid_request", `capability not expressible in UCAN 0.8: ${String(e)}`);
    }
    const ceilings: Record<string, JsonValue> = {};
    request.capabilities.forEach((c, i) => {
      if (c.ceiling !== undefined) ceilings[String(i)] = { ...c.ceiling };
    });
    const facts: ucans.Fact[] = [{ [CEILINGS]: ceilings }];
    if (request.facts !== undefined) facts.push({ [FACTS]: request.facts });

    const payload = ucans.buildPayload({
      issuer: request.issuer,
      audience: request.audience,
      capabilities: encodedCapabilities,
      expiration: toSeconds(request.expiresAt),
      notBefore: toSeconds(request.notBefore ?? 0),
      facts,
      proofs: [...proofs],
    });
    payload.nnc = request.nonce ?? randomNonce();
    const ucan = await ucans.signWithKeypair(payload, keypair);
    return ok(ucans.encode(ucan) as CapabilityToken);
  }

  async decode(token: CapabilityToken): Promise<Result<CapabilityPayload, PortError<"malformed">>> {
    return decodeToken(token);
  }

  /** UCAN 0.8 CID: CIDv1, raw codec, sha2-256 of the JWT bytes, base32. */
  async tokenId(token: CapabilityToken): Promise<string> {
    const digest = sha256(utf8ToBytes(token));
    const cid = new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]);
    return `b${base32nopad.encode(cid).toLowerCase()}`;
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
    try {
      // Library: issuer key type matches alg, Ed25519 signature. Time checks off: they read
      // the wall clock, so we evaluate the window against log time ourselves.
      await ucans.validate(token, { checkIsExpired: false, checkIsTooEarly: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return /Signature invalid|key type/i.test(message)
        ? err("bad_signature", "signature does not verify")
        : err("malformed", message);
    }
    const window = windowError(payload, request.logTime);
    if (window !== undefined) return { ok: false, error: window };
    if (request.isRevoked !== undefined && (await request.isRevoked(await this.tokenId(token)))) {
      return err("revoked", "token revoked");
    }
    const granted = payload.capabilities.find((c) => capabilityCovers(c, need));
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
    let failure: VerifyError = { code: "broken_chain", message: "no proof was delegated to the issuer" };
    for (const proof of payload.proofs) {
      const parent = decodeToken(proof);
      if (!parent.ok || parent.value.audience !== payload.issuer) continue;
      if (outlivesParent(payload, parent.value)) {
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
  let parsed: ReturnType<typeof ucans.parse>;
  try {
    parsed = ucans.parse(token);
  } catch (e) {
    return err("malformed", e instanceof Error ? e.message : "not a UCAN");
  }
  const p = parsed.payload;
  if (!isDid(p.iss) || !isDid(p.aud) || typeof p.exp !== "number") {
    return err("malformed", "missing fields");
  }
  const facts = p.fct ?? [];
  const ceilings = (facts.find((f) => CEILINGS in f)?.[CEILINGS] ?? {}) as Record<string, unknown>;
  const extra = facts.find((f) => FACTS in f)?.[FACTS] as CapabilityPayload["facts"];
  const capabilities: Capability[] = p.att.map((c, i) => {
    const encoded = ucans.capability.encode(c);
    const ceiling = ceilings[String(i)];
    return {
      with: encoded.with,
      can: encoded.can,
      ...(isMoney(ceiling) ? { ceiling: ceiling as Money } : {}),
    };
  });
  return ok({
    issuer: p.iss,
    audience: p.aud,
    capabilities,
    notBefore: (p.nbf ?? 0) * 1000,
    expiresAt: p.exp * 1000,
    proofs: p.prf as CapabilityToken[],
    ...(extra === undefined ? {} : { facts: extra }),
    ...(p.nnc === undefined ? {} : { nonce: p.nnc }),
  });
}
