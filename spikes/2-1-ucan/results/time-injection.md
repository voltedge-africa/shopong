# Time injection (logTime, never wall clock)

## @ucans/ucans 0.12.0
- **Library behavior:** `ucans.verify` / token validation reads `Date.now()` for `isExpired`/`isTooEarly` with no way to inject time. Confirmed by tests: verifying a token valid at log time 1970 is rejected as expired; trapping `Date.now()` makes verification fail.
- **Workaround:** In `TsUcanCapabilityAuth.verify()`, call `ucans.validate(token, { checkIsExpired: false, checkIsTooEarly: false })` (library still checks signatures/issuer/alg). Evaluate validity window ourselves against `request.logTime` using `windowError()` (nbf inclusive, exp exclusive per port). No `Date.now()` called.
- **Cost:** Small (manual checks). Must be careful to cover all cases. Determinism test passes with clock set to 2100.

## iso-ucan 2.0.0
- **Library behavior:** Time injectable via `now` parameter to `Delegation.from()` and `validate()`. Confirmed by tests: can create/verify token with `now: T0` (1970s); without `now` reads `Date.now()` and is trapped. Also `Delegation.create()` asserts `exp >= now` at creation.
- **Workaround:** Pass `now = Math.floor(toSeconds(request.logTime))` to `Delegation.from()` and `checked.validate()`. When creating delegations, pass `now: toSeconds(request.notBefore ?? 0)` so issuance doesn't read wall clock. For decoding without verification, pass `now: 0`.
- **Cost:** Must thread `now` through all calls. Library supports it well. Determinism test passes.

**Conclusion:** Both can verify against explicit logTime. ts-ucan requires disabling library time checks and doing it ourselves (more error-prone). iso-ucan has first-class injection but we must be disciplined about passing it everywhere.

## in-house minimal chain
- **Design:** `verify` receives `request.logTime` and reads nothing else. The token stores
  `nbf`/`exp` in milliseconds, so the port's inclusive-start/exclusive-end rule is applied
  directly with no seconds conversion.
- **Evidence:** the same contract case (valid at `T0`, invalid one ms before, expired at
  `exp`) passes in the normal and clock-and-network-trapped variants.
- **Cost:** none at verification beyond the shared `windowError()` check; the adapter also
  refuses a child window that extends the parent's (`outlivesParent`).
