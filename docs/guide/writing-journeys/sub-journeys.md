---
title: Sub-journeys
description: Reusable journeys invoked as a pipeline node from another journey — typed inputs, an output value, and an optional cache.
sources:
  - packages/core/src/runtime.ts
  - packages/core/src/cache.ts
  - examples/petstore/journeys/helpers/auth.ts
  - examples/petstore/journeys/sub-journey-at-start.journey.ts
---

# Sub-journeys

A **sub-journey** is a journey that other journeys invoke. It is registered once with typed inputs and outputs, then called as a pipeline node — a peer of `step()` — from any number of parent journeys.

The motivating case is auth: a dozen journeys each need a bearer token. Without sub-journeys you either copy a `login` step into every file or smuggle one in through a helper that calls `step()`. A sub-journey makes the bootstrap a first-class, named, typed unit.

## Two kinds of journey

`journey()` has two modes, picked by the options argument:

```ts
// Entry journey — auto-runs. (What every page so far has shown.)
journey("checkout", () => {
  /* steps */
});

// Reusable journey — returns a typed handle, does NOT auto-run.
export const acquireToken = journey(
  "auth.acquire-token",
  {
    reusable: true,
    inputs: z.object({ username: z.string(), password: z.string() }),
    outputs: z.object({ token: z.string(), expiresIn: z.number() }),
  },
  (input) => {
    /* steps that use `input` */
  },
);
```

An entry journey is enrolled in the run registry — `journey run`, the GUI, and `runAllRegistered()` execute it. A reusable journey (`reusable: true`) is **not** registered for auto-run; it returns a `JourneyHandle` you `export` and `import` where you need it.

The two modes have disjoint options — `inputs` / `outputs` are reusable-only, `tags` / `k6` are entry-only. The overloads enforce this at compile time.

## Anatomy

### Defining the reusable journey

The body takes one argument — the validated input. `z` is re-exported from `@journey/core` (a Journey project carries no dependencies, so `import { z } from "zod"` would not resolve).

```ts
import { env, expect, journey, output, step, z } from "@journey/core";

export const acquireToken = journey(
  "auth.acquire-token",
  {
    reusable: true,
    inputs: z.object({ username: z.string().min(1), password: z.string().min(1) }),
    outputs: z.object({ token: z.string().min(1), expiresIn: z.number() }),
  },
  (input) => {
    step("login via IDP", {
      endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
      body: { username: input.username, password: input.password },
      assert(res) {
        expect(res.status).toBe(200);
      },
      after(res) {
        const body = res.body as { token: string; expiresIn: number };
        output({ token: body.token, expiresIn: body.expiresIn });
      },
    });
  },
);
```

`output(value)` is the return mechanism — call it from any step's `after`. The value is validated against the `outputs` schema and handed to the caller. Last call wins (with a warning on a double call); a child that never calls `output()` hands the caller `undefined`.

### Invoking it

`invokeJourney(handle, opts)` registers the call as a pipeline node, alongside `step()` calls:

```ts
import { env, invokeJourney, journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

journey("sub-journey at start", () => {
  let token = "";

  invokeJourney(acquireToken, {
    name: "authenticate", // timeline label; defaults to the handle's name
    inputs: { username: env("USERNAME"), password: env("PASSWORD") },
    after: (out) => {
      token = out.token; // `out` is typed from acquireToken's outputs schema
    },
  });

  step("create a pet", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Biscuit", status: "available" },
  });
});
```

The handle reference carries the input/output types — a wrong `inputs` shape is a compile error at the call site, and renaming the exported handle refactors every call site through the LSP. There is no string-name lookup.

State flows out exactly like a step's: `after(out)` closes over a caller-scoped `let`. The call node is a peer of the surrounding steps — invoke a sub-journey at the start, the middle, or the end of a pipeline.

| `invokeJourney` opt | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `inputs`            | Value or lazy function. Validated against the handle's `inputs` schema. |
| `name`              | Timeline display label. Defaults to the child journey's name.           |
| `assert(out)`       | Throw to fail the sub-journey node (and the parent run). Typed output.  |
| `after(out)`        | Side-effect / extraction hook. Typed output.                            |
| `cacheKey`          | Opt into the output cache — see below.                                  |
| `cacheTtlMs`        | Per-entry time-to-live.                                                 |
| `cache`             | `"off"` disables caching for this one call.                             |

## Nesting

A reusable journey may itself `invokeJourney(...)` another. The timeline nests accordingly; recursion is capped at 8 levels.

```
nested sub-journey
  open a session          ← invokeJourney(establishSession)
    acquire token         ← establishSession invokes acquireToken
      login via IDP
    verify token
  register a pet
  clean up
```

## The output cache

A sub-journey call is cached **only** when it supplies a `cacheKey`. The key plus the child journey's name identify a cache slot; a hit short-circuits the child run and replays the stored output.

```ts
invokeJourney(acquireToken, {
  inputs: { username: env("USERNAME"), password: env("PASSWORD") },
  cacheKey: (i) => i.username, // opt in
  after: (out) => {
    token = out.token;
  },
});
```

Cache **lifetime** is a run-wide policy set by the [`--cache` flag](../cli/run) on `journey run` / `journey serve` — `off`, `run`, `process` (default), or `disk`. `journey serve` keeping one `process` cache across runs is the dev win: an auth token stays hot between iterations.

### Safe vs. unsafe cache keys

The key must capture **everything that changes the output**. A token's value depends on the credentials — `cacheKey: (i) => i.username` is correct only because the password is fixed per user in this project.

The sharper trap is **time**. A cached token is replayed verbatim; it does not refresh. If the token's lifetime is shorter than the cache lifetime, a later replay hands back an expired token. Match them: set `cacheTtlMs` below the token's expiry, or use `--cache=run` so the cache cannot outlive a single run.

```ts
invokeJourney(acquireToken, {
  inputs: { username: env("USERNAME"), password: env("PASSWORD") },
  cacheKey: (i) => i.username,
  cacheTtlMs: 4 * 60_000, // refresh before a 5-minute token expires
  after: (out) => {
    token = out.token;
  },
});
```

## Failure semantics

A failing assert / `after` / network error inside the child throws out of the sub-journey node. The node fails with a message naming both the child journey and the offending child step — e.g. `sub-journey 'auth.acquire-token' failed at step 'login via IDP': expected 401 to be 200`. The parent pipeline halts there, same as a failed step. It is one failure attributed to the node, not a second top-level run.

## How it shows up elsewhere

- **GUI** — the sub-journey is a collapsible timeline row; expand it to see the child's steps with their own pass/fail badges. A cache hit carries a badge.
- **`journey export k6`** — child steps are inlined under a k6 `group()` named after the call. Cache opts are ignored (every VU iteration re-runs the child). See [export k6](../cli/export-k6#sub-journeys).
- **`journey export postman`** — the call becomes a nested folder; inputs become folder-scoped variables. Cache opts are ignored. See [export postman](../cli/export-postman#sub-journeys).

## Reference

Signatures and event types: [Reference — Sub-journeys](../../reference/journey-api/sub-journey).
