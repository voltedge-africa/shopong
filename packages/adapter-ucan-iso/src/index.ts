// The `CapabilityAuth` adapter on `iso-ucan` 2.0.0 (decision 2.1). Nothing outside this package
// imports `iso-ucan`; callers see only the port, so swapping the library is a new adapter that passes
// the same contract.
export { IsoUcanCapabilityAuth, type IsoUcanCapabilityAuthOptions } from "./adapter.js";
