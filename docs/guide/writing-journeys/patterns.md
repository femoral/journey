---
title: Patterns
description: Common journey shapes — auth-token capture, external fixture seeding, conditional assertions, inline debug logging.
sources:
  - packages/core/src/runtime.ts
  - examples/petstore/journeys/pet-crud-flow.journey.ts
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

## Run-once setup that other steps depend on

`journey run --all` runs each `.journey.ts` file sequentially, but there is no "one-time setup" hook across files. Put shared setup at the top of the journey body if it's cheap (e.g. an auth step); factor it into a helper function if multiple journeys need it.

```ts
function authStep() {
  return step("auth", {
    endpoint: endpoints.login,
    body: { username: env("USER"), password: env("PASS") },
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });
}

journey("flow A", () => {
  let token = "";
  authStep();
  // … more steps that use `token`
});
```

Closures still work because `token` is in scope where the helper is called.

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
