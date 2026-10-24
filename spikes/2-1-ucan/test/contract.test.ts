// The repo's real CapabilityAuth contract suite against each prototype adapter, plain and
// with the clock and network trapped during verify.
import { describe } from "vite-plus/test";
import { runCapabilityAuthContract } from "@shopong/ports-contract";
import { InhouseCapabilityAuth } from "../src/inhouse/adapter.js";
import { IsoUcanCapabilityAuth } from "../src/iso-ucan/adapter.js";
import { TsUcanCapabilityAuth } from "../src/ts-ucan/adapter.js";
import { trapped } from "../src/trap.js";
import { runVerifyOnly } from "./verify-only.js";

describe("ts-ucan 0.12.0", () => {
  runCapabilityAuthContract(() => new TsUcanCapabilityAuth());
});

describe("ts-ucan 0.12.0, clock and network trapped in verify", () => {
  runCapabilityAuthContract(() => trapped(new TsUcanCapabilityAuth()));
});

describe("iso-ucan 2.0.0", () => {
  runCapabilityAuthContract(() => new IsoUcanCapabilityAuth());
});

describe("iso-ucan 2.0.0, clock and network trapped in verify", () => {
  runCapabilityAuthContract(() => trapped(new IsoUcanCapabilityAuth()));
});

describe("in-house minimal chain", () => {
  runCapabilityAuthContract(() => new InhouseCapabilityAuth());
});

describe("in-house minimal chain, clock and network trapped in verify", () => {
  runCapabilityAuthContract(() => trapped(new InhouseCapabilityAuth()));
});

// Amplifying delegations get signed, so `verify` alone must refuse them.
runVerifyOnly(
  "ts-ucan 0.12.0, no attenuation check at issue",
  () => new TsUcanCapabilityAuth({ checkAttenuationOnIssue: false }),
);
runVerifyOnly(
  "iso-ucan 2.0.0, no attenuation check at issue",
  () => new IsoUcanCapabilityAuth({ checkAttenuationOnIssue: false }),
);
runVerifyOnly(
  "in-house minimal chain, no attenuation check at issue",
  () => new InhouseCapabilityAuth({ checkAttenuationOnIssue: false }),
);
