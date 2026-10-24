// The in-memory reference adapter under the same verify-only mode, to tell contract-suite
// issues from library issues.
import { runVerifyOnly } from "./verify-only.js";
import { MemoryCapabilityAuth } from "../../../packages/adapters-memory/src/capability-auth.js";

runVerifyOnly(
  "memory reference, no attenuation check at issue",
  () => new MemoryCapabilityAuth({ checkAttenuationOnIssue: false }),
);
