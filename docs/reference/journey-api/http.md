---
title: HTTP
description: HttpContext, HttpResponse, buildRequest, execute, resolveUrl.
sources:
  - packages/core/src/http.ts
  - packages/core/src/body.ts
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
  baseDir?: string;
}
```

- `baseUrl` — applied when an endpoint doesn't carry its own (descriptor endpoints can).
- `defaultHeaders` — merged **under** per-step `headers`; step values win on collision.
- `fetchImpl` — injectable `fetch`. Defaults to global. Tests override this.
- `logger` — optional `JourneyLogger` for lifecycle events. See [Logging](./logging).
- `baseDir` — directory relative `fileFrom()` paths resolve against. The CLI sets it to the project root; defaults to `process.cwd()`.

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

Substitutes path params, composes the query string, merges headers, and auto-adds a `Content-Type` when a body is present without one: `application/json` for strings/objects, the file's type for `fileFrom()`, `application/octet-stream` for raw bytes. For `multipart()` bodies any caller `Content-Type` is removed (`execute` sets one with the boundary).

## `execute(req, ctx)`

```ts
function execute(req: RequestSpec, ctx: HttpContext): Promise<HttpResponse>;
```

Sends a built request. Respects `timeoutMs` via `AbortController`. Emits `onRequest` / `onResponse` / `onError` on `ctx.logger`.

Bodies go through `fetch` as:

| Input `req.body`                      | Sent as                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `string`                              | The string, unchanged.                                                        |
| `multipart({ … })`                    | `multipart/form-data` bytes + `Content-Type: multipart/form-data; boundary=…` |
| `fileFrom(path)`                      | The file's bytes (read from `ctx.baseDir`).                                   |
| `Uint8Array` / `ArrayBuffer` / `Blob` | The bytes.                                                                    |
| anything else                         | `JSON.stringify(value)`.                                                      |
| `undefined`                           | No body.                                                                      |

## `fileFrom(path, contentType?, filename?)` / `multipart(parts)`

```ts
function fileFrom(path: string, contentType?: string, filename?: string): FileRef;
function multipart(parts: Record<string, string | number | boolean | FileRef>): MultipartBody;
function isFileRef(value: unknown): value is FileRef;
function isMultipartBody(value: unknown): value is MultipartBody;
```

Body builders for uploads. `fileFrom` is a lazy file reference — relative paths resolve against `HttpContext.baseDir` (the project root under the CLI) when `execute` sends the request; an unreadable file fails the request with the resolved path. `multipart` turns text values and `fileFrom` refs into a `multipart/form-data` body. Both are also implemented by the k6 export. See [File uploads](../../guide/writing-journeys/request-inputs#file-uploads-multipart-and-filefrom).

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
import { buildRequest, execute, type HttpContext } from "@usejourney/core";

const ctx: HttpContext = { baseUrl: "https://api.example.com" };
const req = buildRequest({ endpoint, params: { id: 1 }, body: { name: "x" } }, ctx);
const res = await execute(req, ctx);
```

In practice, `runJourney` / `runAllRegistered` wrap this for you.
