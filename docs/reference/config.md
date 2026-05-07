---
title: Config
description: journey.config.json schema, defaults, and validation rules.
sources:
  - packages/core/src/config.ts
  - packages/cli/src/commands/init.ts
---

# `journey.config.json`

Every project has one `journey.config.json` at its root. The schema is validated with Zod in strict mode — **unknown fields are rejected**.

## Example

```json
{
  "name": "petstore",
  "spec": "openapi.yaml",
  "generatedDir": "generated",
  "journeysDir": "journeys",
  "environmentsDir": "environments",
  "defaultEnvironment": "local",
  "baseUrl": "http://127.0.0.1:5180",
  "runHistoryKeepCount": 20
}
```

## Fields

| Field                 | Type           | Default          | Required | Purpose                                                                                                                                                                                                                     |
| --------------------- | -------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | `string`       | —                | No       | Human-readable project name. Displayed in the GUI top bar and some logs.                                                                                                                                                    |
| `spec`                | `string`       | `"openapi.yaml"` | No       | Path to the OpenAPI spec (relative to project root, or absolute).                                                                                                                                                           |
| `generatedDir`        | `string`       | `"generated"`    | No       | Where `endpoints.ts` and `models.ts` are written by `journey generate`.                                                                                                                                                     |
| `journeysDir`         | `string`       | `"journeys"`     | No       | Where `.journey.ts` files live. Scanned by `journey run --all`.                                                                                                                                                             |
| `environmentsDir`     | `string`       | `"environments"` | No       | Where environment JSON files live. Read by `--env <name>` and `journey env list`.                                                                                                                                           |
| `defaultEnvironment`  | `string`       | —                | No       | Env loaded when `--env` is not passed. If unset and no `--env`, `env()` throws at first call.                                                                                                                               |
| `baseUrl`             | `string` (URL) | —                | No       | Fallback base URL for endpoint refs. When omitted, the runtime falls back to `env("BASE_URL")` from the active environment (see [`resolveBaseUrl`](#programmatic-access)). Descriptors can still supply their own per-step. |
| `runHistoryKeepCount` | `integer >= 0` | `20`             | No       | Max run records retained under `.journey/cache/runs/`. Older ones are pruned after each run.                                                                                                                                |

## Validation

- Strict schema: passing a field not in the table above fails with:

  ```
  journey.config.json failed validation:
    - <field>: Unrecognized key(s) in object: "<field>"
  ```

- `baseUrl` must parse as a URL.
- `runHistoryKeepCount` must be a non-negative integer.
- All string fields must be non-empty if present.
- Paths can be **absolute or relative** to the project root. `resolveConfigPaths()` joins relative values against the project directory.

## Paths emitted by `resolveConfigPaths`

The CLI resolves every directory lazily through `resolveConfigPaths(loaded)`:

```ts
{
  specPath: /abs/project/openapi.yaml,
  generatedDir: /abs/project/generated,
  journeysDir: /abs/project/journeys,
  environmentsDir: /abs/project/environments,
}
```

Override any of these by editing `journey.config.json` — `journey generate`, `journey run`, and `journey env list` all go through this resolver.

## Minimum viable config

`journey init` writes:

```json
{
  "name": "<dir-basename>",
  "spec": "<spec-basename>",
  "generatedDir": "generated",
  "journeysDir": "journeys",
  "environmentsDir": "environments"
}
```

— enough to run `journey generate` and start writing journeys. Add `baseUrl` (or set `BASE_URL` in an env file) before `journey run` works against a live server.

## Programmatic access

```ts
import { loadConfig, resolveBaseUrl, resolveConfigPaths, JourneyConfigSchema } from "@journey/core";

const loaded = await loadConfig(projectDir);
const paths = resolveConfigPaths(loaded);
const baseUrl = resolveBaseUrl(loaded.config); // config wins, env BASE_URL is the fallback
// loaded.config — typed as JourneyConfig
```

`JourneyConfigSchema` is exported for callers that want to validate config themselves (e.g. test harnesses that stub out the filesystem). `resolveBaseUrl` is the same helper the CLI uses when building `HttpContext`.
