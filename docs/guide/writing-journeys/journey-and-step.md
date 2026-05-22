---
title: journey() and step()
description: The two core functions every .journey.ts file uses.
sources:
  - packages/core/src/runtime.ts
---

# `journey()` and `step()`

## `journey(name, body)`

```ts
function journey(name: string, body: () => void | Promise<void>): void;
```

| Argument | Type                          | Required | Notes                                                             |
| -------- | ----------------------------- | -------- | ----------------------------------------------------------------- |
| `name`   | `string`                      | Yes      | Shown in logs and run records.                                    |
| `body`   | `() => void \| Promise<void>` | Yes      | Called once, at **registration time**, to collect `step()` calls. |

Calling `journey()` does **not** execute any HTTP requests. It registers the journey in a module-level registry. The runner (`journey run`, the GUI, or `runAllRegistered()`) walks the registry later and executes each journey's `body`, then each collected step.

Two consequences:

1. **`step()` must be called inside a `journey()` body.** Calling it at the top level throws: `step("foo") called outside a journey(...) body`.
2. **Top-level code runs at import time, not per-run.** Put per-run state inside the `journey` callback — module-level variables are shared across runs.

::: tip Reusable journeys
`journey()` has a second mode — `journey(name, { reusable: true, inputs, outputs }, body)` returns a typed handle instead of registering for auto-run, so other journeys can `invokeJourney(handle, …)` it as a pipeline node. See [Sub-journeys](./sub-journeys).
:::

## `step(name, options)`

```ts
function step<E extends Endpoint>(name: string, options: StepOptions<E>): void;
```

| Argument  | Type             | Required | Notes                                        |
| --------- | ---------------- | -------- | -------------------------------------------- |
| `name`    | `string`         | Yes      | Appears in logs and in the Run history view. |
| `options` | `StepOptions<E>` | Yes      | Per-step configuration.                      |

`StepOptions<E>` has one required field (`endpoint`) and seven optional ones. Each is covered in its own page:

| Field                                | Page                                           |
| ------------------------------------ | ---------------------------------------------- |
| `endpoint`                           | [Endpoints](./endpoints)                       |
| `params`, `query`, `headers`, `body` | [Request inputs](./request-inputs)             |
| `timeoutMs`                          | [Timeouts](./timeouts)                         |
| `assert`, `after`                    | [Assertions and hooks](./assertions-and-hooks) |

Full lookup table: [Reference — Step options](../../reference/step-options).

## Registration vs. execution

The most common beginner confusion:

```ts
journey("example", () => {
  console.log("A"); // ← runs at registration (import)
  step("fetch", {
    endpoint: endpoints.ping,
    assert(res) {
      console.log("B"); // ← runs when the step executes
    },
  });
});
```

Running `journey run …` prints `A` once during import, then `B` during execution. Don't put per-run setup at the top of the body — put it inside a step (e.g. a `seed` step that creates fixtures).
