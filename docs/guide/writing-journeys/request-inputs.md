---
title: Request inputs — params, query, headers, body
description: The four fields that build the HTTP request — when to use each, what they accept, and what the runtime does with them.
sources:
  - packages/core/src/http.ts
  - packages/core/src/runtime.ts
---

# Request inputs

Four fields on `StepOptions` shape the outgoing request. All are optional. All accept [lazy values](./lazy-values) — either a literal, or a function returning one (sync or async).

## `params` — path template substitution

```ts
params?: Lazy<Record<string, string | number>>;
```

Substituted into path templates of the form `{name}`. Keys must match the template parameters; unresolved templates throw at runtime:

```
Missing path param "id" for GET /pet/{id}
```

Values are URL-encoded (via `encodeURIComponent`).

```ts
step("get pet", {
  endpoint: endpoints.getPetById, // path: "/pet/{id}"
  params: { id: petId }, // → /pet/42
});
```

Use the function form when `petId` is populated by a previous step's `after` hook:

```ts
params: () => ({ id: petId }),
```

## `query` — query string

```ts
query?: Lazy<Record<string, string | number | boolean | undefined>>;
```

Appended as `?k=v&…`. Each value is stringified via `String(v)`. **`undefined` values are dropped**, so you can spread conditional flags without branching:

```ts
step("search", {
  endpoint: endpoints.findPets,
  query: {
    status: "available",
    limit: 10,
    tag: includeTag ? "cat" : undefined, // dropped when undefined
  },
});
```

Booleans serialize as `"true"` / `"false"`. There's no array-form handling — if your API expects `?tags=a&tags=b`, build the string yourself or call the endpoint twice.

## `headers` — request headers

```ts
headers?: Lazy<Record<string, string>>;
```

Merged **on top of** `HttpContext.defaultHeaders`. Per-step keys win on collision.

```ts
step("create", {
  endpoint: endpoints.createPet,
  headers: () => ({
    Authorization: `Bearer ${token}`,
    "X-Request-Id": `${env("REQUEST_ID_PREFIX")}-create`,
  }),
  body: { name: "Mittens" },
});
```

### Automatic `Content-Type`

If the step has a `body` and no `Content-Type` is set (case-insensitive check), the runtime adds `Content-Type: application/json` for you. Override explicitly if you need a different content type:

```ts
step("upload", {
  endpoint: endpoints.uploadAvatar,
  headers: { "Content-Type": "application/octet-stream" },
  body: rawBytes,
});
```

## `body` — request body

```ts
body?: Lazy<unknown>;
```

Behavior depends on the runtime type:

| Value type            | What fetch sees                                                 |
| --------------------- | --------------------------------------------------------------- |
| `string`              | Sent as-is (`init.body = value`)                                |
| Anything else         | `JSON.stringify(value)` + auto `Content-Type: application/json` |
| `undefined` / omitted | No body sent                                                    |

```ts
step("create", {
  endpoint: endpoints.createPet,
  body: { name: "Mittens", status: "available" }, // JSON-stringified
});

step("raw upload", {
  endpoint: endpoints.uploadRaw,
  headers: { "Content-Type": "text/plain" },
  body: "hello world", // sent as-is
});
```

For binary payloads, pass a `Uint8Array` / `ArrayBuffer` and set the content type yourself — fetch handles them natively, and Journey will not JSON-encode a non-string value only if you're careful to coerce it. If you need a truly binary flow, use a descriptor endpoint and pass the raw value.

## Resolution order

At step execution time, the runtime resolves the four fields in parallel (awaiting promises):

1. `headers`, `query`, `body`, `params` → each awaited.
2. `buildRequest()` — substitutes path params, composes the URL, merges headers, auto-adds `Content-Type`.
3. `execute()` — calls `fetch()`.

Neither field sees the result of another; if you need to build one from another (e.g. a signature header computed from the body), compute it in the same closure:

```ts
step("signed request", {
  endpoint: endpoints.submit,
  body: () => {
    const payload = { id: cartId, ts: Date.now() };
    // Return a wrapper object; we'll look up the sig on the wrapper's toString.
    return payload;
  },
  headers: () => {
    const payload = JSON.stringify({ id: cartId, ts: Date.now() });
    return { "X-Signature": signHmac(payload) };
  },
});
```

In practice, either precompute values in a closure scope or use `after()` on an earlier step.
