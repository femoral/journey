---
title: Step options reference
description: Every field of StepOptions in a single lookup table.
sources:
  - packages/core/src/runtime.ts
  - packages/core/src/endpoint.ts
  - packages/core/src/http.ts
---

# Step options reference

One-shot lookup for every field of `StepOptions<E>`. For the prose version and patterns, see [Writing journeys](../guide/writing-journeys/).

## Signature

```ts
function step<E extends Endpoint>(name: string, options: StepOptions<E>): void;

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

## Fields

| Field        | Type                                                                             | Default | Required | Notes |
|--------------|----------------------------------------------------------------------------------|---------|----------|-------|
| `endpoint`   | `EndpointRef<R>` \| `EndpointDescriptor`                                         | —       | **Yes**  | Refs carry a response-type brand so `assert`/`after` get typed `res.body`. Descriptors yield `unknown`. |
| `params`     | `Lazy<Record<string, string \| number>>`                                         | —       | No       | Substituted into `{name}` path templates. Missing template var → runtime error `Missing path param "…"`. Values URL-encoded. |
| `query`      | `Lazy<Record<string, string \| number \| boolean \| undefined>>`                 | —       | No       | Appended as query string. `undefined` values dropped. |
| `headers`    | `Lazy<Record<string, string>>`                                                   | —       | No       | Merged on top of `HttpContext.defaultHeaders`. Per-step keys win. |
| `body`       | `Lazy<unknown>`                                                                  | —       | No       | Strings sent raw. Non-strings `JSON.stringify`'d with `Content-Type: application/json` added if no content type is already set. |
| `timeoutMs`  | `number`                                                                         | —       | No       | Wraps fetch in an `AbortController`. Aborted requests reject as step errors. No default. |
| `assert`     | `(res: HttpResponse<ResponseOf<E>>) => void \| Promise<void>`                    | —       | No       | Runs after the response arrives. Throw to fail. |
| `after`      | `(res: HttpResponse<ResponseOf<E>>) => void \| Promise<void>`                    | —       | No       | Runs after `assert` succeeds (or right after the response if no `assert`). Use for closure-variable extraction. |

## `HttpResponse<T>`

```ts
interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
}
```

Header keys are lowercased by the `fetch` response and copied as-is.

Body parsing:

| Response `Content-Type` includes | Parsed as |
|----------------------------------|-----------|
| `json`                           | `await res.json()` (falls back to `null` on parse error) |
| anything else                    | `await res.text()` |

## Lazy evaluation

Fields typed `Lazy<T>` accept either a static value or `(() => T)` or `(() => Promise<T>)`. The runtime resolves them **at step execution time**, awaiting promises. Closures capture journey-body variables that may have been updated by earlier steps' `after` hooks.

## Execution order per step

1. Resolve lazy `headers`, `query`, `body`, `params` (in parallel, awaited together).
2. Build the request (`buildRequest` — path substitution, header merge, auto `Content-Type`).
3. `ctx.logger?.onRequest(req)`.
4. `fetch` (with abort timer if `timeoutMs`).
5. `ctx.logger?.onResponse(req, res)` — or `onError` on failure.
6. `assert(res)` if defined. Thrown errors fail the step.
7. `after(res)` if defined. Thrown errors fail the step.
8. `onStepEnd` with `ok` and `durationMs`.

On step failure the journey halts — no further steps in that journey run. Other journeys in the same run continue.
