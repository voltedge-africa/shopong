# Agent instructions for Shopong

## What this is

**OCN (Open Commerce Network)** is open, modular infrastructure for connected microeconomies in South Africa: stokvels, spaza shops, street and social sellers, suppliers, drivers and funders. **Shopong** is the Expo universal app (iOS, Android, web) that is one access point to OCN and its first demonstration. Principle: **OCN provides the infrastructure. People define the use.**

The acronym is **OCN**. Never write "OCM".

## Where the plan lives

| Path                                            | What it holds                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `_bmad-output/initiative-ocn/brief-ocn/`        | The idea, the spine, who it serves                                                |
| `_bmad-output/initiative-ocn/architecture-ocn/` | Runtime places, ports and adapters, event envelope, security, decisions (AD-\*)   |
| `_bmad-output/initiative-ocn/spec-ocn/`         | Requirements inventory and `technology-register.md` (verified facts, links)       |
| `_bmad-output/initiative-ocn/tickets.toml`      | The 12 epics in build order, with the `after` prerequisites between them          |
| `_bmad-output/initiative-ocn/epic-*/`           | One folder per epic: `tickets.toml` (stories), epic file, one plan file per story |
| `docs/source/`                                  | Original inputs: project spine PDF, technology-stack diagram, technology links    |

A story is an entry in its epic's `tickets.toml` (`description`, `verify`, `covers`, `after`). Its status lives in the plan file beside the epic's `tickets.toml` (`<type>-<slug>-plan.md`, `status:` in the frontmatter). Full acceptance criteria are written when the ticket is refined during the build (`bmad-build`), not in advance. The folder layout is the `bmad-ticket` ticket tree, the same as the sovren project.

Read the story's entry, its epic and the relevant sections of `_bmad-output/initiative-ocn/architecture-ocn/architecture-ocn.md` before you start. If the plan and the code disagree, stop and say so in the PR rather than silently picking one.

## Non-negotiable architecture rules

1. **Ports and adapters.** Every capability is a typed port with a contract test suite. Every third-party technology is an adapter behind a port, and every adapter (including the in-memory one) must pass that port's contract suite.
2. **One versioned event envelope.** `{ v, type, space, actor, proof, claimedAt, nonce, payload }`. Add new event types; do not invent a second envelope.
3. **Autobase `apply` is deterministic.** No wall clock, no network, no randomness, no environment reads inside `apply`. Same inputs, same view, on every device.
4. **Secrets live only on the OCN Node.** Stitch, Ledfra, stablecoin and LLM credentials are never shipped to, stored on or requested by a device or the web console.
5. **Event id = SHA-512 of the canonical JSON** of the event (hex). It is the idempotency key for every external side effect and the reconciliation key across the record, the ledger, payments and the chain.
6. **PII only as keyed commitments.** The shared record holds `HMAC-SHA512(communitySecret, value)`, never phone numbers, ID numbers or exact addresses. Replicated logs cannot be edited, so choose what is written first.
7. **Heavy WASM stays in the web console.** DuckDB-WASM and Valhalla-WASM are never bundled into the mobile app. Kepler.gl is the one exception (AD-20): it ships in the app only as the built page in `miniapps/vendor/delivery`, shown in a sandboxed WebView by the Delivery mini app.
8. **Agents reach capabilities only through the OCN Capability MCP server**, which checks a UCAN on every call. No direct adapter, network or secret access from an agent runtime; money actions need human confirmation.

## Story delivery protocol

- **Branch:** `story/<epic>-<story>-<slug>`, for example `story/1-3-event-envelope-and-canonical-hashing`.
- **One PR per story.** Keep it scoped to that story's acceptance criteria.
- **PR body** lists every acceptance criterion of the story as a checkbox, ticked, with how each was verified (test name, command output, screenshot).
- **Tests are required.** New behaviour comes with tests; `pnpm run ci` must pass.
- **Do not edit the `status:` of a plan file** in a story PR. The orchestrator updates it after merge.
- **Never commit secrets**, `.env` files, keys, tokens or media files. Use `.env.example` with placeholder values.
- **No new dependency without a note** in the PR saying why it is needed and what its licence is. Pin versions; commit the lockfile.
- `main` is protected by convention: every change lands through a PR.

## Commands

```sh
pnpm install          # install (Node >= 24, pnpm via corepack; also installs the Vite+ git hooks)
pnpm run test         # vp test
pnpm run lint         # vp lint
pnpm run format       # vp fmt
pnpm run check-types  # tsc --noEmit in every package
pnpm run build        # build every package
pnpm run ci           # full local check: vp check, check-types, test, build (no GitHub Actions workflow)
```

New packages go in `packages/*` (libraries) or `apps/*` (runnables), named `@shopong/<name>`, with `build` and `check-types` scripts and a `tsconfig.json` that extends `../../tsconfig.base.json`. Tests import from `vite-plus/test`.
