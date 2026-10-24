# @shopong/ports-contract

One contract test suite per port in [`@shopong/ports`](../ports). A suite registers
`vite-plus/test` tests against whatever adapter you give it. Every adapter, real or
in-memory, must pass its port's suite unchanged.

```ts
// packages/adapters-ledfra/src/ledfra.contract.test.ts
import { runLedgerContract } from "@shopong/ports-contract";
import { LedfraLedger } from "./index.js";

runLedgerContract(() => new LedfraLedger({ ledgerId: process.env.LEDFRA_SANDBOX_LEDGER! }), {
  timeoutMs: 30_000,
});
```

Each `run*Contract(factory, options?)` takes a factory that is called once per test. Some ports
need more than the adapter, so the factory returns a small harness:

| Suite                       | Factory returns                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `runCapabilityAuthContract` | `CapabilityAuth`                                                                        |
| `runSharedRecordContract`   | `{ peer(), replicate(a, b) }`: fresh peers, and a way to sync two of them               |
| `runLedgerContract`         | `Ledger`                                                                                |
| `runPayInContract`          | `{ payIn, settle(id, outcome) }`: drives the processor's test mode, returns the webhook |
| `runPayOutContract`         | `{ payOut, settle(id, outcome) }`                                                       |
| `runStableRailContract`     | `{ rail, fund(address, amount), confirmTimeoutMs? }`: faucet or test mint               |
| `runOcrContract`            | `{ ocr, document, expectedText, missing }`: a readable fixture and a missing one        |
| `runDecideContract`         | `Decide`                                                                                |
| `runRoutingContract`        | `{ routing, origin, destination, outside }`: points inside and outside the tiles        |
| `runGeoContract`            | `Geo`                                                                                   |
| `runAgentContract`          | `{ agent, owner, capability }`: a session capability issued upstream                    |
| `runGenUiContract`          | `GenUi`                                                                                 |

The suites are written so they also hold for a real service:

- **No shared state between tests.** Account slugs, idempotency keys, event ids, table names
  and wallet labels are unique per run (`unique()`, `randomEventId()`), so a persistent sandbox
  works.
- **No timing assumptions.** Chain confirmations are polled with `eventually()`. Webhooks
  come from the harness, never from a sleep.
- **No ordering assumptions.** Query results without `orderBy` are compared after sorting.
  `SharedRecord` convergence is checked across different replication orders.
- **No adapter-specific error order.** For example, an amplifying delegation may be refused
  at `issue` or at `verify`. Both are accepted, but one of them must refuse it.

The cases are also exported as arrays (`ledgerContract`, `capabilityAuthContract`, ...) so a
single case can be run by hand. `@shopong/adapters-memory` uses this to prove the suites fail
for deliberately broken adapters.
