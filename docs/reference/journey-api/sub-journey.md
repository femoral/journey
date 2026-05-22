---
title: Sub-journeys
description: API reference for invokeJourney, output, reusable journey(), the sub-journey cache, and group events.
sources:
  - packages/core/src/runtime.ts
  - packages/core/src/cache.ts
  - packages/core/src/logger.ts
---

# Sub-journeys

A sub-journey is a reusable `journey()` invoked from another journey as a pipeline node. For the conceptual walk-through see the guide page, [Sub-journeys](../../guide/writing-journeys/sub-journeys).

## `journey()` — reusable overload

```ts
function journey<I, O>(
  name: string,
  options: { reusable: true; inputs?: ZodType<I>; outputs?: ZodType<O> },
  body: (input: I) => void | Promise<void>,
): JourneyHandle<I, O>;
```

With `reusable: true`, `journey()` does **not** register for auto-run — it returns a `JourneyHandle<I, O>`. The body takes the validated input as its argument. `inputs` / `outputs` are reusable-only; the entry overloads accept `tags` / `k6` instead, and the two sets are disjoint.

| Option     | Type         | Notes                                               |
| ---------- | ------------ | --------------------------------------------------- |
| `reusable` | `true`       | Required literal — selects this overload.           |
| `inputs`   | `ZodType<I>` | Validates the call's `inputs` before the body runs. |
| `outputs`  | `ZodType<O>` | Validates the value passed to `output()`.           |

A reusable journey accidentally pushed into the entry registry (via an `as any` escape) fails fast: `runAllRegistered` throws before any step runs.

## `JourneyHandle<I, O>`

```ts
interface JourneyHandle<I = unknown, O = unknown> {
  readonly name: string;
  readonly inputs?: ZodType<I>;
  readonly outputs?: ZodType<O>;
  readonly __def: JourneyDef; // internal — treat as opaque
}
```

The value returned by the reusable `journey()` overload. The phantom `I` / `O` parameters drive type inference at the `invokeJourney` call site. `export` the handle and `import` it where you invoke it — there is no string-name registry lookup.

## `invokeJourney(handle, opts)`

```ts
function invokeJourney<I, O>(handle: JourneyHandle<I, O>, opts?: InvokeJourneyOptions<I, O>): void;
```

Registers a sub-journey call as a pipeline node. Like `step()`, it is called during the journey body (the registration phase), not at execution time — the child runs inline when the runtime reaches the node. Called outside a `journey()` body it throws.

### `InvokeJourneyOptions<I, O>`

```ts
interface InvokeJourneyOptions<I, O> {
  inputs?: I | (() => I | Promise<I>);
  name?: string;
  cacheKey?: string | ((input: I) => string);
  cacheTtlMs?: number;
  cache?: "off" | "inherit";
  assert?: (out: O) => void | Promise<void>;
  after?: (out: O) => void | Promise<void>;
}
```

| Option       | Type                                | Purpose                                                                              |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `inputs`     | `I` or `() => I \| Promise<I>`      | Eager value or lazy resolver. Validated against `handle.inputs`.                     |
| `name`       | `string`                            | Timeline display label. Defaults to `handle.name`.                                   |
| `cacheKey`   | `string` or `(input: I) => string`  | Opt into the output cache. Omitted → the call is never cached.                       |
| `cacheTtlMs` | `number`                            | Per-entry time-to-live in ms. Default: no expiry within the chosen cache lifetime.   |
| `cache`      | `"off" \| "inherit"`                | `"off"` disables caching for this call. Default `"inherit"`.                         |
| `assert`     | `(out: O) => void \| Promise<void>` | Throw to fail the sub-journey node. Output typed from the handle's `outputs` schema. |
| `after`      | `(out: O) => void \| Promise<void>` | Extraction / side-effect hook. Output typed from the handle's `outputs` schema.      |

## `output(value)`

```ts
function output(value: unknown): void;
```

Called from inside a reusable journey's step `after` hook — records the value handed back to the caller's `invokeJourney({ after })`. Validated against the journey's `outputs` schema. Multiple calls: last wins, with an `onLog` warning. Called outside a sub-journey context: a no-op with a warning.

## Pipeline nodes

```ts
type PipelineNode = { kind: "step"; def: StepDef } | { kind: "sub"; def: SubJourneyCallDef };
```

`collectPipeline(def)` returns a journey's pipeline as `PipelineNode[]`; `collectSubPipeline(call)` collects a `sub` node's child pipeline with the call's inputs resolved. See [Runtime](./runtime). Both `step` and `sub` nodes consume one `stepIdx` slot in the run's monotonic counter; a child sub-journey's steps consume their own slots in the same counter.

## The output cache

```ts
type CacheMode = "off" | "run" | "process" | "disk";

interface SubJourneyCache {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, value: unknown, ttlMs?: number): void | Promise<void>;
}

function createSubJourneyCache(
  mode: CacheMode,
  opts: { diskDir: string },
): SubJourneyCache | undefined;
```

| Export                  | Role                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `CacheMode`             | The four `--cache` values. `off` → no store.                                                  |
| `SubJourneyCache`       | Storage backend interface — `get` / `set` may be sync or async.                               |
| `MemorySubJourneyCache` | In-memory store. Used for `--cache=run` (fresh per run) and `--cache=process` (reused).       |
| `DiskSubJourneyCache`   | JSON-file-per-key store under a directory. Used for `--cache=disk`. Values must be JSON-safe. |
| `createSubJourneyCache` | Builds the backend for a `CacheMode`.                                                         |
| `subJourneyCacheKey`    | Composes the cache key — `` `${childJourneyName}:${resolvedKey}` ``.                          |

Cache identity is `childJourneyName + ":" + resolvedKey`. A call is cached only when it supplies a `cacheKey`; the `CacheMode` chooses the store's lifetime, not whether a given call caches. The CLI wires the store — core just receives one on its `HttpContext`.

## Group events

A sub-journey node emits `group:start` / `group:end` instead of `step:start` / `step:end`:

```ts
interface GroupStartEvent {
  runId: string;
  journeyIdx: number;
  name: string; // call-site override, else handle.name
  childJourneyName: string; // handle.name
  stepIdx: number; // slot consumed by the sub-journey node itself
  firstChildStepIdx: number;
  cacheStatus: "miss" | "hit";
  resolvedKey?: string;
}

interface GroupEndEvent {
  runId: string;
  journeyIdx: number;
  name: string;
  childJourneyName: string;
  stepIdx: number;
  lastChildStepIdx: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}
```

Subscribe via the `onGroupStart` / `onGroupEnd` hooks on `JourneyLogger`. The `{ stepIdx, firstChildStepIdx, lastChildStepIdx }` range lets a consumer fold the child's step events under the group. See [Logging](./logging).
