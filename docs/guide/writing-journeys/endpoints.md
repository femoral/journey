---
title: Endpoints — refs vs descriptors
description: Typed endpoint refs from the spec vs hand-written descriptors for services outside the spec.
sources:
  - packages/core/src/endpoint.ts
  - packages/core/src/http.ts
---

# Endpoints — refs vs descriptors

Every step has exactly one `endpoint`. Two shapes, depending on whether the operation is declared in the project's OpenAPI spec.

## `EndpointRef` — from the spec

Generated into `generated/endpoints.ts` by `journey generate`. Carries an `operationId` and a **type brand** for the response shape, so `res.body` is typed in `assert` and `after`.

```ts
step("fetch pet", {
  endpoint: endpoints.getPetById, // EndpointRef<Pet>
  params: { id: 1 },
  assert(res) {
    // res.body is typed as Pet — no `as` cast needed
    expect(res.status).toBe(200);
  },
});
```

The response type is erased at runtime — `endpoints.getPetById` is just `{ method: "GET", path: "/pet/{id}", operationId: "getPetById" }`. The `T` in `EndpointRef<T>` exists only for TypeScript.

## `EndpointDescriptor` — escape hatch

A plain `{ method, path, baseUrl? }` object. Use it for operations outside the project's spec — fixture seeding, auth exchanges against another service, calls to a different host. The response is typed `unknown`.

```ts
step("seed fixtures", {
  endpoint: {
    method: "POST",
    path: "/fixtures/accounts",
    baseUrl: env("SEED_API_URL"),
  },
  body: { currency: "GBP" },
  after(res) {
    const data = res.body as { id: string };
    accountId = data.id;
  },
});
```

When `endpoint.baseUrl` is omitted, the step falls back to `HttpContext.baseUrl` (which the CLI derives from `journey.config.json`'s `baseUrl`).

## Side-by-side

|                 | `EndpointRef`                           | `EndpointDescriptor`                      |
| --------------- | --------------------------------------- | ----------------------------------------- |
| Source          | Generated into `generated/endpoints.ts` | Hand-written `{ method, path, baseUrl? }` |
| Response typing | `HttpResponse<T>` from the spec         | `HttpResponse<unknown>` — cast needed     |
| Base URL        | Inherits from `HttpContext.baseUrl`     | `endpoint.baseUrl` falls back to context  |
| Use for         | Operations in your spec                 | Services outside the spec, seed endpoints |
| Regeneration    | Rewritten by `journey generate`         | Never touched                             |

## Type flow

`ResponseOf<E>` is how the response type gets into `assert` / `after`:

```ts
type ResponseOf<E> = E extends EndpointRef<infer R> ? R : unknown;

interface StepOptions<E extends Endpoint> {
  endpoint: E;
  assert?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
  after?: (res: HttpResponse<ResponseOf<E>>) => void | Promise<void>;
}
```

So `step("x", { endpoint: endpoints.getPetById, assert(res) { ... } })` gets `res.body: Pet` automatically.

## `HttpMethod`

Both shapes use the same method union:

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
```

## `isEndpointRef(e)`

```ts
function isEndpointRef(e: Endpoint): e is EndpointRef<unknown>;
```

Runtime guard — returns `true` when the endpoint has an `operationId`. Useful in custom tooling that walks journey steps (e.g. the k6 adapter).
