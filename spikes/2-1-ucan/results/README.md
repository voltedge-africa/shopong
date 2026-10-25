# Spike 2.1 Results

## What was measured

The repo's real `CapabilityAuth` contract is **17 tests**, run in **3 variants** against each
candidate:

1. normal issuance and verification;
2. clock and network trapped during `verify` (any `Date.now`, `new Date()` or `fetch` throws);
3. issue-time attenuation checks off, so `verify` alone must refuse amplification (one case
   is a known contract-suite issue, below).

That is 17 x 3 = 51 assertions per candidate, 153 across the three candidates.

| Candidate | Version / spec | normal | trapped | verify-only | Notes |
|-----------|----------------|--------|---------|-------------|-------|
| `@ucans/ucans` | 0.12.0 / UCAN 0.8.1 | 17/17 | 17/17 | 16/17 + 1 expected fail | Library reads the wall clock and enforces almost none of the port's attenuation rules; adapter owns them. |
| `iso-ucan` | 2.0.0 / UCAN 1.0 | 17/17 | 17/17 | 16/17 + 1 expected fail | Library enforces command/policy attenuation and accepts an injected `now`; adapter adds exclusive expiry, time-subset and port error mapping. |
| in-house minimal chain | prototype / signed canonical JSON | 17/17 | 17/17 | 16/17 + 1 expected fail | No UCAN library; adapter owns identity, codec, signature check and every rule. |

The known contract-suite issue is
`a delegation from someone the proof was not issued to is refused`: with issue-time checks
off, the leaf expires exactly at the supplied log time, so `expired` is correct but the case
expects `broken_chain`. It fails for the in-memory reference adapter too
(`test/memory-reference.test.ts`) and is marked `it.fails` in verify-only mode.

Full suite: **188 passed, 3 expected fail, 0 failed (191 tests)**.

## How to reproduce

From `spikes/2-1-ucan/` (its own pnpm root, outside the repo workspace):

```sh
pnpm install
pnpm run test       # vp test
pnpm run results    # runs the tests with vitest's JSON reporter, measures bundles, writes results/contract.json
```

`pnpm run results` writes `results/contract.json` with a real `runAt` timestamp and the real
per-variant counts from the JSON reporter. Nothing in that file is hand-written. It also
builds one minified ESM bundle per adapter (`vite.build`, `write: false`, `minify: true`) and
records the raw and gzip-9 byte counts. See `results/contract.json` for the exact run.

The Expo/Hermes probe is separate; see `results/hermes-runtime.md`.
