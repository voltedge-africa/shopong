// Stands in for Node's `crypto` module. `iso-base` runs `import crypto from "crypto"` and reads
// `crypto.webcrypto`, and @noble/hashes checks `"webcrypto" in nc`. Metro maps `crypto` and `node:crypto`
// here (see metro.config.js). `lib/cryptoPolyfills.ts` has put what Hermes lacks on `globalThis.crypto`
// by the time this is first required.
const webcrypto = globalThis.crypto;
module.exports = { webcrypto, default: { webcrypto }, __esModule: true };
