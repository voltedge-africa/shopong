// In-house minimal capability chain: did:key Ed25519 identities and canonical-JSON
// delegation tokens signed with Ed25519. No UCAN library: this prototype exists to show
// what a third candidate costs in code we would own.
//
// Token = base64url(canonical JSON `{ b: body, s: <signature> }`), where the signature is
// Ed25519 over `canonicalize(body)`. The body embeds the encoded parent tokens, so a token
// carries its whole proof chain. Verification takes an explicit `logTime`; nothing here
// reads `Date.now` or the network.
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58, base64urlnopad } from "@scure/base";
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
  type PortError,
  type Result,
  type VerifiedChain,
  type VerifyError,
  type VerifyRequest,
} from "@shopong/ports";
import { canonicalize } from "../../../../packages/events/src/canonical.js";
import {
  MAX_DEPTH,
  checkIssueAttenuation,
  checkIssueShape,
  outlivesParent,
  randomNonce,
  windowError,
} from "../shared.js";

interface Body {
  readonly v: 1;
  readonly iss: Did;
  readonly aud: Did;
  readonly att: readonly Capability[];
  readonly nbf: number;
  readonly exp: number;
  readonly prf: readonly CapabilityToken[];
  readonly fct?: { readonly [key: string]: JsonValue };
  readonly nnc?: string;
}

interface SeedIdentity {
  readonly secretKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly did: Did;
}

export interface InhouseCapabilityAuthOptions {
  /** Reject amplifying delegations at `issue`. Default true; tests turn it off to exercise `verify`. */
  checkAttenuationOnIssue?: boolean;
  /** Supply a 32-byte Ed25519 seed (for example derived from a recovery seed). */
  seed?: () => Uint8Array;
}

const utf8 = new TextEncoder();

function didKey(publicKey: Uint8Array): Did {
  return `did:key:z${base58.encode(new Uint8Array([0xed, 0x01, ...publicKey]))}` as Did;
}

export class InhouseCapabilityAuth implements CapabilityAuth {
  readonly #checkOnIssue: boolean;
  readonly #seed: () => Uint8Array;
  readonly #keys = new Map<Did, SeedIdentity>();

  constructor(options: InhouseCapabilityAuthOptions = {}) {
    this.#checkOnIssue = options.checkAttenuationOnIssue ?? true;
    this.#seed =
      options.seed ??
      (() => globalThis.crypto.getRandomValues(new Uint8Array(32)));
  }

  async createIdentity(): Promise<Did> {
    const secretKey = this.#seed();
    const publicKey = await ed.getPublicKeyAsync(secretKey);
    const did = didKey(publicKey);
    this.#keys.set(did, { secretKey, publicKey, did });
    return did;
  }

  async issue(request: IssueRequest): Promise<Result<CapabilityToken, IssueError>> {
    const identity = this.#keys.get(request.issuer);
    if (identity === undefined) {
      return err("unknown_issuer", `no signing key for ${request.issuer}`);
    }
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

    const body: Body = {
      v: 1,
      iss: request.issuer,
      aud: request.audience,
      att: request.capabilities,
      nbf: request.notBefore ?? 0,
      exp: request.expiresAt,
      prf: [...proofs],
      ...(request.facts === undefined ? {} : { fct: request.facts }),
      nnc: request.nonce ?? randomNonce(),
    };
    const signature = await ed.signAsync(utf8.encode(canonicalize(body)), identity.secretKey);
    return ok(encodeToken(body, signature));
  }

  async decode(token: CapabilityToken): Promise<Result<CapabilityPayload, PortError<"malformed">>> {
    return decodeToken(token);
  }

  async tokenId(token: CapabilityToken): Promise<string> {
    return bytesToHex(sha512(utf8.encode(token)));
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
    const parsed = parseToken(token);
    if (!parsed.ok) return err("malformed", parsed.error.message);
    const { payload, publicKey, signature } = parsed.value;

    if (!(await ed.verifyAsync(signature, utf8.encode(canonicalize(bodyOf(payload))), publicKey))) {
      return err("bad_signature", "signature does not verify");
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
    let failure: VerifyError = {
      code: "broken_chain",
      message: "no proof was delegated to the issuer",
    };
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

function bodyOf(payload: CapabilityPayload): Body {
  return {
    v: 1,
    iss: payload.issuer,
    aud: payload.audience,
    att: payload.capabilities,
    nbf: payload.notBefore,
    exp: payload.expiresAt,
    prf: payload.proofs,
    ...(payload.facts === undefined ? {} : { fct: payload.facts }),
    ...(payload.nonce === undefined ? {} : { nnc: payload.nonce }),
  };
}

function encodeToken(body: Body, signature: Uint8Array): CapabilityToken {
  const envelope = { b: body, s: base64urlnopad.encode(signature) };
  return base64urlnopad.encode(utf8.encode(canonicalize(envelope))) as CapabilityToken;
}

function decodeToken(token: string): Result<CapabilityPayload, PortError<"malformed">> {
  const parsed = parseToken(token);
  if (!parsed.ok) return parsed;
  return ok(parsed.value.payload);
}

interface Parsed {
  readonly payload: CapabilityPayload;
  readonly publicKey: Uint8Array;
  readonly signature: Uint8Array;
}

function parseToken(token: string): Result<Parsed, PortError<"malformed">> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(base64urlnopad.decode(token)));
  } catch {
    return err("malformed", "not a token");
  }
  const envelope = asRecord(raw);
  if (envelope === undefined) return err("malformed", "not a token");
  const body = parseBody(envelope.b);
  if (body === undefined) return err("malformed", "bad body");
  if (typeof envelope.s !== "string") return err("malformed", "bad signature");
  let signature: Uint8Array;
  try {
    signature = base64urlnopad.decode(envelope.s);
  } catch {
    return err("malformed", "bad signature");
  }
  const payload = payloadOf(body);
  const publicKey = publicKeyOf(payload.issuer);
  if (publicKey === undefined) return err("malformed", "issuer is not a did:key");
  return ok({ payload, publicKey, signature });
}

function parseBody(value: unknown): Body | undefined {
  const record = asRecord(value);
  if (record === undefined || record.v !== 1) return undefined;
  if (!isDid(record.iss) || !isDid(record.aud)) return undefined;
  if (!Number.isSafeInteger(record.nbf) || !Number.isSafeInteger(record.exp)) return undefined;
  if (!Array.isArray(record.att) || !Array.isArray(record.prf)) return undefined;
  if (!record.prf.every((p): p is string => typeof p === "string")) return undefined;
  if (record.fct !== undefined && asRecord(record.fct) === undefined) return undefined;
  if (record.nnc !== undefined && typeof record.nnc !== "string") return undefined;
  const att: Capability[] = [];
  for (const item of record.att) {
    const capability = parseCapability(item);
    if (capability === undefined) return undefined;
    att.push(capability);
  }
  return {
    v: 1,
    iss: record.iss,
    aud: record.aud,
    att,
    nbf: record.nbf as number,
    exp: record.exp as number,
    prf: record.prf as CapabilityToken[],
    ...(record.fct === undefined ? {} : { fct: record.fct as { [key: string]: JsonValue } }),
    ...(record.nnc === undefined ? {} : { nnc: record.nnc }),
  };
}

function parseCapability(value: unknown): Capability | undefined {
  const record = asRecord(value);
  if (record === undefined || typeof record.with !== "string" || typeof record.can !== "string") {
    return undefined;
  }
  if (record.ceiling === undefined) return { with: record.with, can: record.can };
  if (!isMoney(record.ceiling)) return undefined;
  return { with: record.with, can: record.can, ceiling: record.ceiling };
}

function payloadOf(body: Body): CapabilityPayload {
  return {
    issuer: body.iss,
    audience: body.aud,
    capabilities: body.att,
    notBefore: body.nbf,
    expiresAt: body.exp,
    proofs: body.prf,
    ...(body.fct === undefined ? {} : { facts: body.fct }),
    ...(body.nnc === undefined ? {} : { nonce: body.nnc }),
  };
}

function publicKeyOf(did: Did): Uint8Array | undefined {
  if (!did.startsWith("did:key:z")) return undefined;
  try {
    const bytes = base58.decode(did.slice("did:key:z".length));
    if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) return undefined;
    return bytes.slice(2);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
