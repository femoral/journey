---
title: Fetch
description: Instrumented fetch from @usejourney/core — drop-in globalThis.fetch replacement that routes through the active run's logger.
sources:
  - packages/core/src/fetch.ts
  - packages/core/src/runtime.ts
---

# Fetch

A thin wrapper around `globalThis.fetch` that, when called from inside a step hook, routes through the active run's [`JourneyLogger`](./logging) so the call appears in the Debug Console, run history, and SSE event stream alongside the steps' own requests.

Outside a run (no active `runJourney`) it delegates to `globalThis.fetch` with no behaviour change.

## When to use it

Helper code that performs HTTP from inside a step's `before`-style work, `headers`/`body` closures, `assert`, or `after` hook — typically auth-token bootstrapping where several upstream services need to be called before the typed step can run. Plain `globalThis.fetch` works for the network call itself but is invisible to Journey's observability surfaces:

- The Debug Console only shows requests that ran through Journey's logger pipeline.
- Run records (`.journey/cache/runs/*.run.json`) only record requests made through that pipeline.
- The GUI's per-step request panel only fills from logger events.

Switching to `import { fetch } from "@usejourney/core"` makes those calls show up everywhere, attributed to the surrounding step.

## Signature

```ts
function fetch(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
): Promise<Response>;
```

The signature mirrors `globalThis.fetch` exactly. The return value is the **original** `Response`, not a copy — caller code can consume the body normally.

## Behaviour

```ts
import { fetch } from "@usejourney/core";
```

Inside any step hook:

1. Captures method + URL + headers + body (best-effort — request bodies are logged as JSON when they parse, as raw strings otherwise, and as `"<binary>"` for `FormData` / `Blob` / `ReadableStream` / `ArrayBuffer`).
2. Calls `logger.onRequest(req)`.
3. Delegates to `globalThis.fetch(input, init)`.
4. On rejection: calls `logger.onError(req, err, durationMs)` and re-throws.
5. On resolution: clones the response, reads the cloned body (JSON when `Content-Type` includes `json`, text otherwise), calls `logger.onResponse(req, res)`, and returns the **original** response.

If response cloning fails (streaming bodies, opaque responses, platforms that reject `.clone()`), the body field in the log becomes `"<unreadable>"` — the original response is still returned untouched so the caller's `.json()`/`.text()`/`.body` consumption is unaffected.

Outside a run context the function short-circuits to `globalThis.fetch(input, init)` with no logger interaction at all.

## Example

```ts
import { fetch, journey, step, env } from "@usejourney/core";

function registerAuthStep(setToken: (t: string) => void) {
  step("auth", {
    endpoint: { method: "GET", path: "/health" },
    async after() {
      const opaque = await fetch(env("PASSPORT_URL")).then((r) => r.text());
      const jwt = await fetch(env("TOKENINFO_URL"), {
        method: "POST",
        headers: { Authorization: `Bearer ${opaque}` },
      }).then((r) => r.json());
      setToken(jwt.access_token);
    },
  });
}

journey("authed flow", () => {
  let token = "";
  registerAuthStep((t) => (token = t));
  step("protected call", {
    endpoint: endpoints.protectedResource,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
});
```

The two `fetch()` calls inside `after()` show up in the Debug Console as nested requests under the `auth` step, alongside the step's own `GET /health` and the protected call that follows.

## Headers and secret masking

`fetch` does **not** mask headers itself — it passes them through to `onRequest` verbatim, the same as `http.execute`. Header masking (turning `authorization` / `cookie` / `x-api-key` etc. into `***`) is the responsibility of the logger implementation. `createConsoleLogger` masks by default; the SSE broadcaster used by `journey serve` passes raw headers (the GUI's request panel handles its own masking on display).

## Step attribution

The wrapper relies on the runtime's active-context state, which `runJourney` pushes for the duration of the step loop. Calls fired from inside an `after` hook are attributed to the step that owns the hook — the [SSE broadcaster](../../guide/cli/serve) tags them with the current `stepIdx`, so the GUI groups them under the right row in the Debug Console.

Calls fired from inside the journey body **before** the first step runs (top-level setup code) are still inside the run scope but no step has started yet; they're attributed to `stepIdx: -1`.

## Composition with `HttpContext`

`fetch` reads the same `HttpContext` that `runJourney` passes around — specifically `ctx.logger`. It does not consult `ctx.baseUrl`, `ctx.defaultHeaders`, `ctx.fetchImpl`, or `ctx.dispatcher`. Those affect the typed step pipeline only; the wrapped `fetch` is meant for cases where the helper is doing something outside the typed flow on purpose (different host, opaque token endpoint, multipart upload).

If you need the dispatcher / fetchImpl behaviour (e.g. `--insecure` TLS), call the typed step pipeline via a descriptor `step()` instead — that will route through `execute()` and pick up the ctx fields.
