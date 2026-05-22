---
title: journey export postman
description: Export a .journey.ts file into a Postman Collection v2.1.0.
sources:
  - packages/cli/src/commands/exportPostman.ts
  - packages/postman-adapter/src/index.ts
---

# `journey export postman <path>`

Export one `.journey.ts` file or every `.journey.ts` in a directory into [Postman Collection v2.1.0](https://schema.getpostman.com/json/collection/v2.1.0/collection.json) JSON, optionally alongside Postman environment files.

```sh
journey export postman <path> [--out <file>] [--out-dir <dir>] [--tag <tag>...] \
                               [--name <name>] [--env <name>] [--all-envs]
```

## Arguments and flags

| Argument / flag    | Type   | Default                                                     | Required | Purpose                                                                                       |
| ------------------ | ------ | ----------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `<path>`           | path   | —                                                           | Yes      | A `.journey.ts` file or a directory of them.                                                  |
| `--out <path>`     | path   | `<journey basename>.postman_collection.json` next to source | No       | Output file path. Single-file mode only.                                                      |
| `--out-dir <path>` | path   | next to each source                                         | No       | Directory-mode output dir; emitted files are `<basename>.postman_collection.json`.            |
| `--tag <tag>`      | string | —                                                           | No       | Repeatable. Skip files whose journeys do not all carry every listed tag (AND across repeats). |
| `--name <name>`    | string | journey file basename                                       | No       | Override the collection's `info.name`.                                                        |
| `--env <name>`     | string | —                                                           | No       | Also export `environments/<name>.json` as a Postman environment file.                         |
| `--all-envs`       | flag   | off                                                         | No       | Export every configured environment as a Postman environment file.                            |

## Behaviour

1. Loads the journey file(s); applies `--tag` filtering at the file level.
2. Installs an `env()` proxy so `env("KEY")` resolves to the Postman variable `{{KEY}}` during collection.
3. Walks each journey's pipeline into Postman items — one folder per journey, one request per `step()`, one **nested folder** per `invokeJourney()` (see below).
4. Writes a `<basename>.postman_collection.json` per file, plus environment files when `--env` / `--all-envs` is set.

## What maps to what

| Journey                        | Postman                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| a journey                      | a folder (`item`) in the collection                          |
| `step("name", { … })`          | a request item                                               |
| `invokeJourney(handle, { … })` | a nested folder, sibling to the surrounding requests         |
| `env("KEY")`                   | the Postman variable `{{KEY}}`                               |
| path params `/{id}`            | resolved when static, else left as `{{id}}`                  |
| an `environments/<name>.json`  | a `*.postman_environment.json` file (`--env` / `--all-envs`) |

## Sub-journeys

Each `invokeJourney(handle, { … })` site becomes a **nested Postman folder**, named after the call (its `name` override, falling back to the child journey's name). The folder holds the child journey's requests; sub-journeys nested inside it recurse as further folders, to 8 levels.

The folder sits as a sibling of the parent journey's own requests, in pipeline order — a sub-journey invoked between two steps lands between their requests.

Call `inputs` are written as folder-scoped Postman `variable` entries, so child requests can reference them.

::: warning Postman sidebar reorders folders
Postman's sidebar lists folders **above** sibling requests, so a sub-journey invoked mid-pipeline _looks_ reordered in the tree even though it is not. **Execution order is unaffected** — the Collection Runner and Newman flatten the collection's `item` array depth-first, which preserves journey pipeline order. The quirk is cosmetic; it is also noted in every sub-journey folder's `description`.
:::

The Journey output cache does **not** translate. `cacheKey`, `cacheTtlMs`, and `cache` on an `invokeJourney` call are ignored — the folder re-runs on every collection run. Postman has no closure return values, so a child's `output(value)` is not carried across; pass data via `{{variable}}` references instead.

## Output

```
Wrote Postman collection → /abs/path/my.postman_collection.json
Wrote Postman environment → /abs/path/local.postman_environment.json
```

`--out` is rejected in directory mode — use `--out-dir`. `--env` / `--all-envs` require a Journey project (`journey.config.json`) so the environments directory can be located.

## Exit codes

| Code | When                          |
| ---- | ----------------------------- |
| `0`  | Success.                      |
| `1`  | Source read or write failure. |

## Running the collection

The emitted collection + environment file run unchanged in the Postman app or with [Newman](https://github.com/postmanlabs/newman):

```sh
newman run my.postman_collection.json -e local.postman_environment.json
```

Requests reference `{{BASE_URL}}` and any `env()` keys as Postman variables — supply them through the exported environment file (or Postman's environment UI).
