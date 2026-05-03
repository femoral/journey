---
title: Lazy values
description: When to wrap step options in a function, and why static values don't always work.
sources:
  - packages/core/src/runtime.ts
---

# Lazy values

`params`, `query`, `headers`, and `body` are all typed `Lazy<T>`:

```ts
type Lazy<T> = T | (() => T | Promise<T>);
```

You can pass either a static value or a function returning one (sync or async). The runtime calls the function at step execution time, awaiting promises.

## Why functions?

Closure variables holding state from earlier steps are `undefined` (or `""`, or `0`) at journey-registration time. Wrapping in a function defers the read until the step actually runs:

```ts
let token = "";

step("login", {
  endpoint: endpoints.login,
  body: { username: env("USERNAME"), password: env("PASSWORD") },
  after(res) {
    token = (res.body as { token: string }).token;
  },
});

// ❌ token is "" at registration time — this captures an empty string
step("create", {
  headers: { Authorization: `Bearer ${token}` },
});

// ✅ closure is called at execution time, after `login` has populated token
step("create", {
  headers: () => ({ Authorization: `Bearer ${token}` }),
});
```

The common mistake: forgetting the arrow function and ending up with `Authorization: "Bearer "` on every request.

## When static values are fine

If nothing depends on earlier steps, skip the closure:

```ts
step("ping", {
  endpoint: endpoints.ping,
  headers: { Accept: "application/json" }, // static — no closure needed
});
```

`env()` calls are safe as static values too — the active environment is set before any step runs:

```ts
step("login", {
  endpoint: endpoints.login,
  body: { username: env("USERNAME"), password: env("PASSWORD") }, // no closure needed
});
```

## Async lazy values

The function can be async; the runtime awaits it:

```ts
step("signed request", {
  endpoint: endpoints.submit,
  headers: async () => ({
    Authorization: `Bearer ${await readTokenFromDisk()}`,
  }),
});
```

Useful when you're reading a file, calling a helper that hits another service, or computing something with a crypto API.

## One closure per field

Each lazy field gets its own closure — no shared object between them. If you need to compute `headers` from the same base value as `body`, compute the base outside both closures or inside a shared `after` hook:

```ts
step("signed", {
  endpoint: endpoints.submit,
  body: () => ({ cartId, ts: nowMs }),
  headers: () => ({
    "X-Signature": signPayload({ cartId, ts: nowMs }),
  }),
});
```

Note how `cartId` and `nowMs` (closure variables) are referenced from both — they're the shared base. The runtime evaluates the four lazy fields in parallel via `Promise.all`-style awaiting, so don't rely on one closure running before another.

## Sync vs. async — no difference

`() => x`, `async () => x`, and `() => Promise.resolve(x)` all behave identically. Pick whichever is readable.
