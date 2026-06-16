---
title: journey serve
description: Start the HTTP backend the GUI talks to.
sources:
  - packages/cli/src/commands/serve.ts
  - packages/cli/src/server/server.ts
  - packages/cli/src/server/runner.ts
  - packages/cli/src/server/specDrift.ts
---

# `journey serve`

Start the HTTP backend the GUI talks to. Also usable standalone for custom UIs or scripting against a running project.

```sh
journey serve [--port <n>] [--host <host>] [--project <dir>] [--debug] [--insecure] \
              [--cache <mode>] [--cache-ttl <ms>]
```

## Flags

| Flag               | Type                                  | Default     | Required | Purpose                                                                                                                                      |
| ------------------ | ------------------------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <n>`       | number                                | `5181`      | No       | TCP port to listen on.                                                                                                                       |
| `--host <host>`    | string                                | `127.0.0.1` | No       | Host to bind to. Default is localhost-only.                                                                                                  |
| `--project <dir>`  | path                                  | `cwd`       | No       | Project directory (absolute or relative to `cwd`).                                                                                           |
| `--debug`          | boolean                               | `false`     | No       | Log every request/response while running journeys.                                                                                           |
| `--insecure`       | boolean                               | `false`     | No       | Disable TLS verification for journey runs triggered through the API. Same effect as `tlsRejectUnauthorized: false` in `journey.config.json`. |
| `--cache <mode>`   | `off` \| `run` \| `process` \| `disk` | `process`   | No       | Sub-journey output cache lifetime. See below.                                                                                                |
| `--cache-ttl <ms>` | integer                               | —           | No       | Default time-to-live for cached sub-journey outputs, in milliseconds.                                                                        |

## Behaviour

Exposes REST endpoints for project metadata, journeys, runs, run replay, environments, and spec-drift detection. CORS is enabled (`Access-Control-Allow-Origin: *`). Runs until `SIGINT` / `SIGTERM`.

## Sub-journey output cache

`serve` holds **one** cache for its whole lifetime, shared across every run triggered through the API. With the default `--cache=process`, a sub-journey output cached during one run (one that supplies a `cacheKey`) is replayed on the next — an auth token stays hot between GUI run-button presses instead of re-minting each time. `--cache=disk` additionally persists it across server restarts; `--cache=run` clears it after each run; `--cache=off` disables it. `--cache-ttl <ms>` caps entry age. See [`journey run` → Sub-journey output cache](./run#sub-journey-output-cache) for the mode table.

## Output

```
Journey API listening at http://127.0.0.1:5181
For the GUI, run: pnpm --filter @usejourney/gui dev
```

On shutdown:

```
Shutting down…
```

## Exit codes

| Code | When                              |
| ---- | --------------------------------- |
| `0`  | Clean shutdown (signal received). |
| `1`  | Config read error, port in use.   |

## Typical usage

### With the GUI dev server

```sh
journey serve --project my-api --port 5181 &
pnpm --filter @usejourney/gui dev
```

Or use the convenience script in the monorepo root, which starts a mock server + the CLI's `serve` + the GUI dev server concurrently:

```sh
pnpm dev:web    # browser GUI
pnpm dev:tauri  # desktop GUI
```

### Standalone

`serve` also serves a useful JSON API if you want to script against a Journey project without running journeys through the CLI. Routes include project summary, spec drift, journey listings, run history, and a POST endpoint that runs a journey and streams results over SSE. The routes are exercised by the GUI; see `packages/cli/src/server/server.ts` for the current set.

## Security

- Default bind is `127.0.0.1` — not reachable from the network.
- CORS is wide open (`*`). If you expose the port, anything running in the browser can hit it. Bind to `127.0.0.1` (default) for local-only access.
- Bind to `0.0.0.0` explicitly if you need cross-machine access; pair with a reverse proxy that handles auth.

There is no built-in authentication on the API — it assumes local-only use.
