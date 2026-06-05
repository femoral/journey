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
                               [--name <name>] [--env <name>] [--all-envs] [--bundle]
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
| `--bundle`         | flag   | off                                                         | No       | Aggregate every matching journey across all files into **one** collection (see below).        |

## Behaviour

1. Loads the journey file(s); applies `--tag` filtering at the file level.
2. Installs an `env()` proxy so `env("KEY")` resolves to the Postman variable `{{KEY}}` during collection.
3. Walks each journey's pipeline into Postman items — one folder per journey, one request per `step()`, one **nested folder** per `invokeJourney()` (see below).
4. Writes a `<basename>.postman_collection.json` per file, plus environment files when `--env` / `--all-envs` is set.

With `--bundle`, steps 3–4 fold into a single collection instead — see [Bundling](#bundling-all-journeys-into-one-collection).

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

### Cache

A sub-journey call that opts into the [output cache](../writing-journeys/sub-journeys#the-output-cache) (sets a `cacheKey`, with `cache` not `"off"`) gets folder-level pre-request / test scripts that translate the cache to a **collection variable**. The pre-request skips the folder's request while the variable's expiry timestamp is still valid (`pm.execution.skipRequest()`); the test opens the window on the first run. The variable name derives from the composite key `<childJourneyName>:<resolvedKey>`, so the **same** reusable journey invoked from several places shares one slot — combined with [`--bundle`](#bundling-all-journeys-into-one-collection), a shared auth sub-journey runs **once** per collection run. `cacheTtlMs` becomes the expiry; with no TTL the entry lasts the whole run.

::: warning Scope and limits
Postman runs folder scripts **per request in the folder**, not once for the folder, so the skip is reliable for **single-request** sub-journeys (the common auth-token case). And Postman has no closure return values, so a child's `output(value)` is still **not** carried into Postman variables — the cache here skips redundant HTTP calls, it does not thread the child's output into later requests. Pass data via `{{variable}}` references for now. Requires Newman ≥ 6 / Postman ≥ 10.12 for `pm.execution.skipRequest()`.
:::

## Bundling all journeys into one collection

By default each file becomes its own collection. `--bundle` instead aggregates **every matching journey across every file** into a single collection — one top-level folder per journey.

```sh
journey export postman ./journeys --bundle --out-dir ./postman --all-envs
```

- Output is a single `journeys.postman_collection.json` (override the path with `--out`, the name with `--name`). Unlike the per-file mode, `--out` **is** allowed with a directory when `--bundle` is set.
- Duplicate journey names across files are de-duplicated with a ` (n)` suffix (`checkout`, `checkout (2)`).
- Environment files (`--env` / `--all-envs`) are written once, beside the bundled collection.
- This is where the [sub-journey cache](#cache) pays off most: a shared reusable journey (auth, fixture setup) invoked from many entry journeys runs once for the whole run.

## Output

```
Wrote Postman collection → /abs/path/my.postman_collection.json
Wrote Postman environment → /abs/path/local.postman_environment.json
```

`--out` is rejected in directory mode unless `--bundle` is set — otherwise use `--out-dir`. `--env` / `--all-envs` require a Journey project (`journey.config.json`) so the environments directory can be located.

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
