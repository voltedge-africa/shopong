# Sandbox setup guide

Follow this once to get everything the sandbox environment needs (architecture.md section 8):
a Stitch test client, a Ledfra sandbox ledger, a Solana devnet and an EVM testnet wallet, a small
OSM extract and a set of sample supplier documents. Tests and CI never need any of it; they use
in-memory adapters and the recorded fixtures in `packages/fixtures`.

Each step is tagged:

- **[HUMAN]**: needs a person, an identity, a browser login or a decision. Agents must not do these.
- **[AGENT]**: a script or file that already exists, or that an agent can run.

Ground rules:

- Credentials live only in `.env` at the repo root (gitignored) or in key files outside the repo.
  They are used only by the OCN Node, never by a device or the web console (AGENTS.md rule 4).
- Start from the template: `cp scripts/sandbox/env.sandbox.example .env`.
- Never reuse a real or mainnet key for anything below. Never commit a `.env`, key or token.
- Check progress at any time: `node scripts/sandbox/check-env.ts` (prints present/missing, never values;
  add `--strict` to exit non-zero when something is missing).

| Item              | Status in this repo                                                  |
| ----------------- | -------------------------------------------------------------------- |
| Guide and scripts | Done: this file, `scripts/sandbox/*`                                 |
| Sample documents  | Done: `samples/` (synthetic, generated)                              |
| OSM extract       | Script done; run it ([AGENT] step 5)                                 |
| Fixtures          | First ones are synthetic-from-docs; real recordings need credentials |
| Accounts, wallets | **Pending [HUMAN]**: steps 1 to 4                                    |

## 1. Stitch

Env vars: `STITCH_CLIENT_ID`, `STITCH_CLIENT_SECRET`. GraphQL endpoint for test and live:
`https://api.stitch.money/graphql`. Docs: https://docs.stitch.money.

1. **[HUMAN]** Create a Stitch account and sign in to the Stitch dashboard.
2. **[HUMAN]** Create a **test client** (not a live one). Test clients let you simulate payments without moving money.
3. **[HUMAN]** Enable **payment initiation** for the test client and grant the scope `client_paymentrequest`.
4. **[HUMAN]** Add the redirect URIs the client may use. Stitch only redirects back to **allow-listed** URIs
   (HTTPS in production; localhost is for development). Register at least the local development ones:
   - `http://localhost:8081` (Expo Metro / Expo web default)
   - `http://localhost:3000` (OCN Node default dev port, if no other port is set in `apps/node`)
   - `http://localhost:5173` (Vite dev server, web console)
   - `http://localhost:19006` (older Expo web port, harmless to add)

   Note: the task brief mentioned "the default localhost ports". We could not confirm from the Stitch pages we
   read which localhost ports a test client allows by default, so register the list above explicitly and
   correct this list when you see what the dashboard offers.

5. **[HUMAN]** Copy the client id and secret into `.env` as `STITCH_CLIENT_ID` and `STITCH_CLIENT_SECRET`.
   The secret is shown once; store it in a password manager as well.
6. **[HUMAN]** Import Stitch's **Postman collection** (linked from the Stitch docs) and run a client-credentials
   token request with scope `client_paymentrequest` to confirm the client works.
7. **[HUMAN]** Register a **webhook endpoint** for `payment` events (`PaymentInitiationRequestCompleted`,
   `...Cancelled`, `...Expired`). Stitch must reach it over public HTTPS, so run the OCN Node behind a tunnel
   during development and register the tunnel URL plus the Node's webhook path (`/webhooks/stitch` is the
   path used by the fixtures; change it in `packages/fixtures` if the Node differs).
8. **[HUMAN]** Note how Stitch signs webhooks and what the real payload looks like (not covered by the pages
   we read; technology-register F-4). Webhooks are the source of truth for payment results; redirect parameters
   are untrusted.
9. **[AGENT]** Once `.env` has the values, record real fixtures with `scripts/sandbox/record.ts` (currently a
   documented stub) and replace the `synthetic-from-docs` ones in `packages/fixtures/recorded/stitch/`.

Useful test facts: `testClientPaymentInitiationRequestSimulateComplete` completes a payment request on a test
client; scenario triggers (amounts, references, account numbers) simulate failures. Pay-by-bank (RTP) limits
in ZAR: 3,000 (Absa, African Bank, Capitec, Investec, Standard Bank), 10,000 (FNB), 50,000 (Discovery, Nedbank).

## 2. Ledfra

Env vars: `LEDFRA_API_TOKEN`, `LEDFRA_LEDGER_ID`. Site: https://ledfra.com.

> **Deadline and cost warning.** Creating a Ledfra workspace **starts a 6-month free period**. The Early Access
> price of **$99/month is locked only if the workspace is created before 2026-12-31**; from 2027-01-01 the Growth
> plan is $399/month (30,000 posted transactions per month included, then $10 per 1,000). Creating the
> workspace is therefore a decision, not just a setup step: make it before 2026-12-31 to keep the lock, and
> remember the free period runs from the day you create it. Product owner to confirm before step 1.

1. **[HUMAN]** Decide to create the workspace now (see the warning), then create it.
2. **[HUMAN]** Create a **sandbox ledger** inside the workspace (the docs mention sandboxes and an OpenAPI spec).
3. **[HUMAN]** Create an API token and copy it, with the ledger id, into `.env` as `LEDFRA_API_TOKEN` and
   `LEDFRA_LEDGER_ID`. Requests use `Authorization: Bearer <token>` against
   `POST /api/ledgers/{ledgerId}/transactions`.
4. **[HUMAN]** Make `liabilities:member/*` style accounts **guarded** so that overdrawing returns 422 (accounts
   are created on first reference; how guarding is configured is not stated in the pages we read). Record the
   answer, together with the real API host, here.
5. **[HUMAN]** Record the open questions that decide the design (technology-register F-3): per-community
   tenancy, reversals, export, rate limits.
6. **[AGENT]** Record real fixtures for post, idempotent replay, unbalanced (400), guarded (422) and
   idempotency conflict (409) with `scripts/sandbox/record.ts`, replacing the synthetic ones in
   `packages/fixtures/recorded/ledfra/`. The fixtures assume the host `https://api.ledfra.example`; fix it then.

## 3. Solana devnet wallet

Env var: `SOLANA_DEVNET_KEYPAIR_PATH` (path to a keypair JSON file **outside the repo**).

1. **[HUMAN]** Install the Solana CLI.
2. **[HUMAN]** Create a throwaway keypair: `solana-keygen new --no-bip39-passphrase --outfile ~/.config/shopong/solana-devnet.json`.
   Never import a real wallet or reuse a mainnet key.
3. **[HUMAN]** Fund it from a faucet: `solana airdrop 2 --url devnet --keypair ~/.config/shopong/solana-devnet.json`,
   or the web faucet at https://faucet.solana.com if the CLI airdrop is rate limited.
4. **[HUMAN]** Put the absolute path in `.env` as `SOLANA_DEVNET_KEYPAIR_PATH`.

ZARsc is a Solana Token-2022 token with no public sandbox (technology-register), so devnet holds only SOL for
fees; stablecoin tests will deploy a test token later (AD-12: the stablecoin rail is optional).

## 4. EVM testnet wallet

Env var: `EVM_TESTNET_PRIVATE_KEY_PATH` (path to a file holding one private key, **outside the repo**).
Use **Base Sepolia**: ZARP is deployed on Base, so this is the closest testnet.

1. **[HUMAN]** Generate a throwaway key: `openssl rand -hex 32 > ~/.config/shopong/evm-testnet.key && chmod 600 ~/.config/shopong/evm-testnet.key`.
   Derive the address with any tool you trust (for example Foundry's `cast wallet address --private-key $(cat ...)`).
2. **[HUMAN]** Fund the address with Base Sepolia ETH from a testnet faucet (several providers exist; use whichever is working).
3. **[HUMAN]** Put the absolute path in `.env` as `EVM_TESTNET_PRIVATE_KEY_PATH`.

ZARP has no known testnet deployment; as with Solana, the testnet wallet holds gas only for now.

## 5. OSM extract for Valhalla

No account needed.

1. **[AGENT]** `bash scripts/sandbox/fetch-osm-extract.sh`. It downloads a pinned **Eswatini** snapshot
   (Geofabrik `swaziland-261023.osm.pbf`, 2026-10-23, about 31 MB) to `.cache/osm/` (gitignored), checks
   Geofabrik's published MD5, and verifies the committed SHA-256 in `scripts/sandbox/swaziland-261023.osm.pbf.sha256`.
2. Licence: **ODbL 1.0**, data (c) OpenStreetMap contributors, extract by Geofabrik. Attribution is required
   wherever the data or tiles built from it are shown (https://www.openstreetmap.org/copyright).
3. **[AGENT]** Building Valhalla graph tiles from the `.osm.pbf` (`pnpm run data:osm` in valhalla-wasm) belongs to
   the logistics epic. The pilot region (a South African province) will need its own, larger extract.
4. If the dated file is no longer on Geofabrik, change `SNAPSHOT` in the script, delete the `.sha256` file, run it,
   and commit the newly recorded checksum.

### 5a. Map releases (story 7.2)

The tile build for the served map is `scripts/tiles/` (the Eswatini file above is only a rehearsal pin).

- **Region.** D-8 was decided by the product owner on 2026-10-26 as option A: the national South Africa extract
  (`scripts/tiles/pins/south-africa.json`, Geofabrik snapshot 2026-10-25, SHA-256 and MD5 checked). Geofabrik publishes
  no KwaZulu-Natal file. The pilot still runs in KwaZulu-Natal; a later release can clip to a smaller box (option B) if
  the size or build time becomes a problem.
- **Scratch.** Downloads and builds go to `$SCRATCH`, which defaults to `~/.cache/ocn-tiles`, never a shared `/tmp`
  path. Each run checks it: it must be a real folder (not a symbolic link) owned by you, with no group or other write
  access. It is created with mode 0700 when missing; for an existing folder run `chmod 700` on it. The builder
  checkout is pinned to commit `b09d0ceb…`, and the native tools are reused only when that commit is checked out and
  the SHA-256 of each recorded binary still matches; otherwise they are rebuilt.
- **Pins.** `scripts/tiles/pins/<region>.json` names the extract, its snapshot date and SHA-256, the coverage box, the
  pinned Valhalla builder and the attribution. The extract is downloaded to `$SCRATCH/osm` and checked (Geofabrik
  MD5, then the pinned SHA-256) before any build. A build's own folder is removed on exit, success or failure.
- **Build.** `RELEASES_DIR=<folder outside the repo> bash scripts/tiles/build-release.sh <pin> <release-name>`. It runs
  the pinned builder in Docker. A release is `<RELEASES_DIR>/<release-name>/` with `manifest.json` (SHA-512 and size
  of every file, the ODbL attribution, the source date and SHA-256), `manifest.sha512` and the tile files. The name
  is never overwritten: the same bytes report `unchanged`, different bytes are refused with
  "Release <name> already exists.".
- **Verify.** `bash scripts/tiles/verify-release.sh <RELEASES_DIR> <release-name>`. The manifest's SHA-512 digest is a
  consistency check, not a signature: it shows the manifest and files agree, not who made them (shortcut S-7.2-15).
- **Serve.** The Node reads `tiles.releasesDir` (or `OCN_NODE_TILES_DIR`), which must sit outside the data folder,
  and `tiles.activeRelease` (or `OCN_NODE_TILES_RELEASE`). Routes: `GET /map/active/...` and
  `GET /map/<release>/...`, read-only, byte ranges, files the manifest lists only. TLS is a reverse proxy's job.
- **Licence.** Tiles built from OpenStreetMap are treated as a derived database under ODbL 1.0: attribution is
  shown, and the share-alike position needs counsel's confirmation before the first public release.

## 6. Sample supplier documents

1. **[AGENT]** Already committed in `samples/`: 3 price lists (clean PDF, low-contrast photographed-style PNG,
   pack-size table), 2 invoices and 2 delivery notes, all fictional and watermarked "SAMPLE - NOT REAL", with
   ground-truth rows in `samples/README.md` and `samples/ground-truth.json`.
2. **[AGENT]** Regenerate with `python3 samples/generate.py` (python3 and Pillow).
3. **[HUMAN]** Later, for real OCR accuracy (F-6), obtain a few **real** supplier documents with the supplier's
   permission. Keep them out of this repo; the synthetic set is only for repeatable tests.

## Done checklist

- [ ] `.env` created from the template and filled in for Stitch, Ledfra, Solana and EVM
- [ ] `node scripts/sandbox/check-env.ts --strict` exits 0
- [ ] `bash scripts/sandbox/fetch-osm-extract.sh` prints a verified extract
- [ ] Real fixtures recorded and the `synthetic-from-docs` ones replaced
- [ ] Ledfra workspace creation date noted (free period end date, price lock before 2026-12-31)
