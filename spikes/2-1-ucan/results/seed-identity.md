# Seed identity (HKDF-SHA-512, label ocn/identity/v1)

## Implementation
- `src/identity/seed.ts`: HKDF-SHA-512 with salt `ocn/kdf/v1`, labels `ocn/identity/ed25519/v1` (identity seed) and `ocn/corestore/primary-key/v1` (primary key). Requires recovery seed >= 128 bits.
- `src/identity/keys.ts`: Convert 32-byte seed to `@ucans/ucans` EdKeypair (via @stablelib/ed25519) and `iso-signatures` EdDSASigner; independent `didKeyFromPublicKey()` using multicodec ed25519-pub (0xed 0x01) + base58btc.

## Verification (tests)
- Both libraries agree with RFC 8032 and independent did:key encoding
- Same recovery seed gives same DID every time in both libraries
- Labels separate purposes (identity seed != Corestore primaryKey)
- Restored identity can sign for a chain the old device's DID was granted

## Proof
From `test/seed.test.ts`: "both libraries agree with RFC 8032 and an independent did:key encoding" and "the same recovery seed gives the same DID, every time, in both libraries" both pass.

**Result:** Same did:key every run in Node for both libraries. HKDF-SHA-512 with label `ocn/identity/v1` (and specific purpose labels) works correctly.
