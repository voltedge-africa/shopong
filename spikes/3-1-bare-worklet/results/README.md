# Spike 3.1 Results (Phase 1)

## Environment
- Bare version: v1.33.4
- Runtime: Bare on Linux x64
- All code under `spikes/3-1-bare-worklet/`, outside pnpm workspace

## Reproduce commands (from spikes/3-1-bare-worklet/core)
```sh
./node_modules/.bin/bare test/firewall.js
./node_modules/.bin/bare test/converge.js
./node_modules/.bin/bare test/restore-ad18.js
./node_modules/.bin/bare test/probe-restore-presync.js
```

## Tests
| Test | Result | Evidence |
|---|---|---|
| (a) writer admission via host.addWriter | PASS | B became writable via host.addWriter in apply (15 ms); non-admin member.added refused. |
| (b) divergent offline writes converge after reconnect | PASS | Diverged offline, reconnected over Hyperswarm, converged with 0 lost events (9 ms). |
| (c) replication via base.replicate(conn) not store.replicate | PASS | Peer uses base.replicate(conn); pipe uses base.replicate(true/false). |
| (d) signedLength advances when indexer acks | PASS | 22 -> 34 after reconnect + ack. |
| (e) replay determinism across arrival orders | PASS | R1/R2/R3 produce identical view SHA-512 (equal to writers). |
| AD-18: primaryKey from seed (unsafe:true), same keys on empty dir | PASS w/caveats | Same keys restored; naive restore writable w/o re-admission but doesn't auto-apply own history; pre-sync before opening Autobase works. Corestore persists primaryKey (plaintext at rest). Different primaryKey on existing storage refused. |
| F-12: HyperDHT firewall return semantics | MEASURED | true/throw -> block; false/undefined -> allow (HyperDHT). On Hyperswarm client side firewall is sync-only (Promise -> truthy -> block). |

## Measurements
- connectMs 25, writableMs 15, reconvergeMs 9 (from converge). Bench (10k) timed out in env.

## Notes
- R2 default fastForward stalled until after ack+reconnect (healed).
- Pre-sync writer core before opening Autobase avoids history replay issues.
