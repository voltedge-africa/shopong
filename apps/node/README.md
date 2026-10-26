# @shopong/node

The **OCN Node**: the always-on service that holds service secrets and, in later stories, seeds the shared record, talks to the ledger and payment providers, and verifies capabilities. This package is the skeleton: typed configuration, a secret registry, structured logging with redaction, and `/health` and `/ready`. The four components (`record`, `ledger`, `payments`, `queue`) are in-memory stubs for now.

## Run

```sh
pnpm install
pnpm --filter @shopong/node dev      # watch mode, loads apps/node/.env if present
curl localhost:8787/health
```

```sh
pnpm --filter @shopong/node build && pnpm --filter @shopong/node start
node --import ./src/register.mjs src/main.ts --config ./ocn-node.config.example.json
```

Requires Node 24 or later (it runs the TypeScript sources directly). `src/register.mjs` installs a resolve hook so the workspace packages' `.js` imports find their `.ts` sources; `dev` and `start` already load it.

## Configuration

Precedence, lowest to highest: defaults, JSON config file, environment variables. The config file is `--config <path>` or `OCN_NODE_CONFIG`; see `ocn-node.config.example.json`. Unknown keys and bad values are refused.

| Setting          | Config file                   | Environment               | Default     |
| ---------------- | ----------------------------- | ------------------------- | ----------- |
| Listen host      | `server.host`                 | `OCN_NODE_HOST`           | `127.0.0.1` |
| Listen port      | `server.port` (0 = ephemeral) | `OCN_NODE_PORT`           | `8787`      |
| Log level        | `logLevel`                    | `OCN_NODE_LOG_LEVEL`      | `info`      |
| Component on/off | `components.<name>.enabled`   | `OCN_NODE_<NAME>_ENABLED` | see below   |

Components: `record` (on), `queue` (on), `ledger` (off), `payments` (off). Ledger and payments default to off because they need secrets.

## Secrets

Declared in code in `src/secrets.ts`. A secret is read **only** from the environment: `KEY`, or `KEY_FILE` holding a path to a file with the value (a trailing newline is stripped). Setting both is an error. A config file that contains a secret-looking key is refused.

| Key                      | Needed when           |
| ------------------------ | --------------------- |
| `STITCH_CLIENT_ID`       | `payments` is enabled |
| `STITCH_CLIENT_SECRET`   | `payments` is enabled |
| `LEDFRA_API_TOKEN`       | `ledger` is enabled   |
| `STABLECOIN_SIGNING_KEY` | optional placeholder  |
| `LLM_API_KEY`            | optional placeholder  |

If a required secret for an enabled component is missing (or empty), the process prints one fatal line to stderr that names every missing key, and exits with code 1 before opening a port. Values are never printed: not in that error, not in logs, not in `/health`.

Logging (pino, JSON lines on stdout) redacts the value of any key that looks like a secret (`token`, `secret`, `password`, `apiKey`, `authorization`, `cookie`, `client_id`, anything ending in `key`, and so on, at any depth), and additionally scrubs the exact value of every loaded secret from each line.

## Endpoints

`GET /health` always answers `200` while the process is up:

```json
{
  "status": "ok",
  "version": "0.0.0",
  "components": {
    "record": { "status": "ok", "mode": "in-memory" },
    "ledger": { "status": "disabled" },
    "payments": { "status": "disabled" },
    "queue": { "status": "ok", "mode": "in-memory" }
  }
}
```

Component `status` is `ok`, `disabled`, `not-configured` (enabled but missing a required secret) or `error` (its check failed). Overall `status` is `ok` when every component is `ok` or `disabled`, otherwise `degraded`.

`GET /ready` returns the same body plus `ready`, with `200` when overall status is `ok` and `503` otherwise.

## Test

```sh
pnpm exec vp test run apps/node
```

The suite includes a real start/stop on an ephemeral port and a child-process run of `src/main.ts` that checks exit codes and that no secret value reaches stdout or stderr.
