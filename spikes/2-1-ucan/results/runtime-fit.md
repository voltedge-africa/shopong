# Runtime fit

## Dependencies (transitive Node-only modules)
- @ucans/ucans 0.12.0: uses @stablelib/ed25519, crypto/WebCrypto. Needs crypto, Buffer in some envs. Works in browser with polyfills; Hermes needs polyfills.
- iso-ucan 2.0.0: uses @ipld/dag-cbor, iso-base, iso-did, iso-signatures. Uses Uint8Array/ArrayBuffer heavily; needs Buffer/crypto in some envs. Larger dependency tree.
- Both rely on @noble/* (pure JS). Ed25519 operations need crypto.

Node-only modules likely: crypto, Buffer. Modern environments have WebCrypto; React Native/Hermes needs polyfills (see expo-probe).

## Bundle size (gzipped web bundle)
| Library | Raw bundle | Gzipped |
|---------|------------|---------|
| @ucans/ucans (adapter) | ~111.6 KB | ~35.1 KB |
| iso-ucan (adapter) | ~538.9 KB | ~121.2 KB |

iso-ucan is ~3.5x larger gzipped. Both include dependencies; actual app bundle will include ports/shared code.

## Notes
- Heavy deps may increase parse/compile time on low-end devices
- Both need crypto polyfills in RN/Hermes
