---
title: journey export k6
description: Transpile a .journey.ts file into a standalone k6 script.
sources:
  - packages/cli/src/commands/exportK6.ts
  - packages/k6-adapter/src/index.ts
  - packages/k6-adapter/src/shim.ts
---

# `journey export k6 <path>`

Transpile one `.journey.ts` file or every `.journey.ts` in a directory into standalone k6 scripts.

```sh
journey export k6 <path> [--out <file>] [--out-dir <dir>] [--tag <tag>...]
```

## Arguments and flags

| Argument / flag    | Type   | Default                                   | Required | Purpose                                                                                       |
| ------------------ | ------ | ----------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `<path>`           | path   | —                                         | Yes      | A `.journey.ts` file or a directory of them.                                                  |
| `--out <path>`     | path   | `<journey basename>.k6.js` next to source | No       | Output file path. Single-file mode only.                                                      |
| `--out-dir <path>` | path   | next to each source                       | No       | Directory mode output dir; emitted files are `<basename>.k6.js`.                              |
| `--tag <tag>`      | string | —                                         | No       | Repeatable. Skip files whose journeys do not all carry every listed tag (AND across repeats). |

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

1. Reads the journey source.
2. Strips `@journey/core` imports; inlines relative imports (recursively — a sub-journey imported from a helper that itself imports another is inlined too).
3. Prepends k6 shims that re-implement `journey()` / `step()` / `invokeJourney()` / `output()` / `expect()` on top of k6 primitives.
4. Emits a single `.js` file.

## Output

```
Wrote k6 script → /abs/path/my.k6.js
```

## Exit codes

| Code | When                          |
| ---- | ----------------------------- |
| `0`  | Success.                      |
| `1`  | Source read or write failure. |

## Running the k6 script

The emitted file is self-contained. Point k6 at it with a base URL:

```sh
JOURNEY_BASE_URL=https://api.example.com k6 run my.k6.js
```

k6 picks up the base URL from the `JOURNEY_BASE_URL` environment variable the shim injects.

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

For ad-hoc overrides, k6's CLI flags (`--vus`, `--duration`, `--stage`) still take precedence over the baked-in options.

::: warning One k6 block per file
`export const options` is module-scoped on the k6 side. If a single `.journey.ts` declares more than one journey with a `k6` block, the export errors and names the offenders. Split into separate files.
:::

## What maps to what

| Journey                        | k6                                          |
| ------------------------------ | ------------------------------------------- |
| `step("name", { … })`          | `http.request(…)` + a named `check`         |
| `invokeJourney(handle, { … })` | `group("child journey", () => { … })`       |
| `assert(res)` throws           | `check(res, { … })` / fail via `check`      |
| `env("KEY")`                   | `__ENV.KEY` (k6 reads `JOURNEY_*` env vars) |
| `fetch(url, …)`                | `http.get/post/put/…`                       |

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

The adapter handles the common 80%. Edge cases that don't transpile cleanly:

- Async/await in lazy closures — k6 is synchronous.
- Imports from third-party npm packages — the output has to be self-contained.
- `tsx`-specific TypeScript syntax that k6's transpiler doesn't understand.

If the emitted script doesn't run, the pragmatic fallback is to hand-write a k6 scenario. The journey file remains the source of truth for acceptance runs.

## Regeneration

Emitted files carry a header:

```js
// AUTO-GENERATED BY @journey/k6-adapter — do not edit by hand.
```

Rerun `journey export k6` whenever the source journey changes. Commit the emitted file if you want it stable across developer machines; otherwise put `*.k6.js` in `.gitignore` and regenerate on demand.
