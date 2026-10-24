# Hermes/React Native (expo-probe)

## Setup
- expo-probe created with Expo 58, React Native 0.88, Hermes (default)
- Imports both adapters via `../src/probe/all` which runs smoke checks through the contract cases
- Polyfills added for crypto (expo-crypto), Buffer, stream; Metro config updated for .js->.ts resolution and node module shims
- index renamed to index.tsx for JSX

## Exports (bundling)
| Platform | Status | Bundle | Notes |
|----------|--------|--------|-------|
| Android | SUCCESS | _expo/static/js/android/index-*.hbc (3MB) | Bundled 896 modules, Hermes bytecode (.hbc). Warnings about package exports (crypto, multiformats) but bundling succeeded. |
| iOS | SUCCESS | _expo/static/js/ios/index-*.hbc (3MB) | Bundled 898 modules, Hermes bytecode (.hbc). Warnings about package exports but bundling succeeded. |
| Web | SUCCESS | _expo/static/js/web/index-*.js (1.3MB) | Bundled 464 modules. Warnings about package exports but bundling succeeded. |

## Polyfills needed
- globalThis.crypto.getRandomValues via expo-crypto
- crypto.subtle.digest via @noble/hashes (polyfilled)
- Buffer, stream shims via Metro extraNodeModules
- TextEncoder/TextDecoder/structuredClone/atob/btoa checked (not polyfilled if missing)
- .js extension resolution to .ts in spike sources (NodeNext style)
- node: protocol stripping

## Notes
- Both libraries import dependencies that need Node APIs (crypto). With polyfills and Metro shims, bundling succeeded for all three platforms.
- "Claim only bundled/compiled" - bundles produced for all platforms. No emulator/device available, so cannot claim it ran on Hermes, only that it bundles/compiles.
- Workarounds: renamed index.ts to index.tsx for JSX; added .js->.ts resolution in Metro; added extraNodeModules for crypto/stream/buffer; polyfilled crypto APIs.
