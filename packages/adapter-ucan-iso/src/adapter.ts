// `CapabilityAuth` on `iso-ucan` 2.0.0 (UCAN 1.0: delegation envelopes in
// DAG-CBOR, varsig, commands and policies). Chosen in decision 2.1 (docs/decisions/2-1-ucan-library.md).
//
// Mapping of our model onto UCAN 1.0:
// - subject (`sub`)  = the space's root issuer DID; a root grant is self-issued (iss = sub).
// - command (`cmd`)  = `/` + ability (`payment/approve` -> `/payment/approve`, `order/*` ->
//   `/order`, `*` -> `/`). The library's command hierarchy narrows abilities.
// - policy (`pol`)   = resource and ceiling as statements over the invocation arguments
//   `{ with, ceiling }`: `.with` equals R or is `like` `R/*`; `.ceiling.currency ==`,
//   `.ceiling.minor <=`. UCAN 1.0 evaluates every delegation's policy against the
//   arguments, so a ceiling can only effectively decrease and a resource only narrow.
// - UCAN 1.0 delegations do not embed proofs; the chain travels with the invocation. Our
//   port token embeds them, so a token here is a DAG-CBOR bundle `{ d: delegation, p: [proof
//   bundles] }`. Every delegation inside is individually signed; the bundle is not.
//
// Verification uses the library for the decision: `Delegation.from`/`validate` (canonical
// DAG-CBOR, signature, time against an injected `now`, revocation) and `assertProofs`
// (root self-issued, principal and subject alignment, command coverage, policy) over a
// synthetic invocation payload built from the required capability. We add the port rules
// UCAN 1.0 lacks: millisecond-exclusive expiry, child window inside the parent's, and
// error codes.
import * as dagCbor from "@ipld/dag-cbor";
import { base64urlnopad } from "@scure/base";
import { base64 } from "iso-base/rfc4648";
import { Delegation } from "iso-ucan/delegation";
import type { DID as IsoDid } from "iso-ucan/types";
import { assertProofs } from "iso-ucan/invocation";
import { validate as policyAllows } from "iso-ucan/policy";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { verifier as eddsaVerifier } from "iso-signatures/verifiers/eddsa.js";
import { Resolver as VerifierResolver } from "iso-signatures/verifiers/resolver.js";
import { Resolver as DidResolver } from "iso-did";
import { resolver as didKeyResolver } from "iso-did/key";
import {
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
import {
  MAX_DEPTH,
  checkIssueAttenuation,
  checkIssueShape,
  outlivesParent,
  randomNonce,
  toSeconds,
  windowError,
} from "./shared.js";

type Statement = readonly unknown[];

/** Only `did:key` resolves, locally: no resolver that could reach the network is registered. */
const didResolver = new DidResolver({ ...didKeyResolver });
const verifierResolver = new VerifierResolver({ ...eddsaVerifier });

export interface IsoUcanCapabilityAuthOptions {
  /** Reject amplifying delegations at `issue`. Default true; tests turn it off to exercise `verify`. */
  checkAttenuationOnIssue?: boolean;
  /** Supply keys (for example derived from a recovery seed); otherwise random. */
  createSigner?: () => Promise<EdDSASigner>;
  /**
   * The 32-byte Ed25519 seed of this device's own identity (AD-18: derived from the recovery seed,
   * never the recovery seed itself). The first `createIdentity()` returns the DID of this key; later
   * calls make fresh keys as usual. Ignored when `createSigner` is given.
   */
  identitySeed?: Uint8Array;
}

interface Bundle {
  readonly delegation: Uint8Array;
  readonly proofs: readonly CapabilityToken[];
}

export class IsoUcanCapabilityAuth implements CapabilityAuth {
  readonly #checkOnIssue: boolean;
  readonly #signers = new Map<Did, EdDSASigner>();
  readonly #createSigner: () => Promise<EdDSASigner>;

  constructor(options: IsoUcanCapabilityAuthOptions = {}) {
    this.#checkOnIssue = options.checkAttenuationOnIssue ?? true;
    const seed = options.identitySeed;
    if (seed !== undefined && seed.length !== 32) {
      throw new RangeError("identitySeed must be 32 bytes");
    }
    let seedPending = seed !== undefined;
    this.#createSigner =
      options.createSigner ??
      (() => {
        if (seedPending && seed !== undefined) {
          seedPending = false;
          return EdDSASigner.generate(seed);
        }
        return EdDSASigner.generate();
      });
  }

  async createIdentity(): Promise<Did> {
    const signer = await this.#createSigner();
    const did = signer.did as Did;
    this.#signers.set(did, signer);
    return did;
  }

  async issue(request: IssueRequest): Promise<Result<CapabilityToken, IssueError>> {
    const signer = this.#signers.get(request.issuer);
    if (signer === undefined) return err("unknown_issuer", `no signing key for ${request.issuer}`);
    const shape = checkIssueShape(request);
    if (shape !== undefined) return shape;
    if (request.capabilities.length !== 1) {
      return err("invalid_request", "a UCAN 1.0 delegation carries exactly one command");
    }
    const capability = request.capabilities[0] as Capability;
    const proofs = request.proofs ?? [];
    const parents: CapabilityPayload[] = [];
    let subject: Did = request.issuer;
    for (const proof of proofs) {
      const decoded = await decodeToken(proof);
      if (!decoded.ok) return err("invalid_request", "a proof is malformed");
      parents.push(decoded.value.payload);
      subject = decoded.value.subject;
    }
    if (parents.length > 0) {
      const subjects = new Set(await Promise.all(proofs.map(async (p) => subjectOf(p))));
      if (subjects.size !== 1) return err("invalid_request", "proofs have different subjects");
    }
    const attenuation = this.#checkOnIssue ? checkIssueAttenuation(request, parents) : undefined;
    if (attenuation !== undefined) return attenuation;

    let delegation: Delegation;
    try {
      delegation = await Delegation.create({
        iss: signer,
        aud: request.audience as IsoDid,
        sub: subject as IsoDid,
        cmd: abilityToCommand(capability.can),
        pol: capabilityToPolicy(capability) as never,
        exp: toSeconds(request.expiresAt),
        nbf: toSeconds(request.notBefore ?? 0),
        nonce: new TextEncoder().encode(request.nonce ?? randomNonce()),
        ...(request.facts === undefined ? {} : { meta: { facts: request.facts } as never }),
        // The library asserts `exp >= now` at creation; give it the token's own start so
        // issuing never reads the wall clock and historic log times stay issuable.
        now: toSeconds(request.notBefore ?? 0),
      });
    } catch (e) {
      return err("invalid_request", e instanceof Error ? e.message : String(e));
    }
    return ok(encodeBundle({ delegation: delegation.bytes, proofs }));
  }

  async decode(token: CapabilityToken): Promise<Result<CapabilityPayload, PortError<"malformed">>> {
    const decoded = await decodeToken(token);
    return decoded.ok ? ok(decoded.value.payload) : decoded;
  }

  /** The leaf delegation's CID (DAG-CBOR, sha2-256), as the library computes it. */
  async tokenId(token: CapabilityToken): Promise<string> {
    const decoded = await decodeToken(token);
    if (!decoded.ok) throw new TypeError(decoded.error.message);
    return decoded.value.delegation.cid.toString();
  }

  async verify(
    token: CapabilityToken,
    request: VerifyRequest,
  ): Promise<Result<VerifiedChain, VerifyError>> {
    const leaf = await decodeToken(token);
    if (!leaf.ok) return err("malformed", leaf.error.message);
    if (request.audience !== undefined && leaf.value.payload.audience !== request.audience) {
      return err("wrong_audience", `token is for ${leaf.value.payload.audience}`);
    }
    const args = capabilityToArgs(request.required);
    const cmd = abilityToCommand(request.required.can);
    const found = await this.#search(token, request, args, cmd, 0);
    if (!found.ok) return found;
    const chain = found.value; // leaf first
    // Authoritative library check over the whole chain (root first, as UCAN 1.0 orders it).
    try {
      assertProofs(
        {
          iss: leaf.value.payload.audience,
          sub: chain[chain.length - 1]!.subject,
          cmd,
          args,
          nonce: new Uint8Array(12),
          exp: null,
          prf: chain.map((c) => c.delegation.cid).reverse(),
        } as never,
        chain.map((c) => c.delegation).reverse(),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/not self-signed/.test(message)) return err("wrong_root", message);
      if (/alignment/.test(message)) return err("broken_chain", message);
      return err("not_attenuated", message);
    }
    return ok({ chain: chain.map((c) => c.payload), holder: leaf.value.payload.audience });
  }

  async #search(
    token: CapabilityToken,
    request: VerifyRequest,
    args: Record<string, unknown>,
    cmd: string,
    depth: number,
  ): Promise<Result<Decoded[], VerifyError>> {
    if (depth > MAX_DEPTH) return err("broken_chain", "proof chain too deep");
    const decoded = await decodeToken(token);
    if (!decoded.ok) return err("malformed", decoded.error.message);
    const node = decoded.value;
    const window = windowError(node.payload, request.logTime);
    if (window !== undefined) return { ok: false, error: window };
    const now = Math.floor(toSeconds(request.logTime));
    const isRevoked = request.isRevoked;
    try {
      // Signature, canonical encoding, structure and expiry at `now`, revocation...
      const checked = await Delegation.from({
        bytes: node.bundle.delegation,
        now,
        didResolver,
        verifierResolver,
        ...(isRevoked === undefined ? {} : { isRevoked: async (cid) => isRevoked(cid.toString()) }),
      });
      // ...and "not before" at `now`.
      await checked.validate({ now, didResolver, verifierResolver });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/revoked/.test(message)) return err("revoked", "token revoked");
      if (/signature/i.test(message)) return err("bad_signature", "signature does not verify");
      if (/not valid yet/.test(message)) return err("not_yet_valid", message);
      if (/expiration/.test(message)) return err("expired", message);
      return err("malformed", message);
    }
    const d = node.delegation;
    if (!commandCovers(d.cmd, cmd) || !policyAllows(args, d.pol)) {
      return depth === 0
        ? err("insufficient_capability", "token does not grant the required capability")
        : err("not_attenuated", "delegation exceeds its proof");
    }
    if (node.payload.proofs.length === 0) {
      return node.payload.issuer === request.rootIssuer
        ? ok([node])
        : err("wrong_root", `chain starts at ${node.payload.issuer}`);
    }
    let failure: VerifyError = {
      code: "broken_chain",
      message: "no proof was delegated to the issuer",
    };
    for (const proof of node.payload.proofs) {
      const parent = await decodeToken(proof);
      if (!parent.ok || parent.value.payload.audience !== node.payload.issuer) continue;
      if (outlivesParent(node.payload, parent.value.payload)) {
        failure = { code: "not_attenuated", message: "delegation outlives its proof" };
        continue;
      }
      const rest = await this.#search(proof, request, args, cmd, depth + 1);
      if (rest.ok) return ok([node, ...rest.value]);
      failure = rest.error;
    }
    return { ok: false, error: failure };
  }
}

// ---- mapping ------------------------------------------------------------------------

export function abilityToCommand(can: string): string {
  if (can === "*") return "/";
  if (can.endsWith("/*")) return `/${can.slice(0, -2)}`;
  return `/${can}`;
}

function commandToAbility(cmd: string): string {
  if (cmd === "/") return "*";
  const path = cmd.slice(1);
  return path.includes("/") ? path : `${path}/*`;
}

/** Same rule as the library's (unexported) `commandCovers`: whole segments only. */
function commandCovers(parent: string, child: string): boolean {
  if (parent === "/") return child.startsWith("/");
  return child === parent || child.startsWith(`${parent}/`);
}

function escapeGlob(value: string): string {
  return value.replace(/\*/g, "\\*");
}

export function capabilityToPolicy(c: Capability): Statement[] {
  const prefix = c.with.endsWith("/") ? c.with : `${c.with}/`;
  const policy: Statement[] = [
    [
      "or",
      [
        ["==", ".with", c.with],
        ["like", ".with", `${escapeGlob(prefix)}*`],
      ],
    ],
  ];
  if (c.ceiling !== undefined) {
    policy.push(["==", ".ceiling.currency", c.ceiling.currency]);
    policy.push(["<=", ".ceiling.minor", c.ceiling.minor]);
  }
  return policy;
}

/** Strict inverse of `capabilityToPolicy`; anything else is not one of our tokens. */
function policyToCapability(cmd: string, pol: unknown): Capability | undefined {
  if (!Array.isArray(pol) || (pol.length !== 1 && pol.length !== 3)) return undefined;
  const [resource, currency, minor] = pol as unknown[][];
  const options = resource?.[0] === "or" ? (resource[1] as unknown[][] | undefined) : undefined;
  const equals = options?.[0];
  if (equals?.[0] !== "==" || equals[1] !== ".with" || typeof equals[2] !== "string") {
    return undefined;
  }
  const capability: Capability = { with: equals[2], can: commandToAbility(cmd) };
  if (pol.length === 1) return capability;
  const ceiling = { currency: currency?.[2], minor: minor?.[2] };
  if (
    currency?.[1] !== ".ceiling.currency" ||
    minor?.[1] !== ".ceiling.minor" ||
    !isMoney(ceiling)
  ) {
    return undefined;
  }
  return { ...capability, ceiling };
}

function capabilityToArgs(c: Capability): Record<string, unknown> {
  return c.ceiling === undefined
    ? { with: c.with }
    : { with: c.with, ceiling: { currency: c.ceiling.currency, minor: c.ceiling.minor } };
}

// ---- bundle codec -------------------------------------------------------------------

interface Decoded {
  readonly bundle: Bundle;
  readonly delegation: Delegation;
  readonly payload: CapabilityPayload;
  readonly subject: Did;
}

function encodeBundle(bundle: Bundle): CapabilityToken {
  const bytes = dagCbor.encode({
    d: bundle.delegation,
    p: bundle.proofs.map((p) => base64urlnopad.decode(p)),
  });
  return base64urlnopad.encode(bytes) as CapabilityToken;
}

async function subjectOf(token: CapabilityToken): Promise<Did | undefined> {
  const decoded = await decodeToken(token);
  return decoded.ok ? decoded.value.subject : undefined;
}

async function decodeToken(token: string): Promise<Result<Decoded, PortError<"malformed">>> {
  try {
    const raw = dagCbor.decode(base64urlnopad.decode(token)) as { d?: unknown; p?: unknown };
    if (!(raw.d instanceof Uint8Array) || !Array.isArray(raw.p)) {
      return err("malformed", "not a bundle");
    }
    const proofs = raw.p.map((p: unknown) => {
      if (!(p instanceof Uint8Array)) throw new TypeError("proof is not bytes");
      return base64urlnopad.encode(p) as CapabilityToken;
    });
    // Decode only (no signature check). `now: 0` so decoding never reads the wall clock and
    // an expired token still decodes.
    const delegation = await Delegation.fromString(base64.encode(raw.d), { now: 0 });
    const capability = policyToCapability(delegation.cmd, delegation.pol);
    if (capability === undefined || delegation.sub === null || delegation.exp === null) {
      return err("malformed", "not an OCN capability delegation");
    }
    const issuer = delegation.iss.toString();
    if (!isDid(issuer) || !isDid(delegation.aud) || !isDid(delegation.sub)) {
      return err("malformed", "bad DIDs");
    }
    const meta = delegation.meta as { facts?: { [key: string]: JsonValue } } | undefined;
    const payload: CapabilityPayload = {
      issuer,
      audience: delegation.aud,
      capabilities: [capability],
      notBefore: (delegation.nbf ?? 0) * 1000,
      expiresAt: delegation.exp * 1000,
      proofs,
      ...(meta?.facts === undefined ? {} : { facts: meta.facts }),
      nonce: new TextDecoder().decode(delegation.nonce),
    };
    return ok({
      bundle: { delegation: raw.d, proofs },
      delegation,
      payload,
      subject: delegation.sub,
    });
  } catch (e) {
    return err("malformed", e instanceof Error ? e.message : "not a token");
  }
}
