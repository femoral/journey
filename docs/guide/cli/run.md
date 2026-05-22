---
title: journey run
description: Run one or more journeys. The main command.
sources:
  - packages/cli/src/commands/run.ts
  - packages/cli/src/report.ts
  - packages/core/src/runtime.ts
  - packages/core/src/history.ts
---

# `journey run`

Run one or more journeys. The main command.

```sh
journey run [files...] [--env <name>] [--all] [--debug] [--watch] [--insecure] \
            [--cache <mode>] [--cache-ttl <ms>]
```

## Arguments and flags

| Argument / flag    | Type                                  | Default                     | Required | Purpose                                                                                                                                                                                                           |
| ------------------ | ------------------------------------- | --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[files...]`       | paths                                 | —                           | No¹      | Specific journey files to run. Relative paths resolve against `cwd`.                                                                                                                                              |
| `--env <name>`     | string                                | `config.defaultEnvironment` | No       | Load `environments/<name>.json` before running.                                                                                                                                                                   |
| `--all`            | boolean                               | `false`                     | No       | Run every `*.journey.ts` in `journeys/`.                                                                                                                                                                          |
| `--debug`          | boolean                               | `false`                     | No       | Log every request/response to stderr. Also triggered by `DEBUG=journey`.                                                                                                                                          |
| `--watch`          | boolean                               | `false`                     | No       | Rerun on changes to `.ts` / `.json` files in the watched directories.                                                                                                                                             |
| `--insecure`       | boolean                               | `false`                     | No       | Disable TLS certificate verification. For self-signed certs or corporate CAs Node doesn't trust. Prints one warning to stderr per process. Equivalent to `tlsRejectUnauthorized: false` in `journey.config.json`. |
| `--cache <mode>`   | `off` \| `run` \| `process` \| `disk` | `process`                   | No       | Sub-journey output cache lifetime. See below.                                                                                                                                                                     |
| `--cache-ttl <ms>` | integer                               | —                           | No       | Default time-to-live for cached sub-journey outputs, in milliseconds. Per-call `cacheTtlMs` overrides it.                                                                                                         |

¹ Either pass file paths or use `--all`. With neither, the command errors: `No journey files to run.`

## Behaviour

1. Loads `journey.config.json` and sets the active environment (from `--env` or `defaultEnvironment`).
2. Discovers journey files: from `[files...]` if provided, otherwise `journeys/*.journey.ts` (alphabetical).
3. Imports each file via `tsx` to register journeys in-process.
4. Executes all registered journeys sequentially (`runAllRegistered`), streaming results.
5. Writes a run record to `.journey/cache/runs/<iso-timestamp>.run.json` and prunes old records to `config.runHistoryKeepCount` (default 20).
6. In `--watch` mode, clears the terminal and reruns on file changes until `SIGINT` / `SIGTERM`.

## Output

```
✓ multi-step crud (219ms)
  ✓ login POST http://127.0.0.1:5180/auth/login → 200 (35ms)
  ✓ create pet POST http://127.0.0.1:5180/pet → 201 (28ms)
  ✗ delete pet DELETE http://127.0.0.1:5180/pet/1 → (14ms)
      expected 204 to be 200

0 passed, 1 failed
```

## Exit codes

| Code | When                                            |
| ---- | ----------------------------------------------- |
| `0`  | Every step in every journey passed.             |
| `1`  | Any step failed, config/environment load error. |

## `--watch` mode

Enters an interactive loop:

```
Watching for changes in /abs/path/journeys…
Press Ctrl+C to stop.
```

Changes to `.ts` or `.json` files under the journeys directory (and each explicit file's parent directory) trigger a rerun, debounced 300 ms. The terminal is cleared before each rerun. Exits cleanly on `SIGINT` or `SIGTERM`.

Watch mode always returns `0` when you quit. Use `--watch` for local iteration; don't use it in CI.

## `--debug`

Enables the built-in console logger — one line per request and response, written to stderr:

```
→ POST http://127.0.0.1:5180/auth/login
  headers {"content-type":"application/json"}
  body    {"username":"alice","password":"***"}
← 200 POST http://127.0.0.1:5180/auth/login (35ms)
  body    {"token":"***","expiresIn":3600}
```

Secret headers are masked automatically. The `DEBUG=journey` environment variable does the same thing — handy when you can't easily add a flag to the command (e.g. running through a script wrapper).

## Run records

Each invocation writes `.journey/cache/runs/<id>.run.json`, where `<id>` is an ISO timestamp with colons replaced by hyphens. The record contains every `JourneyResult` — journey name, step statuses, request method and URL, response (on success), error (on failure), and duration.

`config.runHistoryKeepCount` (default 20) caps the retained count. The GUI's **Run history** page reads from the same directory.

## `--insecure` (TLS verification)

Node bundles its own root store and does not consult the OS trust store, so internal HTTPS endpoints fronted by a corporate CA fail with `fetch failed ← unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)` even when a browser reaches them fine.

```sh
journey run --insecure --all
```

Skips certificate validation for **this invocation**. A single warning prints to stderr the first time it engages:

```
journey: WARNING — TLS verification disabled (--insecure)
```

For long-lived projects (developer machines hitting a known-private staging cluster), set the same toggle in config so you don't have to remember the flag:

```json
{
  "tlsRejectUnauthorized": false
}
```

Both paths install a process-wide undici `Agent` with `rejectUnauthorized: false` as the global dispatcher, so Node's `fetch` honours it. Per-request callers (e.g. `journey serve`'s API runner) also receive the agent on `HttpContext.dispatcher`. Don't ship a project with `tlsRejectUnauthorized: false` to CI — the warning is your only signal.

## Sub-journey output cache

`--cache <mode>` sets the lifetime of the [sub-journey output cache](../writing-journeys/sub-journeys#the-output-cache). A sub-journey call caches its output only when it supplies a `cacheKey`; `--cache` decides how long a stored entry survives.

| Mode      | Lifetime                                                                              |
| --------- | ------------------------------------------------------------------------------------- |
| `off`     | No cache. Every `invokeJourney` call runs the child in full.                          |
| `run`     | In-memory, cleared at the end of the run.                                             |
| `process` | In-memory, lives as long as the CLI process. **Default.**                             |
| `disk`    | Persisted under `.journey/cache/sub-journey/` — survives across separate invocations. |

For a one-shot `journey run`, `process` and `run` behave the same (the process exits after one run). The distinction matters under [`journey serve`](./serve), where `process` keeps one cache hot across many runs.

`--cache-ttl <ms>` sets a default time-to-live for cached entries; a per-call `cacheTtlMs` on the `invokeJourney` options overrides it. Without either, an entry lives as long as the chosen mode allows. Mind cache staleness — a cached auth token is replayed verbatim and does not refresh; see [Sub-journeys → safe cache keys](../writing-journeys/sub-journeys#safe-vs-unsafe-cache-keys).

## Running a subset of steps

The CLI always runs journeys end-to-end. If you need "run only the first N steps" (say, to reproduce up to a failing step), use the GUI's **Run up to step N** control on the Journeys page — it's the only path that exposes the `upToStepIdx` option on the runtime.
