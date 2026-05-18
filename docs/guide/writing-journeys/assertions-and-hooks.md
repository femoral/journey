---
title: Assertions and hooks — assert and after
description: The two callbacks a step can define, what res is typed as, and how failures propagate.
sources:
  - packages/core/src/runtime.ts
  - packages/core/src/http.ts
---

# Assertions and hooks

Every step can define two callbacks. Both receive the same `HttpResponse` object, both are optional, both can be async.

```ts
interface StepOptions<E extends Endpoint> {
  assert?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
  after?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
}
```

## `assert(res)` — verify the response

Runs **after** the response arrives, **before** `after`. Any thrown error fails the step — the built-in [`expect()`](./expect) helper throws `AssertionError`, but plain `throw new Error(...)` works too.

```ts
step("list pets", {
  endpoint: endpoints.findPetsByStatus,
  query: { status: "available" },
  assert(res) {
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  },
});
```

`res` is typed `HttpResponse<ResponseOf<E>>`. When `endpoint` is an `EndpointRef<T>`, `res.body` is typed as `T`. For descriptor endpoints, `res.body` is `unknown` and needs a cast.

## `after(res)` — extract state / side effect

Runs after `assert` succeeds (or immediately after the response if no `assert` is defined). The canonical use is stashing values into closure variables for later steps:

```ts
let token = "";

step("login", {
  endpoint: endpoints.login,
  body: { username: env("USERNAME"), password: env("PASSWORD") },
  after(res) {
    token = (res.body as { token: string }).token;
  },
});
```

`after` can also:

- Call external services (fire-and-forget notifications, metrics).
- Write to disk (log responses for debugging).
- `console.log(res.body)` to inspect unexpected responses in the Console dock's Logs tab.

Anything thrown inside `after` fails the step.

## `HttpResponse<T>`

```ts
interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
}
```

Header keys are lowercased by the `fetch` response and copied as-is. Body parsing:

| Response `Content-Type` includes | Parsed as                                                  |
| -------------------------------- | ---------------------------------------------------------- |
| `json`                           | `await res.json()` (falls back to `null` on parse failure) |
| anything else                    | `await res.text()`                                         |

## Halting behaviour

When a step fails — either `assert` throws, `after` throws, the request errors, or a timeout fires — the **rest of the journey is skipped**. The journey's `JourneyResult.ok` is `false`.

**Other journeys in the same run continue unaffected.** `journey run --all` runs each journey independently; one failure doesn't cascade.

## Execution order per step

1. Resolve lazy inputs (`headers`, `query`, `body`, `params`) in parallel.
2. Build the request (path substitution, header merge, auto `Content-Type`).
3. Logger `onRequest`.
4. `fetch` (with abort timer if `timeoutMs`).
5. Logger `onResponse` (or `onError` on failure).
6. `assert(res)` if defined — throw fails the step.
7. `after(res)` if defined — throw fails the step.
8. Logger `onStepEnd` with `ok` and `durationMs`.

## Choosing between `assert` and `after`

A rough guide:

- **Needs to pass/fail the step?** → `assert`.
- **Stashes a value for a later step?** → `after`.
- **Both?** → Put the validation in `assert`, the extraction in `after`. They run in that order, so `after` only executes if the response survived validation.

You can put everything in `after` and throw from there — nothing stops you. But splitting makes the intent explicit and means failures are grouped in the "assertion failed" bucket rather than "side-effect errored out".
