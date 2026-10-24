# Runtime fit and bundle size

## Dependencies (transitive modules to watch)

- `@ucans/ucans` 0.12.0: `@stablelib/ed25519`, WebCrypto/Node `crypto`, Buffer in some paths.
  Bundles for web/Hermes with polyfills; see `results/hermes-runtime.md`.
- `iso-ucan` 2.0.0: `@ipld/dag-cbor`, `iso-base`, `iso-did`, `iso-signatures`. Uses
  `Uint8Array`/`ArrayBuffer` heavily; larger dependency tree; needs Buffer/crypto polyfills in
  some environments.
- in-house: `@noble/ed25519` (Ed25519 primitive), `@noble/hashes` (SHA-512 token id),
  `@scure/base` (base58/base64url), and the repo's existing canonical JSON
  (`packages/events/src/canonical.ts`). No UCAN/DAG-CBOR stack.

All three ultimately need Ed25519. On React Native/Hermes that means `expo-crypto`
`getRandomValues` and SHA-512 padding from pure JS (`@noble/hashes`); see the probe notes.

## Bundle size (reproducible measurement)

Measured by `pnpm run results` (`scripts/results.mjs`): one minified ESM bundle per adapter
(`vite.build`, `write: false`, `minify: true`, `target: es2022`) including its transitive
dependencies and the `@shopong/ports` code it uses; then gzip -9.

| Candidate | Raw bytes | Gzip bytes | Relative to ts-ucan |
|-----------|-----------|------------|---------------------|
| `@ucans/ucans` adapter | 142,324 | 38,421 | 1.0x |
| `iso-ucan` adapter | 240,599 | 61,743 | 1.6x |
| in-house adapter | 38,934 | 13,871 | 0.36x |

This is a like-for-like library-level comparison, not the full Expo app bundle. Phase 1's
hand-recorded numbers for ts-ucan/iso-ucan (about 35.1 KB / 121.2 KB gzip) came from a
different, unreproducible measurement; the generated `results/contract.json` is now the
source of truth. The in-house prototype is about 2.8x smaller gzipped than ts-ucan and about
4.5x smaller than iso-ucan on this measure.

## Notes

- Bundle size is one input, not the decision: the in-house prototype is smallest because it
  owns less format and no UCAN stack, but it also has no external review or maintenance.
- Low-end Android devices care about parse/compile time as well as download size. A real
  device smoke test is still required; bundling success here is not runtime evidence.
