---
title: journey export postman
description: Export a .journey.ts file into a Postman Collection v2.1.0.
sources:
  - packages/cli/src/commands/exportPostman.ts
  - packages/postman-adapter/src/index.ts
  - packages/postman-adapter/src/stateThread.ts
---

# `journey export postman <path>`

Export one `.journey.ts` file or every `.journey.ts` in a directory into [Postman Collection v2.1.0](https://schema.getpostman.com/json/collection/v2.1.0/collection.json) JSON, optionally alongside Postman environment files.

```sh
journey export postman <path> [--out <file>] [--out-dir <dir>] [--tag <tag>...] \
                               [--name <name>] [--env <name>] [--all-envs] [--bundle] \
                               [--thread-state]
```

## Arguments and flags

| Argument / flag    | Type   | Default                                                     | Required | Purpose                                                                                                                                                                              |
| ------------------ | ------ | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<path>`           | path   | —                                                           | Yes      | A `.journey.ts` file or a directory of them.                                                                                                                                         |
| `--out <path>`     | path   | `<journey basename>.postman_collection.json` next to source | No       | Output file path. Single-file mode only.                                                                                                                                             |
| `--out-dir <path>` | path   | next to each source                                         | No       | Directory-mode output dir; emitted files are `<basename>.postman_collection.json`.                                                                                                   |
| `--tag <tag>`      | string | —                                                           | No       | Repeatable. Skip files whose journeys do not all carry every listed tag (AND across repeats).                                                                                        |
| `--name <name>`    | string | journey file basename                                       | No       | Override the collection's `info.name`.                                                                                                                                               |
| `--env <name>`     | string | —                                                           | No       | Also export `environments/<name>.json` as a Postman environment file.                                                                                                                |
| `--all-envs`       | flag   | off                                                         | No       | Export every configured environment as a Postman environment file.                                                                                                                   |
| `--bundle`         | flag   | off                                                         | No       | Aggregate every matching journey across all files into **one** collection (see below).                                                                                               |
| `--thread-state`   | flag   | off                                                         | No       | **Experimental.** Thread journey state through collection variables so sub-journey outputs reach later requests (see below).                                                         |
| `--lenient`        | flag   | off                                                         | No       | With `--thread-state`: emit non-enforcing assertions (legacy swallow-all). A failing `expect()` stays a console line instead of a red `pm.test`. No effect without `--thread-state`. |

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

::: tip Use `env()` raw in query/params
At export time `env("KEY")` is the placeholder string `"{{KEY}}"`, so **coercing** it — e.g. `Number(env("LIMIT"))` — produces `NaN` (the original `{{KEY}}` can't be recovered after the cast). Such unresolved values are dropped from the query string and fall back to a `{{name}}` placeholder for path params, rather than emitting a literal `NaN`. To carry an env value into a request, reference it raw (`query: () => ({ limit: env("LIMIT") })`) so it exports as `{{LIMIT}}`.
:::

## Sub-journeys

Each `invokeJourney(handle, { … })` site becomes a **nested Postman folder**, named after the call (its `name` override, falling back to the child journey's name). The folder holds the child journey's requests; sub-journeys nested inside it recurse as further folders, to 8 levels.

The folder sits as a sibling of the parent journey's own requests, in pipeline order — a sub-journey invoked between two steps lands between their requests.

Call `inputs` are written as folder-scoped Postman `variable` entries, so child requests can reference them.

::: warning Postman sidebar reorders folders
Postman's sidebar lists folders **above** sibling requests, so a sub-journey invoked mid-pipeline _looks_ reordered in the tree even though it is not. **Execution order is unaffected** — the Collection Runner and Newman flatten the collection's `item` array depth-first, which preserves journey pipeline order. The quirk is cosmetic; it is also noted in every sub-journey folder's `description`.
:::

### Cache

A sub-journey call that opts into the [output cache](../writing-journeys/sub-journeys#the-output-cache) (sets a `cacheKey`, with `cache` not `"off"`) gets folder-level pre-request / test scripts that translate the cache to a **collection variable**. The pre-request skips the folder's request while the variable's expiry timestamp is still valid (`pm.execution.skipRequest()`); the test opens the window on the first run. The variable name derives from the composite key `<childJourneyName>:<resolvedKey>`, so the **same** reusable journey invoked from several places shares one slot — combined with [`--bundle`](#bundling-all-journeys-into-one-collection), a shared auth sub-journey runs **once** per collection run. `cacheTtlMs` becomes the expiry; with no TTL the entry lasts the whole run.

The cache window opens on the sub-journey's **terminal** request, so a child with more than one request runs in full on the cold pass and is skipped as a whole on a hit. By default a child's `output(value)` is not carried into Postman variables — the cache here skips redundant HTTP calls, it does not thread the child's output into later requests. To carry output and step-to-step state, add [`--thread-state`](#state-threading-experimental), which folds the cache into the carrier so a hit still delivers the child's output. Requires Newman ≥ 6 / Postman ≥ 10.12 for `pm.execution.skipRequest()`.

## Bundling all journeys into one collection

By default each file becomes its own collection. `--bundle` instead aggregates **every matching journey across every file** into a single collection — one top-level folder per journey.

```sh
journey export postman ./journeys --bundle --out-dir ./postman --all-envs
```

- Output is a single `journeys.postman_collection.json` (override the path with `--out`, the name with `--name`). Unlike the per-file mode, `--out` **is** allowed with a directory when `--bundle` is set.
- Duplicate journey names across files are de-duplicated with a ` (n)` suffix (`checkout`, `checkout (2)`).
- Environment files (`--env` / `--all-envs`) are written once, beside the bundled collection.
- This is where the [sub-journey cache](#cache) pays off most: a shared reusable journey (auth, fixture setup) invoked from many entry journeys runs once for the whole run.

## State threading (experimental)

Journey passes state between steps through **closure variables** (`token = out.token`; later `headers: () => ({ Authorization: \`Bearer ${token}\` })`). Postman is templating-only, so by default those closures are evaluated **once at export time** with empty state and dynamic values bake to placeholders — the collection is a structural skeleton, not end-to-end runnable.

`--thread-state` makes it runnable. The exporter recovers each closure's source and re-runs it inside Postman scripts against a JSON carrier held in the collection variable `__journey_state`:

- A folder-level pre-request resets the carrier when execution enters a new journey.
- Each request's **pre-request** runs the step's dynamic `headers` (via `pm.request.headers.upsert`), `params` (via `pm.variables`, so `{{id}}` path slots resolve), `query` (via `pm.variables` named `__q_<key>`, filling baked `?k={{__q_k}}` slots) and `body` (via `__journey_body`, filling the baked raw `{{__journey_body}}`).
- Each request's **test** runs `assert` then `after` against the response and writes results back to the carrier; a sub-journey child's `output(value)` flows to the call's `after(out)` on the sub-folder's terminal request. Assertions are **enforced** — see below.
- A sub-journey invoked with **dynamic inputs** (`inputs: () => ({ token })` reading parent state) gets a folder pre-request that re-runs the inputs closure against the carrier and seeds the result under the child body's parameter name, so the child's own closures resolve `input.*`. This is how a token minted by one sub-journey reaches a **second** sub-journey's requests.
- A `cacheKey`'d sub-journey folds into the carrier: a cache hit restores the stored output and runs the call's hooks, so a skipped login still delivers its token.

Reads resolve through `with (__journey_state) { … }`; `after` write-targets are pre-seeded as carrier keys so assignments persist.

### Assertion enforcement

Under `--thread-state` every `expect()` in an `assert(res)` (or a sub-journey call's `assert(out)`) becomes its **own `pm.test`**, named `<step> · assert <n>`. A genuine failure reds the run, counts in Newman's assertion tally, and exits non-zero — so the collection gates CI the way an acceptance suite would, instead of staying green on a silent mismatch.

This is strict **by default**. The leniency that keeps the skeleton from going red on threading artifacts is preserved structurally: a closure that throws _outside_ a matcher — an unresolved free variable (`ReferenceError`) or an arg-eval `TypeError` such as `expect(res.body.x.y)` where `res.body.x` is undefined — is swallowed, because only the `pm.expect(...)` call inside each matcher runs in the enforcing `pm.test`. Consequences:

- Use **`expect()` matchers** for enforced assertions. A bare `throw` / `throw new AssertionError(...)` inside an `assert` is _not_ enforced (it's indistinguishable from an unresolved-import artifact).
- Assertions do **not short-circuit**: after a failed `expect`, the rest of the hook keeps running (a second failing `expect` reds a second assertion). This mirrors the structural skeleton, where `after` always runs.
- `--lenient` restores the legacy non-enforcing behaviour — bare `pm.expect`, every failure swallowed to a console line, assertion tally `0`.

```sh
journey export postman ./journeys --bundle --thread-state --all-envs
```

::: warning Experimental — known limits

- Only **JSON-serialisable** state survives the carrier (functions, `Date`, `undefined` are lost).
- Closures that reference module-level imports (helpers, the generated `endpoints`) won't resolve — those steps fall back to their baked values.
- Dynamic sub-journey **inputs** thread only when the child body takes a plain `input` parameter. A body that destructures (`({ token }) => …`) or defaults it can't be seeded under one carrier key, so it falls back to baked inputs.
- Async closures are unsupported (Postman pre-request scripts run synchronously).
- Off by default; the baked skeleton remains the default export.
  :::

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

::: tip Re-running in the Postman app
Postman **persists collection variables across Runner executions** — Newman starts each run clean. Without help, a second app run would observe the previous run's open cache windows and threaded carrier, so cached sub-journeys would skip their requests (and their side effects) and threaded asserts would gate on stale state. To keep parity with Newman, a `--thread-state` export prepends a **`Journey: reset state (auto)`** folder holding one skipped request that clears the carrier and every cache slot at the start of a run. It sends nothing (`pm.execution.skipRequest()`); you'll see it as the first folder. (It's a folder, not a bare root request, because the Postman app won't render a collection whose root mixes a request with folders.) (Caching a **side-effectful** sub — one that creates a fixture — is still a smell: it is correct on a cold run but means the create is skipped on a cache hit. Reserve `cacheKey` for idempotent work like auth.)
:::
