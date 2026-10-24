# Spike 2.1 Results

## Contract tests (repo's real CapabilityAuth contract)
| Library | Version/Spec | Contract tests passed/total | Adapter workarounds | Notes |
|---------|--------------|----------------------------|-------------------|-------|
| @ucans/ucans | 0.12.0 / UCAN 0.8.1 | 17/17 (normal) + 17/17 (trapped) + 17/17 (verify-only) = 51/51 | Library reads wall clock (no injection) - disabled time checks, enforce window against logTime; ceilings/attenuation not enforced by library - implemented in adapter using capabilityCovers; tokenId computed as CIDv1 sha2-256 base32. | All pass. More adapter code needed for time/attenuation/ceilings. |
| iso-ucan | 2.0.0 / UCAN 1.0 | 17/17 (normal) + 17/17 (trapped) + 17/17 (verify-only) = 51/51 | Time injectable via `now` but must pass explicitly; child can outlive parent (no time-subset) - enforced; expiry inclusive in seconds - made exclusive per port; maps single-command delegations to port model; builds synthetic invocation for assertProofs. | All pass. Adapter adds port-specific rules. |

Total: 137 passed, 3 expected fail (library behavior tests). See contract.json for details.
