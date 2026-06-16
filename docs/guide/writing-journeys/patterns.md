---
title: Patterns
description: Common journey shapes — auth-token capture, reusable sub-journeys, external fixture seeding, conditional assertions, observable hook HTTP — and anti-patterns to avoid.
sources:
  - packages/core/src/runtime.ts
  - packages/core/src/fetch.ts
  - packages/cli/src/server/runBroadcaster.ts
  - examples/petstore/journeys/multi-step-crud.journey.ts
  - examples/petstore/journeys/helpers/auth.ts
---

# Patterns

## Auth-token capture

Extract once in `after`, read in subsequent `headers` closures.

```ts
let token = "";

step("auth", {
  endpoint: endpoints.login,
  body: { username: env("USER"), password: env("PASS") },
  after(res) {
    token = (res.body as { token: string }).token;
  },
});

step("authed call", {
  endpoint: endpoints.protectedResource,
  headers: () => ({ Authorization: `Bearer ${token}` }),
});
```

## Prep logic before a request

There's no `before` hook on a step — prep runs in one of three places depending on what kind of prep it is.

**Prep that feeds the request** (signing, token reads, computed payloads) goes in a lazy async `headers` / `body` / `query` / `params`. The runtime awaits these at step execution time, so async work is fine. See [Async lazy values](./lazy-values#async-lazy-values).

```ts
step("signed", {
  endpoint: endpoints.submit,
  body: { cartId, qty: 1 },
  headers: async () => ({
    "X-Signature": await signPayload({ cartId, qty: 1 }),
  }),
});
```

**Prep that depends on a previous step's response** goes in that previous step's `after(res)`. State flows forward through closure variables — same shape as [Auth-token capture](#auth-token-capture) above.

**Prep that runs once per journey** (a nonce, a timestamp, a computed base URL) goes directly in the `journey()` body, before the step that needs it. Plain TypeScript runs there — no special hook required.

```ts
journey("place order", () => {
  const nonce = crypto.randomUUID();
  let orderId = "";

  step("create", {
    endpoint: endpoints.createOrder,
    headers: { "Idempotency-Key": nonce },
    body: { sku: "A", qty: 1 },
    after(res) {
      orderId = (res.body as { id: string }).id;
    },
  });
});
```

## Seed via descriptor, then run typed flow

Use a [descriptor endpoint](./endpoints) to hit a service outside your spec (e.g. a fixtures API), capture an ID, then continue with typed refs.

```ts
let accountId = "";

step("seed account", {
  endpoint: {
    method: "POST",
    path: "/fixtures/accounts",
    baseUrl: env("SEED_URL"),
  },
  body: { currency: "GBP" },
  after(res) {
    accountId = (res.body as { id: string }).id;
  },
});

step("fetch account", {
  endpoint: endpoints.getAccountById,
  params: () => ({ id: accountId }),
});
```

## Environment-scoped request IDs

Precompute a per-run ID and stamp every outgoing request with it for log correlation.

```ts
const runId = `${env("ENVIRONMENT")}-${Date.now()}`;

step("create", {
  endpoint: endpoints.createOrder,
  headers: () => ({ "X-Request-Id": `${runId}-order` }),
  body: { sku: "A", qty: 1 },
});
```

## Conditional assertion

Use a normal `if` to gate extra checks behind an environment flag:

```ts
step("check", {
  endpoint: endpoints.getOrder,
  params: () => ({ id: orderId }),
  assert(res) {
    expect(res.status).toBe(200);
    if (env("STRICT_CHECKS") === "true") {
      expect((res.body as { metadata: unknown }).metadata).toBeDefined();
    }
  },
});
```

## Inline `console.log` for debugging

Anything you `console.log` from inside a hook is captured by the runner's logger. In the GUI, it shows up in the Console dock's **Logs** tab; in the CLI, it's written to stderr.

```ts
step("create pet", {
  endpoint: endpoints.createPet,
  body: { name: "Mittens" },
  assert(res) {
    console.log(res.body); // visible in Logs tab / stderr
    expect(res.status).toBe(201);
  },
});
```

Leave these in until the feature is shipping, then delete — no production code runs journeys, so there's no lint rule enforcing quiet logs.

## Reusable sub-journey for shared setup

When several journey **files** need the same call sequence — an auth bootstrap, a fixture seed, a cleanup — make it a [reusable sub-journey](./sub-journeys), not a step copied into each file. Define it once with `reusable: true` and a typed `inputs` / `outputs` schema; `invokeJourney(handle, …)` it as a pipeline node.

```ts
// journeys/helpers/auth.ts
import { env, expect, journey, output, step, z } from "@usejourney/core";

export const acquireToken = journey(
  "auth.acquire-token",
  {
    reusable: true,
    inputs: z.object({ username: z.string(), password: z.string() }),
    outputs: z.object({ token: z.string() }),
  },
  (input) => {
    step("login", {
      endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
      body: { username: input.username, password: input.password },
      assert: (res) => expect(res.status).toBe(200),
      after: (res) => output({ token: (res.body as { token: string }).token }),
    });
  },
);
```

```ts
import { env, invokeJourney, journey, step } from "@usejourney/core";
import { endpoints } from "../generated/endpoints.js";
import { acquireToken } from "./helpers/auth.js";

journey("flow A", () => {
  let token = "";

  invokeJourney(acquireToken, {
    inputs: { username: env("USER"), password: env("PASS") },
    after: (out) => {
      token = out.token; // `out` is typed from acquireToken's outputs schema
    },
  });

  step("authed call", {
    endpoint: endpoints.protectedResource,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
});
```

This is not auth-specific — a fixture-seeding call invoked first, a teardown invoked last, follow the same shape. The handle carries the input/output types, so a wrong `inputs` shape is a compile error and a rename refactors every call site. Full detail — output cache, nesting, failure semantics — is in [Sub-journeys](./sub-journeys).

## Reusable helper that injects a step

For shared setup across **files**, prefer a [reusable sub-journey](#reusable-sub-journey-for-shared-setup) — typed, named, individually cacheable. The helper-injects-`step()` trick below is the lighter-weight option when the factoring stays inside one file.

`journey run --all` runs each `.journey.ts` file sequentially, but there is no "one-time setup" hook across files. A helper can call `step()` from inside the `journey()` body — the runtime collects every `step()` call that fires during a single body evaluation, so a helper invocation is indistinguishable from a literal `step()` from the runtime's point of view.

```ts
function registerAuthStep(setToken: (t: string) => void) {
  step("auth", {
    endpoint: endpoints.login,
    body: { username: env("USER"), password: env("PASS") },
    after(res) {
      setToken((res.body as { token: string }).token);
    },
  });
}

journey("flow A", () => {
  let token = "";
  registerAuthStep((t) => (token = t));
  step("authed call", {
    endpoint: endpoints.protectedResource,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
});
```

Closures still work because `token` is in scope where the helper is called.

The GUI's step timeline knows about helper-injected steps: every run starts with a `step:planned` SSE event (see [Logging — `RunPlannedEvent`](../../reference/journey-api/logging)) carrying the resolved step list, so the timeline renders the auth step from the first frame — there is no "list grows mid-run" effect even though the source has no literal `step("auth", …)` at file scope.

## Making upstream calls from hooks visible

An auth helper often needs to mint a token by calling several upstream services from inside the step's `after` hook. Plain `globalThis.fetch` works but is invisible to the Debug Console and run history because it bypasses the runtime's logger. Import `fetch` from `@usejourney/core` instead — same signature, same behaviour, but routes through the active run's logger when called inside any step hook:

```ts
import { fetch } from "@usejourney/core";

function registerAuthStep(setToken: (t: string) => void) {
  step("auth", {
    endpoint: { method: "GET", path: "/health" },
    async after() {
      // Each fetch below appears in the Debug Console / run history,
      // attributed to the surrounding `auth` step.
      const opaque = await fetch(env("PASSPORT_URL")).then((r) => r.text());
      const jwt = await fetch(env("TOKENINFO_URL"), {
        method: "POST",
        headers: { Authorization: `Bearer ${opaque}` },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      setToken(jwt.access_token);
    },
  });
}
```

When called outside any run (e.g. at module load) the wrapper delegates to `globalThis.fetch` with no behaviour change, so the same helper module is reusable from ad-hoc scripts. See [Journey API → Fetch](../../reference/journey-api/fetch) for the full reference.

## Two journeys in one file

You can call `journey()` multiple times in a single `.journey.ts` file — they'll be registered in order and run sequentially:

```ts
journey("happy path", () => {
  step("create", {
    endpoint: endpoints.createPet,
    body: { name: "A" },
    assert: (r) => expect(r.status).toBe(201),
  });
});

journey("error path", () => {
  step("create invalid", {
    endpoint: endpoints.createPet,
    body: {},
    assert: (r) => expect(r.status).toBe(400),
  });
});
```

Running produces two journey results. Failures in one don't affect the other.

## Anti-patterns

Shapes that look reasonable but bite later.

### Static interpolation in a field that depends on a prior step

```ts
// ✗ token is "" — the template is evaluated at registration, before `login` runs
headers: { Authorization: `Bearer ${token}` },
// ✓ wrap in a function — evaluated at step-execution time
headers: () => ({ Authorization: `Bearer ${token}` }),
```

Any `headers` / `body` / `params` / `query` value derived from an earlier step **must** be lazy. The classic symptom is `Authorization: "Bearer "` on every request. See [Lazy values](./lazy-values).

### Response-derived setup placed at the body top

Code at the top of the `journey()` body runs at **registration** — once, at import, before any step executes. A value read from a prior response does not exist there. Run-once constants (a nonce, a timestamp) are fine at the top; anything derived from a response belongs in that step's `after`. See [`journey()` and `step()` — registration vs. execution](./journey-and-step#registration-vs-execution).

### Copy-pasting an auth or setup step across files

Ten copies of a `login` step is ten edits when the endpoint moves, with no type link between them. Factor it into a [reusable sub-journey](#reusable-sub-journey-for-shared-setup).

### One journey doing several unrelated flows

A failed step halts the rest of _its_ journey, so a first failure masks every later check. Keep one journey = one user-meaningful flow; put independent flows in [separate journeys](#two-journeys-in-one-file).

### Hand-editing `generated/`

`journey generate` overwrites `generated/endpoints.ts` and `generated/models.ts` wholesale. Edit the spec and regenerate — never edit the output.

### `import { z } from "zod"`

A Journey project carries no dependencies, so `zod` will not resolve. `z` is re-exported from `@usejourney/core` — `import { z } from "@usejourney/core"`.

### `globalThis.fetch` inside a hook

Raw `fetch` in an `after` / `assert` hook bypasses the runtime logger — the call is invisible in the Debug Console and run history. Import `fetch` from `@usejourney/core` instead — see [Making upstream calls from hooks visible](#making-upstream-calls-from-hooks-visible).

### A step with no `assert`

A step without an `assert` only verifies the request didn't throw — a `500` passes silently. Assert the status and body shape you expect, even on the happy path.

### A `cacheKey` that ignores what changes the output

A cached sub-journey output is replayed verbatim. If the key omits an input that changes the result — or ignores token expiry — a stale value is served. The key must capture everything that varies the output; cap a token with `cacheTtlMs` below its TTL. See [Sub-journeys — the output cache](./sub-journeys#the-output-cache).
