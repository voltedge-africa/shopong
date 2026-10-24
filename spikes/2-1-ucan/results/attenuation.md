# Attenuation enforcement

Port rules (must hold): (a) payment ceiling can only decrease, (b) resource can only narrow, (c) expiry cannot extend. Also ability/resource narrowing per capabilityCovers.

## @ucans/ucans 0.12.0
- **Library behavior:** UCAN 0.8 semantics are limited. Library does not enforce our attenuation/ceiling rules. Tests show ceilings not enforced by library; delegation semantics need custom handling. Also proof chain walk has issues with nbf in some cases.
- **Enforcement:** Our adapter enforces everything. At issue: `checkIssueAttenuation()` compares against parent capabilities using `capabilityCovers()` (resource narrows or equal, ability narrows or equal, ceiling only decreases or parent had none; cannot drop ceiling). At verify: walk chain, for each delegation check `granted = payload.capabilities.find(c => capabilityCovers(c, need))` and if not found return `not_attenuated` when depth > 0; also check `outlivesParent()` so child window cannot extend beyond parent. Contract tests pass with these checks.
- **Verdict:** NOT enforced by library. Must be enforced by our code.

## iso-ucan 2.0.0
- **Library behavior:** UCAN 1.0 uses commands and policies. Command hierarchy narrows abilities (segment-based). Policies enforce resource narrowing via `like` and ceiling via `==`/`<=`. Tests show ceilings enforced by policy engine across chain, resources narrow by glob, commands narrow by segment. But: child can outlive parent (no time-subset rule) - GAP; expiry inclusive in seconds (exp == now valid) - GAP vs port (exclusive).
- **Enforcement:** Library enforces (a),(b) via policy/command checks. We must enforce (c) expiry cannot extend - adapter checks `outlivesParent()` and returns `not_attenuated`. Also enforce port's exclusive expiry with `windowError()`. Contract tests pass.
- **Verdict:** Partially enforced by library (ceilings/resources/abilities). Expiry extension and exclusive expiry must be enforced by our code.

**Conclusion:** Neither library fully enforces all port attenuation rules out of the box. ts-ucan enforces almost nothing; iso-ucan enforces most but misses time-subset and has inclusive expiry semantics.
