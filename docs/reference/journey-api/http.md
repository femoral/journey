---
title: HTTP
description: HttpContext, HttpResponse, buildRequest, execute, resolveUrl.
sources:
  - packages/core/src/http.ts
---

# HTTP

The low-level request layer. Journey authors rarely need to touch these directly — the runtime calls them via `runJourney` — but they're exported for custom runners and tests.

## `HttpContext`

```ts
interface HttpContext {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  logger?: JourneyLogger;
}
```

- `baseUrl` — applied when an endpoint doesn't carry its own (descriptor endpoints can).
- `defaultHeaders` — merged **under** per-step `headers`; step values win on collision.
- `fetchImpl` — injectable `fetch`. Defaults to global. Tests override this.
- `logger` — optional `JourneyLogger` for lifecycle events. See [Logging](./logging).

## `HttpResponse<T>`

```ts
interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
}
```

Header keys are lowercased by `fetch` and copied as-is. Body parsing:

| `Content-Type` includes | Parsed as                                                  |
| ----------------------- | ---------------------------------------------------------- |
| `json`                  | `await res.json()` (falls back to `null` on parse failure) |
| anything else           | `await res.text()`                                         |

## `RequestSpec` / `BuildRequestOptions`

```ts
interface RequestSpec {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

interface BuildRequestOptions {
  endpoint: Endpoint;
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}
```

## `buildRequest(opts, ctx)`

```ts
function buildRequest(opts: BuildRequestOptions, ctx: HttpContext): RequestSpec;
```

Substitutes path params, composes the query string, merges headers, and auto-adds `Content-Type: application/json` when a body is present without an existing content type.

## `execute(req, ctx)`

```ts
function execute(req: RequestSpec, ctx: HttpContext): Promise<HttpResponse>;
```

Sends a built request. Respects `timeoutMs` via `AbortController`. Emits `onRequest` / `onResponse` / `onError` on `ctx.logger`.

Bodies go through `fetch` as:

| Input `req.body` | Sent as                  |
| ---------------- | ------------------------ |
| `string`         | The string, unchanged.   |
| anything else    | `JSON.stringify(value)`. |
| `undefined`      | No body.                 |

## `resolveUrl(endpoint, ctx, params, query)`

```ts
function resolveUrl(
  endpoint: Endpoint,
  ctx: HttpContext,
  params: Record<string, string | number> | undefined,
  query: Record<string, string | number | boolean | undefined> | undefined,
): string;
```

Standalone URL resolver — throws `No base URL configured` if neither the endpoint nor the context carries one, and `Missing path param "…"` if a template parameter is unresolved.

## Composition

Typical flow when embedding:

```ts
import { buildRequest, execute, type HttpContext } from "@journey/core";

const ctx: HttpContext = { baseUrl: "https://api.example.com" };
const req = buildRequest({ endpoint, params: { id: 1 }, body: { name: "x" } }, ctx);
const res = await execute(req, ctx);
```

In practice, `runJourney` / `runAllRegistered` wrap this for you.
