/**
 * STUB: how real fixture recording will work once sandbox credentials exist.
 *
 *   node scripts/sandbox/record.ts <service> <scenario>
 *
 * It does nothing yet beyond explaining itself and checking credentials, so it is safe to run.
 *
 * Plan (to implement when STITCH_* / LEDFRA_* credentials exist; see docs/sandbox-setup.md):
 *  1. Refuse to run unless `check-env.ts --strict` passes for the named service. The target is a
 *     SANDBOX only: Stitch test client, Ledfra sandbox ledger. Never point it at live credentials.
 *  2. Read the existing synthetic fixture `packages/fixtures/recorded/<service>/<scenario>/request.json`
 *     as the request template. Replace placeholders (`Bearer <LEDFRA_API_TOKEN>`, ids) with real values
 *     in memory only.
 *  3. Send the request once with fetch (for Stitch first obtain a client-credentials token with the
 *     scope `client_paymentrequest`; for the webhook scenario, start a local listener and trigger
 *     `testClientPaymentInitiationRequestSimulateComplete`).
 *  4. Redact before writing: replace the Authorization header with its `Bearer <ENV_NAME>` placeholder,
 *     and replace tokens, client secrets and any real account or phone data with `<...>` placeholders.
 *     Fail the recording if the redacted output still contains any env value (the secret-leak guard).
 *  5. Write request.json, response.json and meta.json with `"source": "recorded"`, today's
 *     `capturedAt`, and no `todo`. Commit the three files in a PR; review the diff for secrets first.
 */
import { CHECKS, evaluate } from "./check-env.ts";

const [service, scenario] = process.argv.slice(2);

console.log(
  "record.ts is a stub. Real recording is not implemented until sandbox credentials exist.",
);
console.log("See the header of this file and docs/sandbox-setup.md.\n");

if (!service || !scenario) {
  console.log("usage: node scripts/sandbox/record.ts <service> <scenario>");
} else {
  const wanted = CHECKS.filter((c) => c.service.toLowerCase() === service.toLowerCase()).map(
    (c) => c.name,
  );
  const results = evaluate(process.env).filter((r) => wanted.includes(r.name));
  for (const r of results) console.log(`  ${r.status.padEnd(12)} ${r.name}`);
  console.log(`\nWould record ${service}/${scenario} once all of the above are present.`);
}
