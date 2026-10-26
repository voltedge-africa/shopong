# Decision 4.4: what the real Stitch sandbox must still prove

**Status:** written for the product owner's re-scope of spike 4.4 (2026-10-26). The Stitch test client (sandbox setup step 1.6) is postponed until the product owner has the Stitch account.
**Story:** 4.4 (simulated Stitch behind the Payments port, `packages/adapter-stitch-sim`)
**Plan:** `_bmad-output/initiative-ocn/epic-pooled-money-ledger-and-payments-ledfra-stitch/spike-stitch-disbursements-auth-and-webhook-verification-plan.md`

## Question

Which facts about Stitch are still unverified, so that the simulated adapter cannot stand in for them? Each item below names what must be proven against the real sandbox, what the simulation assumes instead, and a test that proves it. A real Stitch adapter is accepted only when it passes the Payments contract suites and every item here is closed.

## What the simulation does and does not prove

It proves OCN's own side of a payment: the state rules (pending, then one terminal state, never changed again), idempotency by external reference, verification of a signed webhook before any change, a completion after expiry flagged and not applied, and state that survives a restart.

It proves nothing about Stitch. Every Stitch-shaped value it produces (ids, URLs, headers, event type names, limits) is ours.

## The items

1. **Client-credential token and scope.**
   - Must prove: a token is issued from the client id and secret; it carries scope `client_paymentrequest`; it creates a payment request; a token without that scope is refused; its lifetime (`expires_in`) and how it is renewed.
   - The simulation assumes: nothing. It has no token and reads no credential.
   - Test: request a token with the scope and call `clientPaymentInitiationRequestCreate` with it (expect a `url`); call it with a token lacking the scope (expect a refusal); record `expires_in`.

2. **The exact create mutation and its reuse behaviour.**
   - Must prove: the mutation name and input shape (`amount.quantity` as a decimal string, `payerReference`, `beneficiaryReference`, `externalReference`, `expireAt`, `paymentMethods`); that two calls with the same `externalReference` and identical input return the same `paymentInitiationRequest.id`; and the error code and text when the same reference comes with a changed amount.
   - The simulation assumes: the same id on an identical repeat; `idempotency_conflict` on a changed body.
   - Test: call twice with identical input and compare ids; call with a changed amount and record the error.

3. **The real webhook payload and signature method (technology register F-4).**
   - Must prove: the signature header name(s); the bytes signed (raw body or something else); the algorithm, key and encoding; whether a timestamp or nonce is inside the signature; the exact event type names for completed, cancelled, expired and failed; and whether amounts arrive as `125.50` or `125.5`.
   - The simulation assumes: HMAC-SHA512 over the raw body, hex, in `x-simulated-signature`, under a key the Node invented (`SIMULATED_WEBHOOK_SECRET`). The event type names for cancelled and expired follow the documents; `PaymentInitiationRequestFailed` and every disbursement type are simulation-only names.
   - Test: capture a real delivery through a tunnel, verify it with the documented scheme, change one byte and confirm refusal, and confirm the adapter refuses it or accepts it only after its verifier is changed to the real scheme.

4. **Retries and delivery ids.**
   - Must prove: whether Stitch retries a delivery that got a non-2xx answer; how many times and at what intervals; whether a retry carries the same delivery id; and what stops retries.
   - The simulation assumes: no retries. Replays happen only in tests, and they are harmless because a terminal request is never changed.
   - Test: make the Node answer 500 to one delivery, count the deliveries Stitch sends, and compare their ids; confirm a 2xx stops the retries.

5. **`expireAt` rules.**
   - Must prove: the minimum and maximum lead time for `expireAt`; the status a request holds after its expiry passes; whether an Expired event is sent, and when; whether a completion can still arrive after expiry (the case the simulation flags as a late completion).
   - The simulation assumes: expiry on the Node's clock, judged when the request is read or a webhook arrives, with no processor timer.
   - Test: create a request expiring two minutes ahead; wait past it; read its status; then run the test-mode completion and record whether it succeeds and which event arrives.

6. **Pay-by-bank limits per bank.**
   - Must prove: the amount limits per bank (the register lists 3,000 ZAR for Absa, African Bank, Capitec, Investec and Standard Bank; 10,000 for FNB; 50,000 for Discovery and Nedbank) and the 1.00 ZAR minimum, confirmed at each bank's boundary.
   - The simulation assumes: no limits.
   - Test: create requests at the boundary amounts for each bank's test scenario and record which are accepted.

7. **Reference length limits and character set.**
   - Must prove: the accepted length of `payerReference` (12 in the register), `beneficiaryReference` (20) and `externalReference` (up to 4096), and which characters (spaces, punctuation, accented letters) are accepted or stripped.
   - The simulation assumes: lengths only, no character rules.
   - Test: create at exactly the maximum and at maximum plus one; include a space and an accented letter in each reference; record what is stored and what is shown on the bank page.

8. **Redirect allow-listing on localhost.**
   - Must prove: which `redirect_uri` values the test client accepts, in particular which localhost ports (sandbox setup step 4 lists 8081, 3000, 5173 and 19006 but was not confirmed).
   - The simulation assumes: no redirects, and no redirect URL is used.
   - Test: attempt a redirect to each listed localhost port and to one unlisted port; record which ones the processor accepts.

9. **Disbursements: endpoints, beneficiary fields, settlement and fees.**
   - Must prove: the disbursement mutation and its input (beneficiary name, bank id, account number, account type, reference); its statuses and the webhook types it sends; that Stitch has no approval step (OCN holds the approval); settlement time per bank; any fee on the response.
   - The simulation assumes: a payout shape of OCN's own, named `SimulatedDisbursement*`. Nothing about settlement or fees.
   - Test: create one disbursement to a sandbox test account; record each status, the webhook that follows, the time to completion and any fee.

10. **Behaviour after abandoned pages.**
    - Must prove: what happens to a request whose payer opens the hosted page and leaves without paying: whether it stays pending until expiry, becomes cancelled, or fails; and whether a Cancelled event is sent in each case.
    - The simulation assumes: nothing is abandoned. Its bank page has no timer and no payer.
    - Test: open the hosted URL, close the page, and poll the status at 0, 5 and 30 minutes and at expiry; record each state and each webhook.

## The webhook route path

The route the simulation serves is `POST /webhooks/payments`. That path is ours to choose. The fixture at `packages/fixtures/recorded/stitch/payment-completed-webhook/request.json` names `/webhooks/stitch`, which is only a placeholder for where a real Stitch webhook URL would point. Against real Stitch, the webhook URL must be configured in the Stitch dashboard (sandbox setup step 7) to point at whichever path the Node serves; the fixture is not edited to match. Proof item 3 includes checking the URL Stitch actually calls.

## Done when

Each item above has a recorded result (the command or the sandbox screenshot, and the date), the simulation's assumptions in the items are either confirmed or changed in the code, and the adapter has been run against the real sandbox and passes the Payments contract suites. Until then `PAYMENTS_ADAPTER=stitch` stays refused.
