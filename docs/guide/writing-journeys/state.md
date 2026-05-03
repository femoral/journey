---
title: State between steps
description: How values flow from one step to the next — plain closure variables, no templating.
sources:
  - packages/core/src/runtime.ts
  - examples/petstore/journeys/pet-crud-flow.journey.ts
---

# State between steps

There is no `step.field` templating, no JSONPath extraction language, no context object. State flows via plain TypeScript closures:

1. Declare `let` variables at the top of your `journey()` body.
2. Assign them inside `after(res)` hooks.
3. Read them inside [lazy functions](./lazy-values) (`headers: () => ({ ... })`, `params: () => ({ ... })`) in later steps.

## Canonical example

```ts
journey("checkout", () => {
  let token = "";
  let cartId = "";

  step("auth", {
    endpoint: endpoints.login,
    body: { username: env("USER"), password: env("PASS") },
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });

  step("open cart", {
    endpoint: endpoints.createCart,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    after(res) {
      cartId = (res.body as { id: string }).id;
    },
  });

  step("add item", {
    endpoint: endpoints.addCartItem,
    params: () => ({ id: cartId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: { sku: "PET-123", qty: 1 },
  });
});
```

Three closure variables (`token`, `cartId`) carry state across five steps. Initial values can be `""`, `0`, or `null as string | null` — whatever makes the types ergonomic. The `after` hooks populate them; the lazy callbacks read them.

## Why no templating?

A DSL would need to:

- Parse expressions (something like <span v-pre>`{{step[0].body.token}}`</span>).
- Reinvent type inference (good luck typing `step[0].body.token` as a `string`).
- Handle missing values with its own error model.
- Lose IDE autocomplete.

Plain TypeScript gets all four for free. The tradeoff is you see the `let` at the top of the body — which is an advantage, not a cost, because it makes the shared state explicit.

## Don't rely on mutation during a single step

Closures capture references, not snapshots. If you mutate the same variable inside `assert` and re-read it in `after`, you get the mutated value — which is usually not what you want. Treat closures as "one step writes, later steps read":

```ts
// ❌ Confusing — `token` changes mid-step
step("refresh", {
  endpoint: endpoints.refresh,
  headers: () => ({ Authorization: `Bearer ${token}` }),
  assert(res) {
    token = "TEMP";
    // body is read after header resolution, but this mutation outlives the step
  },
});

// ✅ Clear — extraction is the last thing the step does
step("refresh", {
  endpoint: endpoints.refresh,
  headers: () => ({ Authorization: `Bearer ${token}` }),
  assert(res) {
    expect(res.status).toBe(200);
  },
  after(res) {
    token = (res.body as { token: string }).token;
  },
});
```

## The full petstore example

Every HTTP method against a single resource, all state via `token` and `petId`:

[`examples/petstore/journeys/pet-crud-flow.journey.ts`](https://github.com/femoral/journey/blob/main/examples/petstore/journeys/pet-crud-flow.journey.ts).
