# @shopong/scenario-stokvel

The story 1.4 tracer: a scripted stokvel bulk order that runs end to end on the in-memory adapters
([`@shopong/adapters-memory`](../adapters-memory)). It writes real OCN events
([`@shopong/events`](../events)) through the ports ([`@shopong/ports`](../ports)), so the same script
can later run on the real adapters.

Pure TypeScript and deterministic. It never reads the wall clock, and the same `seed` always gives the
same event ids, so it runs the same in Node, browsers and Hermes.

```ts
import { webCryptoSha512 } from "@shopong/events";
import { createStokvelScenario } from "@shopong/scenario-stokvel";

const scenario = createStokvelScenario({ sha512: webCryptoSha512 });

await scenario.step(); // run the next scripted step; returns the timeline entries it added
const snapshot = await scenario.runAll(); // or run every remaining step
const check = await scenario.reconcile(); // compare the books with the record
```

| Call                  | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `step()` / `runAll()` | Run the next step, or all remaining steps                        |
| `rerun(step)`         | Run a step again; every event is identical, so nothing changes   |
| `reset()`             | Throw everything away and start again from step 1                |
| `snapshot()`          | Timeline, member status, funding and order summary at this point |
| `reconcile()`         | Compare the books with the record                                |
| `world()`             | The adapters, record and cast, for tests and tooling             |

Options: `sha512` (required; `webCryptoSha512` in Node and browsers), `seed` (default
`DEFAULT_SEED`) and `startAt`. The plan (members, amounts, supplier) is in `src/plan.ts`; the steps are
in `src/steps.ts`.

```sh
pnpm --filter @shopong/scenario-stokvel test
pnpm --filter @shopong/scenario-stokvel build
```
