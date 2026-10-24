# @shopong/fixtures

Recorded request/response pairs for the outside services OCN talks to, so tests run without
touching real money or data (story 1.6).

## Layout

```
packages/fixtures/recorded/<service>/<scenario>/
  request.json    { method, url, headers?, body? }   what the Node sends (outbound) or receives (inbound)
  response.json   { status, headers?, body? }        what came back (outbound) or what the Node must answer (inbound)
  meta.json       { service, scenario, description, direction, source, references, capturedAt, todo? }
```

`service` and `scenario` are lowercase-dash names and must equal the directory names.
Secrets are never stored: `authorization` headers hold a placeholder such as `Bearer <LEDFRA_API_TOKEN>`.

## Source labels

- `"source": "recorded"`: captured from a real sandbox by `scripts/sandbox/record.ts`.
- `"source": "synthetic-from-docs"`: hand-written from the vendor documentation. Must carry a `todo`
  saying how to replace it. **Every shipped fixture is currently synthetic**; replace them once the
  sandbox credentials in `docs/sandbox-setup.md` exist.

## API

```ts
import { loadFixture, loadAll, listFixtures, createReplayFetch } from "@shopong/fixtures";

const fixture = loadFixture("ledfra", "unbalanced-400");
const fetch = createReplayFetch([fixture]); // pass only the fixtures the test needs
const res = await fetch(fixture.request.url, {
  method: "POST",
  headers: fixture.request.headers,
  body: JSON.stringify(fixture.request.body),
});
```

`createReplayFetch` answers only `outbound` fixtures, matching on method, URL, JSON body (key order
ignored) and `Idempotency-Key` when recorded. Anything else rejects with `NoFixtureMatchError`, so a
test can never reach a vendor by accident. `ledfra/post-transaction` and `ledfra/idempotent-replay`
share a request on purpose (same key, same body) and differ in response: load one or the other.
