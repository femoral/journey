---
title: Writing journeys
description: The top-level shape of a .journey.ts file. Start here, then dive into individual topics.
sources:
  - packages/core/src/runtime.ts
  - examples/petstore/journeys/multi-step-crud.journey.ts
---

# Writing journeys

A **journey** is a `.journey.ts` file that describes a sequence of HTTP steps. Each step calls one endpoint, optionally asserts on the response, and can stash values for later steps. The whole thing is plain TypeScript — if you can express it in TS, you can use it in a journey.

## Anatomy of a `.journey.ts` file

```ts
import { journey, step, env, expect } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

journey("multi-step crud", () => {
  let token = "";
  let petId = 0;

  step("login", {
    endpoint: endpoints.login,
    body: { username: env("USERNAME"), password: env("PASSWORD") },
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });

  step("create pet", {
    endpoint: endpoints.createPet,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { name: "Mittens", status: "available" },
    assert(res) {
      expect(res.status).toBe(201);
    },
    after(res) {
      petId = (res.body as { id: number }).id;
    },
  });
});
```

Three pieces:

- `journey(name, body)` wraps everything.
- `step(name, options)` calls go inside, one per HTTP call.
- Closure variables (`token`, `petId`) carry state between steps — there is no templating DSL.

## Roadmap

Read in this order if you're new:

1. [`journey()` and `step()`](./journey-and-step) — the two functions every journey uses.
2. [Endpoints](./endpoints) — typed refs from the spec vs. hand-written descriptors.
3. [Request inputs](./request-inputs) — `params`, `query`, `headers`, `body`.
4. [Lazy values](./lazy-values) — when and why to wrap options in a function.
5. [State between steps](./state) — closure variables, no templating.
6. [Assertions and hooks](./assertions-and-hooks) — `assert` vs. `after`, halting behavior.
7. [`expect()` matchers](./expect) — the built-in assertion helper.
8. [Timeouts](./timeouts) — per-step `timeoutMs`.
9. [`env()` in journeys](./env) — reading environment variables.
10. [Sub-journeys](./sub-journeys) — reusable journeys invoked from another journey.
11. [Patterns](./patterns) — auth capture, reusable sub-journeys, fixture seeding, conditional assertions, and anti-patterns to avoid.

The full petstore journey — using every HTTP method against a single resource — lives at [`examples/petstore/journeys/multi-step-crud.journey.ts`](https://github.com/femoral/journey/blob/main/examples/petstore/journeys/multi-step-crud.journey.ts).
