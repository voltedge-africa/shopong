// Regenerate results/contract.json from a real test run and a real bundle measurement.
// Run with `pnpm run results` from the spike root. The vitest JSON reporter is the source
// of every pass/fail count; nothing in results/contract.json is typed by hand.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const tmp = `${root}results/tmp/`;
const reportPath = `${tmp}report.json`;
const reportFile = `${tmp}report.txt`;
const repo = fileURLToPath(new URL("../../../", import.meta.url));

mkdirSync(tmp, { recursive: true });
rmSync(reportPath, { force: true });

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
execFileSync(
  pnpm,
  ["exec", "vp", "test", "--reporter=json", "--outputFile", reportPath],
  { cwd: root, stdio: "inherit" },
);

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const KNOWN_CONTRACT_ISSUE =
  "a delegation from someone the proof was not issued to is refused";
const VARIANT_NAMES = ["normal", "clock_and_network_trapped_in_verify", "verify_only"];

const candidates = [
  { key: "ts-ucan", label: "@ucans/ucans", version: "0.12.0", spec: "UCAN 0.8.1", title: "ts-ucan 0.12.0", adapter: "src/ts-ucan/adapter.ts" },
  { key: "iso-ucan", label: "iso-ucan", version: "2.0.0", spec: "UCAN 1.0", title: "iso-ucan 2.0.0", adapter: "src/iso-ucan/adapter.ts" },
  { key: "inhouse", label: "in-house minimal chain", version: "prototype", spec: "signed canonical JSON (not UCAN)", title: "in-house minimal chain", adapter: "src/inhouse/adapter.ts" },
];

const assertions = report.testResults.flatMap((file) => file.assertionResults);
const variantsFor = (title) => {
  const find = (suffix) =>
    assertions.filter((a) => {
      const top = (a.ancestorTitles ?? [])[0] ?? "";
      return suffix === "" ? top === title : top === `${title}, ${suffix}`;
    });
  return [
    { name: VARIANT_NAMES[0], results: find("") },
    { name: VARIANT_NAMES[1], results: find("clock and network trapped in verify") },
    { name: VARIANT_NAMES[2], results: find("no attenuation check at issue") },
  ];
};

const bundleEntries = {
  "ts-ucan": `import { TsUcanCapabilityAuth } from "../../src/ts-ucan/adapter.js";\nexport { TsUcanCapabilityAuth };\n`,
  "iso-ucan": `import { IsoUcanCapabilityAuth } from "../../src/iso-ucan/adapter.js";\nexport { IsoUcanCapabilityAuth };\n`,
  inhouse: `import { InhouseCapabilityAuth } from "../../src/inhouse/adapter.js";\nexport { InhouseCapabilityAuth };\n`,
};

async function bundleBytes(key) {
  const entry = `${tmp}entry-${key}.ts`;
  writeFileSync(entry, bundleEntries[key]);
  const out = await build({
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: [{ find: "@shopong/ports", replacement: `${repo}packages/ports/src/index.ts` }],
    },
    build: {
      write: false,
      minify: true,
      target: "es2022",
      lib: { entry, formats: ["es"], fileName: () => "bundle.js" },
    },
  });
  const outputs = Array.isArray(out) ? out.flatMap((o) => o.output) : out.output;
  const chunk = outputs.find((o) => o.type === "chunk");
  if (chunk === undefined || typeof chunk.code !== "string") {
    throw new Error(`no bundle chunk for ${key}`);
  }
  const raw = Buffer.from(chunk.code);
  return { rawBytes: raw.length, gzipBytes: gzipSync(raw).length };
}

const candidateResults = {};
let expectedFails = 0;
for (const candidate of candidates) {
  const variants = variantsFor(candidate.title).map(({ name, results }) => {
    let passed = 0;
    let failed = 0;
    let expectedFailed = 0;
    for (const a of results) {
      if (name === VARIANT_NAMES[2] && a.title === KNOWN_CONTRACT_ISSUE) {
        if (a.status === "passed") expectedFailed += 1;
        else failed += 1;
      } else if (a.status === "passed") {
        passed += 1;
      } else {
        failed += 1;
      }
    }
    expectedFails += expectedFailed;
    return {
      name,
      total: results.length,
      passed,
      failed,
      ...(expectedFailed === 0 ? {} : { expectedFailed }),
    };
  });
  const bundle = await bundleBytes(candidate.key);
  candidateResults[candidate.key] = {
    name: candidate.label,
    version: candidate.version,
    spec: candidate.spec,
    adapter: candidate.adapter,
    bundle,
    variants,
  };
}

const contractTotal = Object.values(candidateResults).reduce(
  (sum, c) => sum + c.variants.reduce((n, v) => n + v.total, 0),
  0,
);
const contractPassed = Object.values(candidateResults).reduce(
  (sum, c) => sum + c.variants.reduce((n, v) => n + v.passed, 0),
  0,
);
const summary = {
  contractTestsPerVariant: 17,
  variantsPerCandidate: 3,
  candidates: candidates.length,
  contractAssertions: contractTotal,
  contractPassed,
  contractExpectedFailed: expectedFails,
  suiteTests: report.numTotalTests,
  suitePassed: report.numPassedTests - expectedFails,
  suiteExpectedFailed: expectedFails,
  suiteFailed: report.numFailedTests,
  knownContractIssue: KNOWN_CONTRACT_ISSUE,
};

const result = {
  runAt: new Date().toISOString(),
  generatedBy: "scripts/results.mjs (vitest JSON reporter + vite library build + gzip)",
  command: "pnpm run results",
  node: process.version,
  candidates: candidateResults,
  summary,
};

writeFileSync(`${root}results/contract.json`, `${JSON.stringify(result, null, 2)}\n`);

const lines = [
  `Contract: ${summary.contractTestsPerVariant} tests x ${summary.variantsPerCandidate} variants x ${summary.candidates} candidates = ${summary.contractAssertions} assertions`,
  ...Object.entries(candidateResults).map(
    ([key, c]) =>
      `  ${key}: ${c.variants.map((v) => `${v.name} ${v.passed}/${v.total}${v.expectedFailed ? ` (${v.expectedFailed} expected fail)` : ""}`).join(", ")}; gz ${c.bundle.gzipBytes} B`,
  ),
  `Suite: ${summary.suitePassed} passed, ${summary.suiteExpectedFailed} expected fail, ${summary.suiteFailed} failed (${summary.suiteTests} total)`,
];
writeFileSync(reportFile, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
