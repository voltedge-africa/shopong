// AD-18 candidate KDF. recovery phrase -> 32-byte root seed (outside this spike: BIP39 or Argon2id)
// -> domain-separated subkeys with libsodium crypto_kdf (BLAKE2b keyed, 8-byte context).
const sodium = require('sodium-universal')
const b4a = require('b4a')

const CTX_STORE = 'ocnstore' // Corestore primaryKey
const CTX_IDENT = 'ocnident' // Ed25519 identity (DID) seed

function subkey(rootSeed, id, ctx) {
  if (rootSeed.byteLength !== sodium.crypto_kdf_KEYBYTES) throw new Error('root seed must be 32 bytes')
  const out = b4a.alloc(32)
  sodium.crypto_kdf_derive_from_key(out, id, b4a.from(ctx), rootSeed)
  return out
}

const corestorePrimaryKey = (rootSeed) => subkey(rootSeed, 1, CTX_STORE)
const identitySeed = (rootSeed) => subkey(rootSeed, 1, CTX_IDENT)

// Argon2id stretch of a phrase to the 32-byte root seed (salt must be fixed per scheme to be reproducible).
function rootSeedFromPhrase(phrase, salt16) {
  const out = b4a.alloc(32)
  sodium.crypto_pwhash(
    out,
    b4a.from(phrase.normalize('NFKD')),
    salt16,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
  return out
}

module.exports = { corestorePrimaryKey, identitySeed, rootSeedFromPhrase, subkey }
