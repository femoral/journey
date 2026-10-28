---
title: journey export k6
description: Transpile a .journey.ts file into a standalone k6 script.
sources:
  - packages/cli/src/commands/exportK6.ts
  - packages/core/src/body.ts
  - packages/k6-adapter/src/index.ts
  - packages/k6-adapter/src/shim.ts
---

# `journey export k6 <path>`

Transpile one `.journey.ts` file or every `.journey.ts` in a directory into standalone k6 scripts.

```sh
journey export k6 <path> [--out <file>] [--out-dir <dir>] [--tag <tag>...]
                         [--metrics-prefix <prefix>] [--halt-on-failure]
```

## Arguments and flags

| Argument / flag             | Type   | Default                                   | Required | Purpose                                                                                              |
| --------------------------- | ------ | ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `<path>`                    | path   | —                                         | Yes      | A `.journey.ts` file or a directory of them.                                                         |
| `--out <path>`              | path   | `<journey basename>.k6.js` next to source | No       | Output file path. Single-file mode only.                                                             |
| `--out-dir <path>`          | path   | next to each source                       | No       | Directory mode output dir; emitted files are `<basename>.k6.js`.                                     |
| `--tag <tag>`               | string | —                                         | No       | Repeatable. Skip files whose journeys do not all carry every listed tag (AND across repeats).        |
| `--metrics-prefix <prefix>` | string | — (no custom metrics)                     | No       | Emit per-step and per-flow custom metrics named `<prefix>_…`. See [Custom metrics](#custom-metrics). |
| `--halt-on-failure`         | flag   | off                                       | No       | Stop an iteration's remaining steps when a step's `assert` fails, like `journey run`.                |

## Tag-based selection

Declare tags on the journey to opt files into the export:

```ts
journey("checkout flow", { tags: ["load", "checkout"], k6: { vus: 10, duration: "30s" } }, () => {
  step("add to cart", {
    /* ... */
  });
});
```

Then filter at the CLI:

```sh
journey export k6 --tag load journeys/
# → checkout.k6.js   (tagged 'load')
# → signup.k6.js     (tagged 'load')
#   (skipped: smoke-test.journey.ts — no 'load' tag)
```

Filtering is at the file level: if **any** journey in a file carries every requested tag, the whole file transpiles through. For finer control, keep one journey per file.

## Behaviour

1. Makes sure `node_modules/@usejourney/core` exists in the project (the same link `journey run` plants), then loads each file to read its tags and `k6` block.
2. Bundles the journey with esbuild: relative imports are followed recursively (named, aliased, `import * as NS`, default exports, JSON), each module keeps its own scope, and TypeScript is stripped. `@usejourney/core` resolves to a k6 shim that re-implements `journey()` / `step()` / `invokeJourney()` / `output()` / `expect()` / `env()` / `fetch()` / `multipart()` / `fileFrom()` on top of k6 primitives.
3. Emits a single self-contained `.js` file. The journey file's own exports (e.g. `export const options`) are kept.

Imports that can't exist in k6 fail the export with the file, line and specifier: npm packages, `node:` builtins, remote URLs, and `@usejourney/core` exports the shim doesn't provide (e.g. `loadConfig`). `k6` and `k6/*` imports are left as-is.

## Output

```
Wrote k6 script → /abs/path/my.k6.js
```

## Exit codes

| Code | When                                                                          |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Success.                                                                      |
| `1`  | Source read or write failure, unsupported import, or missing `fileFrom` file. |

## Running the k6 script

The emitted file is self-contained. Point k6 at it with a base URL and any variables the journeys read with `env()`:

```sh
k6 run -e JOURNEY_BASE_URL=https://api.example.com -e AUTH_CODE_URL=https://auth.example.com my.k6.js
```

- **Base URL** — typed endpoint refs (and descriptors without their own `baseUrl`) use `JOURNEY_BASE_URL`, falling back to `BASE_URL` (the key `environments/*.json` use for `journey run`).
- **`env("KEY")`** reads `__ENV.KEY` and throws when it is missing. Pass values with `-e KEY=…` (or the shell environment). Environment files are not baked into the script.

If the journey declares a `k6` block, the emitted script bakes it in as `export const options`, so no `--vus` / `--duration` / `--stage` flag is needed at run time:

```ts
journey(
  "k6 load stages",
  {
    tags: ["load"],
    k6: {
      stages: [
        { duration: "10s", target: 5 },
        { duration: "30s", target: 20 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  () => {
    /* ... */
  },
);
```

For ad-hoc overrides, k6's CLI flags (`--vus`, `--duration`, `--stage`, `--iterations`) still take precedence over the baked-in options.

::: warning One k6 block per file
`export const options` is module-scoped on the k6 side. If a single `.journey.ts` declares more than one journey with a `k6` block, the export errors and names the offenders. Split into separate files.
:::

### Choosing a load profile at run time

Instead of a static `k6` block, a journey file may export `options` itself. The expression runs in k6's init context, so it can read `__ENV` (guard it — `__ENV` doesn't exist under `journey run`, which ignores the export):

```ts
// journeys/lib/profiles.ts
declare const __ENV: Record<string, string> | undefined;
const PROFILES = {
  "0D": { stages: [{ duration: "1m", target: 1 }] },
  "2X": {
    stages: [
      { duration: "2m", target: 10 },
      { duration: "60m", target: 40 },
    ],
  },
};
export function pickProfile() {
  const name = typeof __ENV !== "undefined" ? __ENV.OPT_NAME : undefined;
  return PROFILES[(name ?? "0D").toUpperCase() as keyof typeof PROFILES] ?? PROFILES["0D"];
}

// journeys/cards.journey.ts
export const options = pickProfile();
```

```sh
k6 run -e OPT_NAME=2X k6/cards.k6.js
```

Don't combine it with a `k6` block in the same file (the export errors). A journey file can't `export default` — the export generates the default function.

## Custom metrics

`--metrics-prefix <prefix>` adds k6 custom metrics so the end-of-test summary carries one row per step:

| Metric                     | Type    | Recorded                                                                    |
| -------------------------- | ------- | --------------------------------------------------------------------------- |
| `<prefix>_<step>_duration` | Trend   | `res.timings.duration` (ms) of every step request                           |
| `<prefix>_<step>_tps`      | Counter | `1` per step request                                                        |
| `<prefix>_flow_duration`   | Trend   | Sum of the step durations of an iteration (recorded only if every step ran) |
| `<prefix>_flow_tps`        | Counter | `1` per completed iteration                                                 |

`<step>` is the step name slugified (`"Fetch cards list"` → `fetch_cards_list`). Steps inside invoked sub-journeys get their own metrics under their own names, so a reusable auth journey with steps `auth` and `session` yields `<prefix>_auth_*` and `<prefix>_session_*`. To keep names stable (e.g. to match an existing report), override the slug per step — `false` opts a step out of per-step metrics (it still counts toward the flow duration):

```ts
step("update card preferences", {
  endpoint: endpoints.updateCardPreferences,
  metric: "update_card_pref", // → wave_update_card_pref_duration / _tps
  /* ... */
});
```

`metric` is ignored by `journey run`. Durations are plain-number Trends (milliseconds), so the summary reads e.g.

```
wave_fetch_cards_duration........: avg=0.452614 min=0.240544 med=0.452614 max=0.664683 p(90)=0.622269 p(95)=0.643476
wave_fetch_cards_tps.............: 2      222.225235/s
```

k6 only allows declaring metrics in the init context, so the script evaluates every journey body (and, best effort, every sub-journey body) once at init to discover its steps. Keep bodies free of side effects (they already re-run every iteration). A step that only appears at run time — e.g. behind a condition on response data — logs a warning and records no per-step metric.

## File uploads

[`multipart()` and `fileFrom()`](../writing-journeys/request-inputs#file-uploads-multipart-and-filefrom) work in the export. Every `fileFrom("…")` called with a **string literal** is pre-loaded with `open(path, "b")` in the init context — paths are resolved against the project root and rewritten relative to the emitted script, so keep the script and fixtures in the same checkout layout. File parts are sent with `http.file()`; a missing file fails the export. A non-literal path only works when `fileFrom()` runs at module top level (init time).

## `fetch` and async hooks

`import { fetch } from "@usejourney/core"` works in hooks: the shim maps it to `http.request` and resolves to a minimal `Response` (`status`, `ok`, `headers.get()`, `json()`, `text()`); it rejects only on network errors. String and binary request bodies are supported.

Async lazy values (`headers: async () => …`) and async `assert` / `after` hooks are awaited, so `after: async (res) => { const r = await fetch(…); … }` behaves as under `journey run`. Fully synchronous journeys still run synchronously. Inside a sub-journey's `group()`, requests issued after the first `await` are not tagged with the group (a k6 limitation); metrics and checks are unaffected.

## Failed assertions

Each step's `assert(res)` becomes a k6 `check` named `<journey> › <step>`; a failure is logged and counted. By default the iteration carries on (k6 style). With `--halt-on-failure` the iteration stops after the failed step, like `journey run` — so later steps don't run against state the failed step never produced. An exception thrown elsewhere (a lazy value, an `after` hook) always aborts the iteration.

## What maps to what

| Journey                           | k6                                                           |
| --------------------------------- | ------------------------------------------------------------ |
| `step("name", { … })`             | `http.request(…)` (+ a named `check` when it has `assert`)   |
| `invokeJourney(handle, { … })`    | `group("child journey", () => { … })`                        |
| `assert(res)` throws              | failed `check`; stops the iteration with `--halt-on-failure` |
| `env("KEY")`                      | `__ENV.KEY` (pass with `k6 run -e KEY=…`)                    |
| `fetch(url, …)`                   | `http.request(…)` → Response-like                            |
| `multipart({ … })` / `fileFrom()` | object body with `http.file(open(…, "b"))`                   |
| `metric: "slug"`                  | `Trend` / `Counter` named `<prefix>_slug_*`                  |

## Sub-journeys

A sub-journey node — `invokeJourney(handle, { … })` — is **inlined** at its call
site. The child journey's steps are emitted under a k6
[`group()`](https://grafana.com/docs/k6/latest/using-k6/tags-and-groups/#groups)
named after the child (the `name` override, falling back to the child journey's
own name), so k6's per-group metrics break the load profile down by sub-journey.
Nesting works to 8 levels.

`output(value)` in a child step's `after` flows to the call's `after(out)` /
`assert(out)` hooks, exactly as it does in a normal run.

The [output cache](../writing-journeys/sub-journeys#the-output-cache) **is**
honored, in memory, mirroring `journey run`. A call with a `cacheKey` (and
`cache` not `"off"`) is looked up by the composite key `childName:resolvedKey`;
a hit replays the stored output and **skips the child's requests entirely**, so
its endpoints aren't hammered every iteration. `cacheTtlMs` sets the expiry
(absent → no expiry). The parent's `assert(out)` / `after(out)` still run on a
hit, with the cached value.

The cache scope is **per-VU**: k6 gives each VU its own JS runtime and there is
no cross-VU mutable shared state ([`SharedArray`](https://grafana.com/docs/k6/latest/javascript-api/k6-data/sharedarray/)
is read-only), so a cached value is reused across one VU's iterations and each
VU warms its own copy. This matches how sub-journeys are typically used — as
fixture helpers (acquire a token, seed data) that set up the real test surface
rather than being the thing under load. To measure true cold per-iteration cost
instead, force every iteration to re-run the child:

```sh
JOURNEY_CACHE=off k6 run my.journey.k6.js
```

Reusable journeys declare `inputs` / `outputs` schemas with `z`, but k6 has no
zod runtime, so the schemas are replaced by a no-op stub — child inputs and
outputs are passed through unvalidated in the exported script.

## Limits

- Imports must be project files, `@usejourney/core`, or `k6` modules — no npm packages.
- `fetch()` accepts string and binary bodies only (no `FormData` / `URLSearchParams`).
- Reusable-journey `inputs` / `outputs` schemas are not validated.
- Journey bodies themselves must be synchronous (they are evaluated to collect steps); only hooks and lazy values may be async.

If the emitted script doesn't run, the pragmatic fallback is to hand-write a k6 scenario. The journey file remains the source of truth for acceptance runs.

## Regeneration

Emitted files carry a header:

```js
// AUTO-GENERATED BY @usejourney/k6-adapter — do not edit by hand.
```

Rerun `journey export k6` whenever the source journey changes. Commit the emitted file if you want it stable across developer machines; otherwise put `*.k6.js` in `.gitignore` and regenerate on demand.
