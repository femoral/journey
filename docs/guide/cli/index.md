---
title: CLI
description: Overview of the journey CLI and global behaviour that applies to every command.
sources:
  - packages/cli/src/index.ts
  - packages/cli/src/report.ts
---

# CLI

The `journey` binary is published as `@journey/cli`. Every command runs against a project directory — either the current working directory, or one identified by a `journey.config.json` at the root.

All commands print errors as `journey: <message>` to stderr and exit with code `1` on failure.

## Commands

| Command                                      | Purpose                                          |
| -------------------------------------------- | ------------------------------------------------ |
| [`journey init`](./init)                     | Scaffold a new project from an OpenAPI spec.     |
| [`journey generate`](./generate)             | Regenerate typed endpoints/models from the spec. |
| [`journey run`](./run)                       | Run one or more journeys.                        |
| [`journey export k6`](./export-k6)           | Transpile a journey into a k6 script.            |
| [`journey export postman`](./export-postman) | Export a journey as a Postman Collection.        |
| [`journey serve`](./serve)                   | Run the HTTP backend the GUI talks to.           |
| [`journey env list`](./env-list)             | List configured environments.                    |

## Global behaviour

### Config discovery

All commands except `init` load `journey.config.json` from `cwd` (or `--project <dir>` for `serve`). See the [config reference](../../reference/config) for the full schema.

### Journey file discovery

- `journey run --all` globs `journeys/*.journey.ts` (non-recursive, alphabetical).
- Explicit file arguments must end in `.journey.ts` and resolve relative to `cwd`.

### Environment selection

- `--env <name>` loads `environments/<name>.json` and sets it as active.
- Without `--env`, `defaultEnvironment` from the config is used if present.
- With no active environment, any `env()` call throws at step execution time.

See [Environments → Selecting an environment](../environments/selection).

### Debug logging

Two equivalent ways to enable verbose request/response logs:

```sh
journey run --all --debug
DEBUG=journey journey run --all
```

The logger masks standard secret headers (`Authorization`, `Cookie`, `X-Api-Key`, …) before writing them.

### Run history

Every `journey run` writes a record to `.journey/cache/runs/<iso-timestamp>.run.json` and prunes older files beyond `config.runHistoryKeepCount` (default 20). This directory is gitignored by the scaffold. The GUI's **Run history** page reads from the same files.

### Error format

Every error surfaces as:

```
journey: <message>
```

on stderr, with exit code `1`.

### Exit codes

Zero on success, one on any failure. No other codes are used.
