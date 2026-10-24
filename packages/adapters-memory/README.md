# @shopong/adapters-memory

A complete in-memory adapter for every port in [`@shopong/ports`](../ports). The adapters are
deterministic (they take an injected `Clock` and `IdGenerator`; defaults are a manual clock at
2026-01-01 and a counter), use no network, and are pure TypeScript. They back the unit tests
and the scripted stokvel tracer (story 1.4). Each one passes its port's contract suite; see
`src/contracts.test.ts`.

Test controls stand in for the outside world:

| Adapter                        | Test control                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `createMemoryRecordNetwork`    | `peer(did)` and `replicate(a, b)`: separate replicas, synced only when you say      |
| `MemoryCapabilityAuth`         | `keyring` shared between instances; `checkAttenuationOnIssue: false` to test verify |
| `MemoryPayIn` / `MemoryPayOut` | `simulateWebhook(id, outcome)` returns a signed delivery to feed to `ingestWebhook` |
| `MemoryStableRail`             | `mint(address, amount)`; `confirmAfterReads` controls confirmation delay            |
| `MemoryOcr`                    | `addDocument({ uri, sha512, pages })` fixtures                                      |
| `MemoryDecide`                 | `answer(question, state)` to script decisions                                       |
| `MemoryRouting`                | `bounds` and `tileRelease`                                                          |
| `MemoryAgent`                  | understands `tool "<name>" with input {<json>}` in prompts                          |

**Not cryptography.** Token signatures, webhook signatures and ids use a fast
non-cryptographic digest (`fakeDigest`). It detects tampering in tests and nothing more.
Never use these adapters with real money, keys or personal data.
