# ADR 0001: Event envelope, canonical JSON and the event id

- Status: accepted (story 1.3)
- Date: 2026-10-24
- Implements: AGENTS.md rules 2, 3, 5 and 6; architecture.md sections 3.3 and 6; AD-4, AD-6, AD-9
- Code: `packages/events` (`@shopong/events`)

## Context

One user action produces one event in a community's Autobase. The same event is then referenced by the OCN Node's side effects: Ledfra transaction metadata, the Stitch `externalReference`, and a chain memo. All of these systems reconcile on a single value, the **event id**. That only works if every platform (Hermes on iOS and Android, browsers, Node and Bare) turns the same event into exactly the same bytes, and if an old app can read a stream that contains events it does not understand without failing and without changing them.

Constraints:

- `apply` must be deterministic (AD-6), so parsing and validation can use no clock, randomness, locale or environment.
- Hermes has no Node built-ins, and its `TextEncoder`/`TextDecoder` and `Intl` support is not something we want hashes to depend on.
- expo-crypto has SHA-512 (`digest`, async) but no HMAC.
- The shared record is append-only and replicated, so personal data can never be written to it (AD-9).

## Decision

### 1. The envelope

```
{ v, type, space, actor, proof, claimedAt, nonce, payload }
```

| Field       | Type and rule                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`         | Envelope version, an integer >= 1. This reader knows `1` (`ENVELOPE_VERSION`).                                                                                                        |
| `type`      | Lowercase dotted name, `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`, at most 64 characters.                                                                                                |
| `space`     | Autobase key of the community: 64 lowercase hex characters (32 bytes).                                                                                                                |
| `actor`     | `did:key` of the writer (`did:key:z` + base58btc).                                                                                                                                    |
| `proof`     | Array of encoded UCAN tokens (`[A-Za-z0-9_.-]+`), the invoking token first. Empty only for the space's root issuer. Story 2.x decides the token format; the envelope fixes the shape. |
| `claimedAt` | Integer milliseconds since the Unix epoch (UTC), from the writer's clock. It is a claim, not log time (story 3.6 derives log time from accepted `claimedAt` values).                  |
| `nonce`     | 16 to 64 random bytes, lowercase hex (`getRandomBytes(16)` gives 32 characters).                                                                                                      |
| `payload`   | A JSON object. Its schema belongs to `type`.                                                                                                                                          |

There is no `id`, `hash` or `sig` field in a v1 envelope. A v1 envelope with any extra top-level field is invalid. The event's authenticity comes from the Hypercore block signature of the writer plus `proof`. If a detached signature is needed later, it signs the event id and lives outside the hashed object.

The first-release type registry is `EVENT_TYPES` (architecture.md section 6, 28 types). Payload validators are deliberately loose placeholders (any object). The story that first writes a type replaces its validator with a strict one.

### 2. Canonical JSON: profile `ocn-jcs-1`

The canonical form is [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JSON Canonicalization Scheme) applied to a restricted data model. Every `ocn-jcs-1` output is also valid JCS output, so an off-the-shelf JCS implementation reproduces our bytes for any input we accept.

1. **Values.** `null`, `true`, `false`, strings, numbers, arrays, plain objects (prototype `Object.prototype` or `null`). Nothing else.
2. **Numbers.** Only safe integers (`Number.isSafeInteger`: |n| <= 2^53 - 1), written as the shortest decimal (ECMAScript `Number.prototype.toString`, which equals JCS for integers). `-0` is written `0`, as in JCS.
3. **Rejected numbers.** Non-integers, `NaN`, `Infinity` and any integer outside the safe range are rejected, anywhere in the envelope. Money is integer cents; time is integer milliseconds.
4. **Large integers.** An integer that may exceed 2^53 - 1 travels as a decimal string in its one canonical spelling, `^-?(0|[1-9][0-9]*)$` excluding `-0` (`encodeBigInt` / `decodeBigInt`). A JS `bigint` passed to the canonicaliser is rejected, so the in-memory object always equals what comes back off the wire.
5. **Strings.** Must be well-formed UTF-16: lone surrogates are rejected, never replaced with U+FFFD. Only `"` and `\` and U+0000 to U+001F are escaped, using `\b \t \n \f \r` where they exist and `\u00xx` with lowercase hex otherwise. Everything else, including `/`, U+007F, U+2028, U+2029 and all non-ASCII, is written literally.
6. **Objects.** Members sorted by key, comparing **UTF-16 code units** (RFC 8785 section 3.2.3). This is not code-point order and not locale order: they differ for characters above U+FFFF compared with U+E000 to U+FFFF, and for case and punctuation.
7. **Layout.** No whitespace anywhere.
8. **Bytes.** UTF-8 without a byte order mark.
9. **Rejected values.** `undefined` (as a property value or array element), sparse arrays, functions, symbols, symbol keys, cycles, `Date`, `Map`, typed arrays and class instances. `toJSON` is not called.
10. **Depth.** At most 64 levels of nesting, so hostile input cannot exhaust the stack.

The canonicaliser and UTF-8 codec are dependency-free and hand-written. They do not rely on `JSON.stringify` string escaping, `TextEncoder`, `Intl` or `localeCompare`.

### 3. The wire form is the canonical form

`encodeEvent` writes the canonical bytes. `decodeEvent` accepts bytes only if they are exactly the canonical encoding of their own content. It rejects bytes with whitespace, unsorted keys, duplicate keys, `1.0` or `1E3`, needless escapes, a BOM, invalid UTF-8, overlong sequences or encoded surrogates. So the id of a decoded event is always `sha512(bytes received)`, and re-encoding a decoded event gives back the same bytes.

### 4. The event id

```
eventId = lowercase hex( SHA-512( UTF-8( canonicalize(entire envelope) ) ) )   // 128 characters
```

The hash covers **the whole envelope, `proof` included**, and any extra top-level fields of a future version. There is no `id` field inside the hashed object. SHA-512 is injected (`type Sha512 = (bytes: Uint8Array) => Promise<Uint8Array>`), so the core imports no platform module:

- Node >= 19, browsers (HTTPS), Bare with WebCrypto: `webCryptoSha512` (uses `crypto.subtle`).
- Expo / Hermes:
  ```ts
  import * as Crypto from "expo-crypto";
  const sha512: Sha512 = async (bytes) =>
    new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA512, bytes));
  ```

The id is the idempotency key for every external side effect and the reconciliation key across the record, Ledfra, Stitch and the chain (AD-4).

### 5. Forward compatibility

`parseEvent` and `decodeEvent` never throw. They return one of:

- `{ ok: true, known: true, event }`: v1 and a registered type whose payload validates.
- `{ ok: true, known: false, reason: "unknown-type", event }`: v1, valid envelope, type not in this reader's registry.
- `{ ok: true, known: false, reason: "future-version", event }`: `v` above `ENVELOPE_VERSION`. The eight fields must still be present and well-formed. Extra top-level fields are allowed and kept.
- `{ ok: false, issues }`: anything else.

Opaque events are kept exactly as received. An older reader's `apply` skips them without error, and their bytes and id never change. A future envelope version may **add** top-level fields but must never remove or retype the eight; this is what "one envelope" (rule 2) means across versions.

### 6. Keyed commitments for personal data

```
commitment = lowercase hex( HMAC-SHA512( communitySecret, UTF-8( normalise(value) ) ) )
```

`keyedCommitment(secret, normalisedValue, hmac)` takes the HMAC as an injected function (`type HmacSha512 = (key, message) => Promise<Uint8Array>`). Story 2.7 supplies it from an audited library, because expo-crypto has no HMAC. The community secret must be at least 32 bytes. The message is exactly the normalised value, with no domain prefix, as architecture.md specifies. The normalised forms of different kinds of data do not collide, because a phone number always starts with `+`.

`normalisePhoneNumber` produces E.164:

- **South Africa (+27).** The national significant number has 9 digits and does not start with 0. The function accepts `0XX XXX XXXX`, `+27 XX ...`, `+27 (0)XX ...`, `+27 0XX ...`, `27XXXXXXXXX` and `0027...`. Separators are stripped: whitespace including NBSP and narrow NBSP, hyphens and Unicode dashes, `.`, `/`, parentheses, and invisible direction marks. The output is `+27XXXXXXXXX`.
- **Other countries.** Only the international form is accepted (`+CC...` or `00CC...`), with 8 to 15 digits and no leading 0. No trunk prefix is guessed, so `(0)` is rejected for these numbers.
- Everything else throws `NormalisationError` rather than guessing. That includes letters, extensions, full-width digits and 9-digit numbers without the trunk 0. A wrong guess would split one person into two commitments.

## Golden vectors

`packages/events/vectors/golden.json` is produced by `scripts/gen_vectors.py`. This is a second, independent implementation of `ocn-jcs-1` in Python using only the standard library: a different JSON parser, sort (UTF-16BE byte order) and SHA-512. It covers:

- canonicalisation accept and reject cases, including the RFC 8785 section 3.2.2 and 3.2.3 examples (the 3.2.2 number array is a reject case because it contains floats), unicode, key ordering, nesting, empty containers, safe-integer limits, bigint-as-string, every control character and the escapes JCS does not use
- event envelopes that are known, opaque by unknown type, and opaque by future version, plus invalid envelopes
- non-canonical wire bytes
- phone normalisation
- HMAC-SHA512 commitments

The TypeScript tests take all expectations from this file and nothing else. A test enforces that no test file embeds a digest or an expected canonical string.

## What Hermes / React Native must verify (story 3.1 or the first app story)

Run the golden vectors inside the app's JS runtime, not only in Node:

1. `canonicalize(JSON.parse(input)) === canonical` for every `canonical.accept` and `events.accept` vector, and a throw for every `canonical.reject`. This covers Hermes `JSON.parse` of lone-surrogate escapes, `-0` and `1E3`.
2. `eventIdOf` with the expo-crypto adapter equals `sha512` / `eventId` for every vector, on iOS, Android and web. On web this requires HTTPS.
3. `decodeEvent` rejects every `events.decodeReject` vector, and `encodeEvent(decodeEvent(bytes).event)` gives back the same bytes for every accept vector.
4. The story 2.7 HMAC adapter reproduces every `commitments` vector.

## Alternatives considered

- **Hash `JSON.stringify` output.** Key order follows insertion order and differs between producers. Rejected.
- **Full RFC 8785 including floats.** It needs ECMAScript shortest round-trip double formatting, which is a known source of cross-runtime bugs. We have no use for floats in money or time. Rejected; we use a strict subset, so JCS tooling still works.
- **CBOR / dCBOR or protobuf.** Deterministic binary encodings are smaller, but they add a dependency to every runtime and are harder to inspect and debug in the console. Hyperbee values can still be stored in any encoding, because only the hashed form is fixed here. Rejected for now.
- **Exclude `proof` from the hash** (hash the claim only). Two events with the same claim and different authority would then share an id, and the id would not commit to the authorisation that `apply` checked. Rejected: the id covers the full envelope.
- **Per-type payload versions** instead of one envelope `v`. This is more flexible, but every reader would need a version table per type. Rejected for now: types evolve additively, and a breaking change gets a new type name. `v` stays the envelope version.
- **Lenient decoding** (accept any JSON and re-canonicalise). The id would then no longer be the hash of the bytes received, and two different byte strings could claim one id. Rejected.
- **A schema library (zod, valibot).** Not needed for eight fields and placeholder payloads. Hand-written validators avoid a dependency and its licence review. Later stories may add one behind `PayloadValidator`.

## Consequences

- Any producer of events (device, Node, console, agent tool) must use `@shopong/events` or pass the golden vectors.
- Floats can never appear in an event. Amounts are integer cents (as a decimal string when they might exceed 2^53 - 1). Coordinates are integers too, for example polyline6 strings or micro-degree integers, which the logistics stories must specify.
- `undefined` optional fields must be omitted, not set to `undefined`, or canonicalisation throws.
- Changing any rule in section 2 changes event ids, so it requires a new profile name and a new envelope version, never an edit in place.
- The vectors and `gen_vectors.py` must change together. CI does not run Python. If the vectors drift from the generator, a reviewer catches it by re-running `pnpm --filter @shopong/events run vectors`.
