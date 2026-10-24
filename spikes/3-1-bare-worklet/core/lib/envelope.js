// Minimal stand-in for the OCN event envelope (architecture 3.3):
// { v, type, space, actor, proof, claimedAt, nonce, payload }.
// The event id is SHA-512 of the canonical JSON, hex (AD-4).
const sodium = require('sodium-universal')
const b4a = require('b4a')

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
}

function sha512Hex(bytes) {
  const out = b4a.alloc(sodium.crypto_hash_sha512_BYTES)
  sodium.crypto_hash_sha512(out, bytes)
  return b4a.toString(out, 'hex')
}

function eventId(event) {
  return sha512Hex(b4a.from(canonical(event)))
}

// claimedAt and nonce are produced by the WRITER, outside apply, so apply stays pure.
function makeEvent({ type, space, actor, payload, claimedAt, nonce }) {
  return {
    v: 1,
    type,
    space,
    actor,
    proof: null,
    claimedAt,
    nonce,
    payload
  }
}

module.exports = { canonical, sha512Hex, eventId, makeEvent }
