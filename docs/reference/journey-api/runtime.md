---
title: Runtime
description: journey, step, runAllRegistered, runJourney — registration and execution.
sources:
  - packages/core/src/runtime.ts
---

# Runtime

## `journey(name, body)`

```ts
function journey(name: string, body: () => void | Promise<void>): void;
```

Registers a journey. The body runs at registration time (collecting `step()` calls), not per run. See [Writing journeys → journey() and step()](../../guide/writing-journeys/journey-and-step).

## `step(name, options)`

```ts
function step<E extends Endpoint>(name: string, options: StepOptions<E>): void;
```

Registers a step inside a journey body. Throws if called outside a `journey()` body. Full field list in the [Step options reference](../step-options).

## `runAllRegistered(ctx, opts?)`

```ts
function runAllRegistered(
  ctx: HttpContext,
  opts?: RunMeta,
): Promise<JourneyResult[]>;
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

## `getRegisteredJourneys()`

```ts
function getRegisteredJourneys(): ReadonlyArray<{ name: string; body: () => void | Promise<void> }>;
```

Inspect the registry without consuming it. Mostly useful for introspection tools.

## `clearRegistry()`

```ts
function clearRegistry(): void;
```

Drops every registered journey. `runAllRegistered` calls this internally after snapshotting.

## Types

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
