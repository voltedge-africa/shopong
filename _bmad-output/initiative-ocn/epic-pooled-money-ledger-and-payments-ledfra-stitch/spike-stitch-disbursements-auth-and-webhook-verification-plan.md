---
title: "Stitch disbursements, auth and webhook verification"
ticket: 4
status: 'draft'
baseline_revision: '788a54d8ab1c5cedcf4ab94ed00f62779eefa091'
---

## Intent

**Re-scoped 2026-10-26.** The Stitch test client (step 1.6) is postponed by the product owner. This spike now delivers **a simulated Stitch adapter that passes the Payments contract**, plus the written list of what the real Stitch sandbox must still prove. Everything is labelled a simulation wherever a person or a log sees it.

**Problem:** The only `PayIn`/`PayOut` adapter is `MemoryPayIn`/`MemoryPayOut`. It signs webhooks with `fakeDigest`, not HMAC, and nothing in the Node uses a payments path, so story 4.3 and 4.5 have nothing to build on.

**Approach:** A new package, `@shopong/adapter-stitch-sim`, implements `PayIn` and `PayOut` behind the existing port, passes `runPayInContract` and `runPayOutContract` unchanged, and signs simulated webhooks with HMAC-SHA512 under a secret only the Node holds. The Node selects the adapter by configuration. Selecting `stitch` is refused until a real adapter passes the same suites.

## Boundaries & Constraints

**Always:** The simulation is named in every surface: component health `mode: "simulated-stitch"`, a start-up log line, `/ready`, the bank page banner, and `simulated: true` on every audit line. Its signing secret is `SIMULATED_WEBHOOK_SECRET` (32 bytes, Node only), never a Stitch credential. Webhooks are verified by `ingestWebhook`, the same path the real adapter will use. Money is integer minor units; decimal strings appear only at the Stitch-shaped boundary, built by integer arithmetic. The external reference is the event id (`eventIdOf`).

**Never:** Call a Stitch endpoint or read `STITCH_*` values in this path. Sign with `fakeDigest`. Make `simulated` a silent default: the mode is always named. Let a simulated result be recorded as a fact about Stitch. Edit the port's contract to make the simulation pass.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New request | Valid input, new reference | Pending request with an https URL | None |
| Same reference, same body | Repeat call | Same request; no second one | None |
| Same reference, other body | Changed amount | `idempotency_conflict` | Refused |
| Signed completion | Valid signature, pending | `applied: true`, once | None |
| Replayed webhook | Same delivery again | `applied: false` | None |
| Tampered or unsigned | Body changed, or no header | `invalid_signature`, nothing changes | Refused, audit line |
| Unknown payment | Webhook for an id never created | `unknown_payment` | Refused |
| Late completion | Completed after `expireAt` | Status stays `expired`; flagged for reconciliation | Open Question 7 |
| Payout without approval | Empty approvers | `invalid_request` | Refused |
| Restart | Persisted state present | Same status after restart | None |
| Amount to Stitch shape | 12550 minor, 100, 5 | `"125.50"`, `"1.00"`, `"0.05"` | Non-integer refused |
| `stitch` configured | No real adapter yet | Node refuses to start | Plain config error |

## Code Map

- `packages/ports/src/payments.ts` -- `PayIn`, `PayOut`, `WebhookDelivery`, `PayoutApproval`; the port is not changed.
- `packages/ports-contract/src/payments.ts` -- `runPayInContract`, `runPayOutContract`, the `settle` harness.
- `packages/ports-contract/src/support.ts` -- `registerContract`, `randomEventId`.
- `packages/adapters-memory/src/payments.ts` -- the reference; `PaymentBook` and `fakeDigest` (replace the digest, not the logic).
- `packages/adapters-memory/src/contracts.test.ts` -- the existing place that runs the suites.
- `packages/events/src/hash.ts` -- `HmacSha512` type is in `events`; `eventIdOf`.
- `apps/node/src/commitments.ts` -- `nodeHmacSha512`, injected HMAC to reuse.
- `apps/node/src/secrets.ts` -- `STITCH_CLIENT_ID`/`_SECRET` are required when `payments` is enabled; the simulated secret needs its own entry.
- `apps/node/src/config.ts`, `apps/node/src/components.ts` -- `payments` is off by default; `mode` is already reported.
- `apps/node/src/node.ts`, `apps/node/src/app.ts` -- wiring and routes; the webhook route and bank page go here.
- `apps/node/src/redact.ts` -- keeps secrets out of logs.
- `apps/node/src/commitment-route.ts`, `apps/node/src/signed.ts` -- patterns for an audited route.
- `packages/fixtures/recorded/stitch/payment-completed-webhook/request.json` -- `synthetic-from-docs`; body shape `PaymentInitiationRequestCompleted`, amount as `"125.50"`. Its signature is not documented: do not build a real check against it.
- `packages/fixtures/recorded/stitch/create-payment-request/` -- synthetic request shape.
- `docs/sandbox-setup.md` (step 1, Stitch, items 7 and 8) and `docs/spike-findings.md`.
- `_bmad-output/initiative-ocn/architecture-ocn/architecture-ocn.md` section 4.3 and 12.
- Not verified: the real Stitch webhook payload and signature method (technology-register F-4); the simulated adapter is not a substitute for either.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/adapter-stitch-sim` -- `PayIn` and `PayOut` with HMAC-SHA512 over the raw body, optional JSON persistence in the data folder, `build` and `check-types` scripts, tsconfig extending the base -- the adapter.
- [ ] A test file running `runPayInContract` and `runPayOutContract` against it, with fetch trapped -- the contract proof.
- [ ] `apps/node` -- `POST /webhooks/payments` (verified through `ingestWebhook`) and `GET /simulated-bank/:id` (banner; "Approve test payment" and "Cancel" buttons); both audit with `simulated: true`.
- [ ] `apps/node` config -- `PAYMENTS_ADAPTER=simulated|stitch`, simulated secret required only for `simulated`, Stitch secrets only for `stitch`, `mode` in health.
- [ ] `docs/decisions/4-4-stitch-sandbox-proof.md` -- the written list: client-credential token and scope; the exact mutation and its reuse behaviour; the real webhook payload and signature method; retries and delivery ids; `expireAt` rules; pay-by-bank limits per bank; the reference length limits; redirect allow-listing on localhost; disbursement endpoints, beneficiary fields, settlement times, fees; behaviour after abandoned pages.
- [ ] `shortcuts.md` -- rows S-4.4-n for: simulated, not real; Node-only simulated secret; no fixture from Stitch; wall-clock expiry; PayOut not exercised by any flow.

**Acceptance Criteria:**
- Given the Payments contract suites, when run against the simulated adapter, then every PayIn and PayOut case passes, and the in-memory adapter still passes unchanged.
- Given a signed completion webhook, then it is applied once; the replay is `applied: false`; a tampered body is refused.
- Given the Node starts in simulated mode, then `/ready`, the start-up log and the bank page each say "simulated".
- Given `PAYMENTS_ADAPTER=stitch` before a real adapter exists, then the Node refuses to start with a plain message.
- Given the written list, then each item names what the simulation cannot prove.

## Verification

- `pnpm run ci` -- exit 0.
- `pnpm --filter @shopong/adapter-stitch-sim test` (name to confirm) -- contract suites pass.
- Node tests for the webhook route, the bank page and the start-up refusal.
- Manual: start the Node in simulated mode, create a request, open its bank page, approve, check the audit line says simulated and the replay is refused.
- The app changes in 4.3, not here; no device check in this spike. Not verified in this draft.

## Open Questions

**Answered 2026-10-26 by the product owner: all recommended answers accepted (first option of every question). Testing rule: any story that changes the app is checked on web AND the Android emulator, every time; any older wording that says the emulator is checked only when asked is out of date. Stitch is simulated until the product owner has the Stitch account; the simulation is labelled everywhere and recorded as shortcuts.**

1. **Where does the adapter live?**
   - A) (Recommended) A new package `@shopong/adapter-stitch-sim`, as `adapter-ucan-iso` is. Clear labelling.
   - B) Inside `adapters-memory`. Mixes an in-memory fake with a named simulation.
2. **How is a simulated webhook signed?**
   - A) (Recommended) HMAC-SHA512 over the raw body with `SIMULATED_WEBHOOK_SECRET`, using the Node's injected HMAC.
   - B) Reuse `STITCH_CLIENT_SECRET`. Mixes a real credential with simulated data.
   - C) `fakeDigest`, as the memory adapter does. Not a real check.
3. **What shape does the simulated webhook body take?**
   - A) (Recommended) The documented `PaymentInitiationRequestCompleted` shape, with the amount as a decimal string. The mapping then carries over to the real payload; the simulated mark lives in the adapter's mode and the logs, not the body.
   - B) The memory adapter's own `{ type: "payment" }` shape. Simpler, but 4.5 would need a second mapping.
4. **How is the real Stitch adapter selected later?**
   - A) (Recommended) Configuration, `PAYMENTS_ADAPTER=simulated|stitch`. `stitch` is refused until the real adapter passes the same suites.
   - B) A build-time flag. Harder to see in a running Node.
5. **Are simulated payments kept across restarts?**
   - A) (Recommended) Yes: JSON in the data folder, written with fsync and rename as `communities.json` is.
   - B) No: in memory, with a shortcut row. A waiting member's request is lost on restart.
6. **Where does the written list of what the real sandbox must prove live?**
   - A) (Recommended) `docs/decisions/4-4-stitch-sandbox-proof.md`, an in-repo record that outlives this plan.
   - B) Only in this plan file, which sits in an epic folder.
7. **What if a completion arrives after the request expired?** The money may have moved.
   - A) (Recommended) Keep the status `expired`, do not apply it, and flag `late_completion` for the 4.5 reconciler and the operator.
   - B) Ignore it silently. A paid member would see "expired" with no trace.
8. **Does the simulation implement `PayOut` too?**
   - A) (Recommended) Yes. The Payments suite covers both, and an unexercised `PayOut` is recorded as a shortcut until 4.7.
   - B) `PayIn` only, and register only that suite. Then the adapter does not pass the whole Payments contract.

## Review Triage Log

Pass 1 (one Haiku read-only reviewer, 2026-10-26). 2 high, 3 medium, 5 low. The orchestrator also ran the real Node and clicked the bank page in a real browser.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The bank page's Approve and Cancel were unauthenticated and ids were sequential, so anyone on the network could approve a payment | high, real | patch | Ids are 128-bit random tokens and the page address is the capability; a guessed or sequential id gets the same 404 as an unknown one; production refuses to start with simulated payments unless `OCN_NODE_ALLOW_SIMULATED_PAYMENTS=true`; ids no longer appear in logs; tests failed first; checked with curl against the real Node |
| 2 | The buttons returned 415 in a real browser (a plain HTML form post has no matching parser) | high, real | patch | A form-post parser on the bank routes only; test failed first; mutation-checked; clicked Approve in a real browser: pending became completed |
| 3 | Cross-site forgery and framing of the bank page | medium, real | patch | The unguessable address stops forged requests; `X-Frame-Options: DENY`, a restrictive CSP, `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on every response (seen with curl) |
| 4 | Approving an expired request from the page wrote a fake late-completion flag | medium, real | patch | The page refuses with "This payment request has expired."; a late completion only comes from a signed webhook |
| 5 | A failed state write left memory ahead of disk, so a restart could re-apply a completion | medium, real | patch | Applied, then written; on failure the state is rolled back and the routes answer 503; mutation-checked |
| 6, 7 | No lock for two Nodes on one data folder; no directory fsync after rename | low | defer | S-4.4-18, S-4.4-19 |
| 8, 9, 10 | Weak webhook key accepted; two banners; an out-of-range expiry crashed the page | low, real | patch | Tested |

