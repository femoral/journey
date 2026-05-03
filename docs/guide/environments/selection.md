---
title: Selecting an environment
description: How --env and defaultEnvironment pick which file to load.
sources:
  - packages/core/src/env.ts
  - packages/cli/src/commands/run.ts
  - packages/cli/src/commands/envList.ts
---

# Selecting an environment

Two mechanisms, in priority order:

1. **`--env <name>`** on any command that loads journeys (`journey run`, the GUI run button). Loads `environments/<name>.json`.
2. **`defaultEnvironment` in `journey.config.json`.** Used when `--env` isn't passed.

If neither is set, `env()` throws when a journey calls it.

## `--env`

```sh
journey run journeys/checkout.journey.ts --env staging
```

Looks up `environments/staging.json` (under the configured `environmentsDir`), loads it, and calls `setActiveEnvironment("staging", values)` before any step runs.

## `defaultEnvironment`

```json
// journey.config.json
{
  "defaultEnvironment": "dev"
}
```

When `--env` is omitted, this value is used. Convenient for local development — `journey run --all` picks up `dev` without you typing it every time.

CI pipelines typically pass `--env` explicitly to be unambiguous. Committed configs usually set `defaultEnvironment` to the env that's safe to run locally (hint: not `prod`).

## Listing environments

```sh
journey env list
```

Prints one env per line, marking the default with `*`:

```
* dev
  staging
  prod
```

If `environments/` is empty or missing: `No environments found in /abs/path/environments`.

## Multiple environments in one run

`journey run` loads one environment per invocation. If you need to run the same journeys against multiple environments, invoke the CLI once per environment — typically from a shell loop or CI matrix. The GUI's run button uses a single active environment too, picked from the top-bar indicator.

## Priority recap

| `--env` passed? | `defaultEnvironment` set? | Active env  |
|-----------------|---------------------------|-------------|
| Yes             | —                         | `<--env>`   |
| No              | Yes                       | Default     |
| No              | No                        | None — `env()` throws at step execution |
