# @shopong/ports

The typed ports for every OCN capability (AGENTS.md rule 1, architecture 3.2). Each port is a
TypeScript interface plus a few small value types and pure helpers. There are no runtime
dependencies and no Node-only imports, so the package runs in React Native (Hermes), the
browser and Node.

- **Contract suites:** [`@shopong/ports-contract`](../ports-contract) has one suite per port.
  Every adapter must pass its port's suite, including the in-memory one.
- **In-memory adapters:** [`@shopong/adapters-memory`](../adapters-memory) has one adapter per
  port. They are deterministic, need no network, and take an injectable clock and id source.

## Ports

| Port             | Purpose                                                                                               | In-memory adapter           | Planned real adapter                                              | Owning epic |
| ---------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- | ----------- |
| `CapabilityAuth` | Identities and delegated, attenuated authority. `verify` evaluates against a supplied log time.       | `MemoryCapabilityAuth`      | ts-ucan (`@ucans/ucans`); `iso-ucan` fallback (D-3)               | 2           |
| `SharedRecord`   | A community's multi-writer, offline-first record with a deterministic view and writer admission.      | `createMemoryRecordNetwork` | Autobase + Hyperbee/Hyperdrive over Hyperswarm                    | 3           |
| `Ledger`         | Double-entry books: balanced, idempotent, immutable, guarded accounts, trial balance.                 | `MemoryLedger`              | Ledfra (D-2)                                                      | 4           |
| `PayIn`          | Collect money into the pool: payment requests, status and verified webhooks.                          | `MemoryPayIn`               | Stitch payment initiation requests                                | 4           |
| `PayOut`         | Pay suppliers once approval has been decided upstream. Verified webhooks.                             | `MemoryPayOut`              | Stitch disbursements (spike 4.4)                                  | 4           |
| `StableRail`     | Optional stablecoin rail: custody wallets, idempotent transfers, asynchronous confirmation.           | `MemoryStableRail`          | ZARP or ZARsc (D-1)                                               | 5           |
| `Ocr`            | Document in; typed blocks with page-relative boxes and confidence out.                                | `MemoryOcr`                 | Unlimited-OCR via vLLM                                            | 6           |
| `Decide`         | Typed questions (`choice`, `score`, `noul`) in; answers with calibrated confidence out.               | `MemoryDecide`              | Laya via `laya-serve`                                             | 6           |
| `Routing`        | One route: distance, time, polyline6 and the tile manifest release id.                                | `MemoryRouting`             | Valhalla (`valhalla-browser` / `valhalla-server`)                 | 7           |
| `Geo`            | Load rows, then run structured filter, spatial and aggregate queries.                                 | `MemoryGeo`                 | DuckDB-WASM (web console), results drawn by Kepler.gl             | 7           |
| `Agent`          | Agent sessions under a narrower capability. Tools only via a registry; money tools need confirmation. | `MemoryAgent` (scripted)    | OpenCode server mode or Pi behind the Capability MCP server (D-9) | 11          |
| `GenUi`          | Component library and model output in; a validated UI document or a rejection out.                    | `MemoryGenUi` (JSON source) | OpenUI (`@openuidev/react-lang`, OpenUI Lang)                     | 11          |

## Conventions

- **Results, not exceptions, for expected outcomes.** Ports return `Result<T, PortError>` for
  outcomes a caller must handle (unbalanced, expired, conflict). Infrastructure failures
  (network down, service unavailable) reject the promise.
- **Money is integer minor units** (`Money { currency, minor }`). Stablecoin amounts are
  base-unit decimal strings, because 18-decimal tokens overflow a JavaScript number.
- **`EventId`** is a branded 128-character lowercase hex string (SHA-512 of the canonical
  event). `@shopong/events` computes it. Ports only carry it as the idempotency and
  reconciliation key.
- **`SharedRecord` is generic over the event type**, so it does not depend on the envelope
  package.
- **No wall clock where determinism matters.** `CapabilityAuth.verify` takes `logTime`.
  Adapters take an injected `Clock` and `IdGenerator`.
- **Secrets stay on the OCN Node.** `Ledger`, `PayIn`, `PayOut` and `StableRail` adapters run
  only there (AGENTS.md rule 4). `Routing` and `Geo` real adapters never ship in the mobile
  app (rule 7).
