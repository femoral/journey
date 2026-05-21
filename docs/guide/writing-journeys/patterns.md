---
title: Patterns
description: Common journey shapes — auth-token capture, external fixture seeding, conditional assertions, helper-injected steps, observable hook HTTP.
sources:
  - packages/core/src/runtime.ts
  - packages/core/src/fetch.ts
  - packages/cli/src/server/runBroadcaster.ts
  - examples/petstore/journeys/multi-step-crud.journey.ts
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

## Reusable helper that injects a step

`journey run --all` runs each `.journey.ts` file sequentially, but there is no "one-time setup" hook across files. For shared setup — almost always an auth step — write a helper that calls `step()` from inside the `journey()` body. The runtime collects every `step()` call that fires during a single body evaluation, so a helper invocation is indistinguishable from a literal `step()` from the runtime's point of view.

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

An auth helper often needs to mint a token by calling several upstream services from inside the step's `after` hook. Plain `globalThis.fetch` works but is invisible to the Debug Console and run history because it bypasses the runtime's logger. Import `fetch` from `@journey/core` instead — same signature, same behaviour, but routes through the active run's logger when called inside any step hook:

```ts
import { fetch } from "@journey/core";

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
