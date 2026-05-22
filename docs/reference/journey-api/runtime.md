---
title: Runtime
description: journey, step, runAllRegistered, runJourney — registration and execution.
sources:
  - packages/core/src/runtime.ts
---

# Runtime

## `journey(name, body)` / `journey(name, options, body)`

```ts
function journey(name: string, body: () => void | Promise<void>): void;
function journey(name: string, options: JourneyOptions, body: () => void | Promise<void>): void;
```

Registers a journey. The body runs at registration time (collecting `step()` and `invokeJourney()` calls), not per run. See [Writing journeys → journey() and step()](../../guide/writing-journeys/journey-and-step).

The optional `options` object carries cross-cutting metadata. For an **entry** journey: `tags` (used by [`journey export k6 --tag`](../../guide/cli/export-k6) to filter which journeys ship to k6) and `k6` (load options baked into the emitted k6 script's `export const options`). With `{ reusable: true, inputs, outputs }` it switches to the **reusable** overload — returns a `JourneyHandle` instead of registering for auto-run. See [Sub-journeys](./sub-journey).

## `step(name, options)`

```ts
function step<E extends Endpoint>(name: string, options: StepOptions<E>): void;
```

Registers a step inside a journey body. Throws if called outside a `journey()` body. Full field list in the [Step options reference](../step-options).

`step()` may be called from a helper function that the journey body invokes — the runtime collects every `step()` that fires during a single body evaluation, regardless of call site. See the [reusable auth-helper pattern](../../guide/writing-journeys/patterns#reusable-helper-that-injects-a-step) for the canonical shape. The runtime broadcasts the resolved list via [`onPlanned`](./logging#runplannedevent) before iterating, so consumers (CLI, GUI, exporters) see helper-injected steps from the first frame.

## `runAllRegistered(ctx, opts?)`

```ts
function runAllRegistered(ctx: HttpContext, opts?: RunMeta): Promise<JourneyResult[]>;
```

Walks the journey registry, clears it, and runs each journey in order. Emits `onRunStart` / `onRunEnd` via `ctx.logger`; every journey in the same invocation shares one `runId`. `stepIdx` is **monotonic across journey boundaries** so subscribers can key streams by it.

## `runJourney(def, ctx, opts?)`

```ts
function runJourney(
  def: JourneyDef,
  ctx: HttpContext,
  opts?: {
    runId?: string;
    journeyIdx?: number;
    stepIdxOffset?: number;
    upToStepIdx?: number;
  },
): Promise<JourneyResult>;
```

Run a single journey without touching the registry. Does **not** emit `onRunStart` / `onRunEnd` — the caller is responsible if it wants them.

## `collectPipeline(def)`

```ts
function collectPipeline(def: JourneyDef): Promise<ReadonlyArray<PipelineNode>>;
```

Evaluates `def.body()` once, capturing every `step()` and `invokeJourney()` call into an ordered list of pipeline nodes — `{ kind: "step", def }` or `{ kind: "sub", def }` — and returning it without executing anything. Used by `journey export postman` / `journey export k6` to walk a journey structurally without performing HTTP, and available to custom tooling. Side effects from the body itself still run each time it's evaluated — keep ID generation, env reads, and outbound HTTP **inside** step hooks (`headers`, `body`, `assert`, `after`) rather than at top level, so a `collectPipeline` call followed by a `runJourney` call (which re-evaluates the body) doesn't fire them twice.

## `collectSubPipeline(call)`

```ts
function collectSubPipeline(call: SubJourneyCallDef): Promise<ReadonlyArray<PipelineNode>>;
```

Given a `{ kind: "sub" }` node's `def` (a `SubJourneyCallDef`, as returned by `collectPipeline`), resolves the call's `inputs` and evaluates the referenced reusable journey's body with them — so `input.*` references inside the child resolve. Returns the child's pipeline nodes. Best-effort: if input resolution throws, the child is collected with `undefined` input.

A reusable journey may itself invoke another, so the returned nodes can contain further `sub` nodes — exporters call `collectSubPipeline` recursively to walk a journey into its full nested tree. This re-entrancy is capped at 8 levels at execution time; the runtime throws beyond that.

## `getRegisteredJourneys()`

```ts
function getRegisteredJourneys(): ReadonlyArray<{
  name: string;
  body: () => void | Promise<void>;
  options?: JourneyOptions;
}>;
```

Inspect the registry without consuming it. Mostly useful for introspection tools.

## `clearRegistry()`

```ts
function clearRegistry(): void;
```

Drops every registered journey. `runAllRegistered` calls this internally after snapshotting.

## Types

### `JourneyOptions`

```ts
interface JourneyOptions {
  tags?: string[];
  k6?: K6JourneyOptions;
}
```

- `tags` — free-form labels. `journey export k6 --tag <t>` selects only journeys carrying every listed tag (AND across repeats).
- `k6` — k6 options baked into the emitted script as `export const options = {...}`. Module-scoped on the k6 side: at most one journey per file may declare a `k6` block (the export errors otherwise).

### `K6JourneyOptions`

```ts
interface K6JourneyOptions {
  vus?: number;
  duration?: string;
  iterations?: number;
  stages?: Array<{ duration: string; target: number }>;
  [extra: string]: unknown;
}
```

The named fields cover the common load profiles. The index signature passes any other k6 options key (thresholds, scenarios, ext, …) straight through to the emitted `export const options`.

### `RunMeta`

```ts
interface RunMeta {
  runId?: string;
  /** Absolute (monotonic) stepIdx to stop after. */
  upToStepIdx?: number;
}
```

- `runId` — provide one to correlate events with external systems (job IDs, trace spans). Defaults to `crypto.randomUUID()`.
- `upToStepIdx` — stop the run after this step index (across journey boundaries). The run still emits `run:end` cleanly; later journeys/steps aren't executed.

### `StepOptions<E>`

```ts
interface StepOptions<E extends Endpoint> {
  endpoint: E;
  params?: Lazy<Record<string, string | number>>;
  query?: Lazy<Record<string, string | number | boolean | undefined>>;
  headers?: Lazy<Record<string, string>>;
  body?: Lazy<unknown>;
  timeoutMs?: number;
  assert?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
  after?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
}

type Lazy<T> = T | (() => T | Promise<T>);
```

See the [Step options reference](../step-options) for the same table in lookup form.

### `StepResult`

```ts
interface StepResult {
  name: string;
  ok: boolean;
  request?: { method: string; url: string };
  response?: HttpResponse;
  error?: string;
  durationMs: number;
}
```

On success: `ok: true`, `request` + `response` populated.
On failure: `ok: false`, `request` populated (if the failure happened after request construction), `error` set.

### `JourneyResult`

```ts
interface JourneyResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
  durationMs: number;
}
```

`ok` is true if and only if every step in `steps` is `ok`. `durationMs` is the wall-clock time from the start of the first step to the end of the last.
