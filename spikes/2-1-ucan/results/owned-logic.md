# Capability logic each adapter owns

The port's rules live in `@shopong/ports` (`capabilityCovers`) and `src/shared.ts`
(`checkIssueShape`, `checkIssueAttenuation`, `windowError`, `outlivesParent`). Every adapter
uses those helpers, so the table below separates:

- **library:** behaviour the candidate provides on its own;
- **owned here:** rules the adapter must implement or re-check to pass the port contract.

Line counts are approximate, from the committed files; "non-comment LOC" excludes blank lines
and whole-line comments but includes imports and type declarations.

## `@ucans/ucans` 0.12.0 (`src/ts-ucan/adapter.ts`, 225 lines, 203 non-comment LOC)

| Rule | Library | Owned here | Approx. lines |
|------|---------|------------|---------------|
| Ed25519 keypair, `did:key` | yes (`EdKeypair`) | thin wrapper | ~10 |
| JWT build/encode/parse | yes | | ~15 |
| Per-layer signature and issuer/alg check | yes (`ucans.validate`) | call with time checks disabled | ~10 |
| Validity window at explicit `logTime` | **no**: `verify` reads `Date.now()`; no injectable time | full check, `nbf` inclusive / `exp` exclusive | ~10 (shared) |
| Chain walk, proof-to-issuer alignment, depth | **no** (library's walk is unusable with `nbf` and wall clock) | recursive `#check` | ~50 |
| Root issuer check | **no** | compare chain start to `rootIssuer` | ~4 |
| Attenuation at issue (resource/ability/ceiling/window) | **no**: `fct` facts are opaque | `checkIssueAttenuation` + `capabilityCovers` | ~18 (shared) |
| Attenuation at verify | **no** | re-check each link against the requested capability and each parent | ~15 |
| Ceiling round-trip | **no**: UCAN 0.8 capabilities have no ceiling | encode into `fct["ocn/ceilings"]`, decode back | ~18 |
| Expiry cannot extend | **no** | `outlivesParent` | ~3 (shared) |
| Revocation lookup | **no** | caller lookup by token id | ~4 |
| Token id | **no**: no CID API on the parse result | CIDv1 raw sha2-256 base32 over the JWT | ~7 |

**Owned capability logic: roughly 130 lines**, about 45 of them in `src/shared.ts`. The
library supplies identity, JWT codec and signature checks only.

## `iso-ucan` 2.0.0 (`src/iso-ucan/adapter.ts`, 379 lines, 323 non-comment LOC)

| Rule | Library | Owned here | Approx. lines |
|------|---------|------------|---------------|
| Ed25519 signer / verifier / `did:key` resolver | yes | thin wrappers, local-only resolver | ~15 |
| DAG-CBOR delegation encode/decode, varsig | yes | bundle codec around it | ~55 |
| Signature, canonical encoding, structure | yes (`Delegation.from`/`validate`) | error mapping | ~15 |
| Validity window at explicit `now` | yes (injectable); **expiry is inclusive in seconds** | pass `now` everywhere; enforce exclusive expiry in ms | ~10 (shared) + ~5 |
| Expiry cannot extend beyond parent | **no** (UCAN 1.0 has no time-subset rule) | `outlivesParent` check per link | ~3 (shared) + ~5 |
| Command narrowing | yes (segment hierarchy) | ability <-> command mapping | ~12 |
| Resource narrowing | yes (policy `like` glob) | capability <-> policy/arguments mapping | ~55 |
| Ceiling only decreases | yes (policy `<=` over invocation args) | capability <-> policy/arguments mapping | included above |
| Attenuation at issue | partly (policy at verify; no issue-time check) | `checkIssueAttenuation` + mapping | ~18 (shared) + ~15 |
| Chain walk, proof alignment, depth | partly (`assertProofs`) | recursive `#search` because our tokens embed proofs and carry port error codes | ~70 |
| Root self-issue / root issuer | yes (`assertProofs` checks self-issue) | compare to `rootIssuer` | ~4 |
| Revocation lookup | yes (CID callback) | thread callback through `Delegation.from` | ~4 |
| Token id | yes (delegation CID) | wrapper | ~4 |

**Owned capability logic: roughly 250 lines**, including ~90 lines of mapping between the
port model and UCAN 1.0's subject/command/policy model and ~70 lines of chain walking. The
library does more of the security-critical work than ts-ucan, but the port still owns the
time-subset rule and exclusive-expiry semantics.

## In-house minimal chain (`src/inhouse/adapter.ts`, 318 lines, 284 non-comment LOC)

Everything is owned here except the Ed25519 primitive (`@noble/ed25519`), base58btc
(`@scure/base`) and the repo's existing canonical JSON (`packages/events/src/canonical.ts`):

| Rule | Owned here | Approx. lines |
|------|------------|---------------|
| Ed25519 keypair, `did:key` encode/decode | yes | ~35 |
| Canonical-JSON body, envelope, base64url codec | yes | ~35 |
| Strict body/capability parsing | yes | ~55 |
| Signature check | yes (primitive only) | ~6 |
| Validity window at explicit `logTime` | yes (shared helper) | ~10 (shared) |
| Chain walk, proof alignment, depth, root | yes | ~50 |
| Attenuation at issue and verify | yes (shared helpers) | ~33 (shared) + ~10 |
| Expiry cannot extend | yes | ~3 (shared) |
| Revocation lookup | yes | ~4 |
| Token id | yes (SHA-512 hex of the token bytes) | ~3 |

**Owned capability logic: the whole 318-line adapter** (284 non-comment). That is the cost
side of the in-house option: no third-party maintainer for the token format, but every rule,
codec and error mapping is ours to keep correct.

## What this means for the decision

- ts-ucan: smallest adapter surface for identity/signing, but the library's own verification
  path cannot be used under the port's determinism rule, so we re-implement the chain walk
  and almost all capability semantics.
- iso-ucan: the library does the most of the three, but the adapter is still larger than
  ts-ucan because UCAN 1.0's model (commands, policies, invocation arguments) is not the
  port's model (resource + ability + ceiling + embedded proofs).
- in-house: smallest bundle and no stale dependency, but we own the format, the codec and
  every security check; only a prototype here, not an audited implementation.
