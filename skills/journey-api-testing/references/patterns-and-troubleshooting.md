# Journey — reference: config, patterns, troubleshooting

Companion to `SKILL.md`. Read the relevant section when you need depth beyond the main file.

## Table of contents

1. `journey.config.json` — full field table
2. The `journey()` `options` argument — `tags` and `k6`
3. Patterns — worked journey shapes
4. Extended error catalogue
5. `export k6`, `export postman`, `serve`

---

## 1. `journey.config.json` — full field table

One file at the project root. Validated with Zod in **strict mode** — unknown fields are rejected
with `journey.config.json failed validation: - <field>: Unrecognized key(s) in object: "<field>"`.

| Field                   | Type           | Default          | Required | Purpose                                                                                                                                                                                                                         |
| ----------------------- | -------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | `string`       | —                | No       | Human-readable project name. Shown in the GUI top bar / some logs.                                                                                                                                                              |
| `spec`                  | `string`       | `"openapi.yaml"` | No       | Path to the OpenAPI spec, relative to the project root or absolute.                                                                                                                                                             |
| `generatedDir`          | `string`       | `"generated"`    | No       | Where `endpoints.ts` + `models.ts` are written by `journey generate`.                                                                                                                                                           |
| `journeysDir`           | `string`       | `"journeys"`     | No       | Where `.journey.ts` files live. Globbed by `journey run --all`.                                                                                                                                                                 |
| `environmentsDir`       | `string`       | `"environments"` | No       | Where environment JSON files live. Read by `--env <name>` and `journey env list`.                                                                                                                                               |
| `defaultEnvironment`    | `string`       | —                | No       | Env loaded when `--env` is omitted. If unset and no `--env`, `env()` throws at first call.                                                                                                                                      |
| `baseUrl`               | `string` (URL) | —                | No       | Fallback base URL for endpoint refs. When omitted, the runtime falls back to `env("BASE_URL")` from the active environment. Descriptor endpoints can still set their own `baseUrl` per step.                                    |
| `runHistoryKeepCount`   | `integer >= 0` | `20`             | No       | Max run records retained under `.journey/cache/runs/`. Older ones pruned after each run.                                                                                                                                        |
| `tlsRejectUnauthorized` | `boolean`      | `true`           | No       | Set to `false` to disable TLS certificate verification when `journey run` / `journey serve` fetch over HTTPS. Equivalent to passing `--insecure` on every run; prints one stderr warning per process. Don't ship `false` to CI. |

Rules: `baseUrl` must parse as a URL; `runHistoryKeepCount` is a non-negative integer; every string
field must be non-empty if present; relative paths are joined against the project directory.

`journey init` writes only `name`, `spec`, `generatedDir`, `journeysDir`, `environmentsDir`. Add
`baseUrl` (or set `BASE_URL` in an env file) before `journey run` works against a live server.

Programmatic access (for test harnesses): `import { loadConfig, resolveBaseUrl, resolveConfigPaths,
JourneyConfigSchema } from "@journey/core"`.

---

## 2. The `journey()` `options` argument

`journey()` accepts an optional middle argument: `journey(name, options, body)`. The options split
by **mode**, and the two sets are disjoint:

| Mode            | Options                                 | Return          | Auto-runs? |
| --------------- | --------------------------------------- | --------------- | ---------- |
| Entry (default) | `tags?`, `k6?`                          | `void`          | Yes        |
| Reusable        | `reusable: true`, `inputs?`, `outputs?` | `JourneyHandle` | No         |

### Entry options — `tags` / `k6`

```ts
journey("list available pets", { tags: ["smoke"], k6: { vus: 5, duration: "10s" } }, () => {
  step("findByStatus", {
    endpoint: endpoints.findPetsByStatus,
    query: () => ({ status: "available", limit: Number(env("PET_LIST_LIMIT")) }),
    assert(res) {
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    },
  });
});
```

- **`tags`** — string labels. `journey export k6 --tag smoke` filters to journeys carrying that tag.
- **`k6`** — baked into the emitted k6 script's `export const options`. Because that block is
  module-scoped in the generated script, **at most one journey per file may declare a `k6` block**.

### Reusable mode — `reusable: true`, `inputs` / `outputs`

`journey(name, { reusable: true, inputs, outputs }, (input) => { … })` returns a typed
`JourneyHandle` instead of registering for auto-run. Another journey calls it as a pipeline node
with `invokeJourney(handle, …)`. The body takes the validated input as its argument; it hands a
value back via `output(value)`. See §3 — _Reusable sub-journey_. `inputs` / `outputs` are
reusable-only; `tags` / `k6` are entry-only — the overloads reject the wrong combination at compile
time, and a reusable journey pushed into the entry registry fails fast at run start.

---

## 3. Patterns

### Auth-token capture (the most common pattern)

Extract once in `after`, read from `headers` closures everywhere after.

```ts
journey("authed flow", () => {
  let token = "";

  step("auth", {
    endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
    body: { username: env("USERNAME"), password: env("PASSWORD") },
    assert: (res) => expect(res.status).toBe(200),
    after(res) {
      token = (res.body as { token: string }).token;
    },
  });

  step("protected call", {
    endpoint: endpoints.getProfile,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert: (res) => expect(res.status).toBe(200),
  });
});
```

### Seed a fixture via descriptor, then run the typed flow

A descriptor endpoint hits a service outside your spec (a fixtures API, another host); capture an
id; continue with typed refs.

```ts
let accountId = "";

step("seed account", {
  endpoint: { method: "POST", path: "/fixtures/accounts", baseUrl: env("SEED_URL") },
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

### Conditional assertion gated by an env flag

```ts
step("check order", {
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

### Multi-service flow in one journey

`baseUrl` on a descriptor endpoint lets a single journey hit two hosts without faking a unified
spec — e.g. an IDP on one port and the API on another:

```ts
step("login via IDP", {
  endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
  body: { username: env("USERNAME"), password: env("PASSWORD") },
  after(res) {
    token = (res.body as { token: string }).token;
  },
});

step("create pet on the API", {
  endpoint: endpoints.createPet, // uses config baseUrl
  headers: () => ({ Authorization: `Bearer ${token}` }),
  body: { name: "Mittens", status: "available" },
});
```

### Per-run constants (run-once setup)

Plain TypeScript at the top of the `journey()` body — runs once when the journey executes, before
its steps. No special hook.

```ts
journey("place order", () => {
  const nonce = crypto.randomUUID();
  const runId = `${env("ENVIRONMENT")}-${Date.now()}`;
  let orderId = "";

  step("create", {
    endpoint: endpoints.createOrder,
    headers: { "Idempotency-Key": nonce, "X-Request-Id": `${runId}-order` },
    body: { sku: "A", qty: 1 },
    after(res) {
      orderId = (res.body as { id: string }).id;
    },
  });
});
```

### Async lazy values (prep that feeds the request)

There's no `before` hook. Prep that produces request inputs goes in a lazy `headers`/`body`/`query`/
`params` — the function may be `async`, the runtime awaits it.

```ts
step("signed request", {
  endpoint: endpoints.submit,
  body: { cartId, qty: 1 },
  headers: async () => ({ "X-Signature": await signPayload({ cartId, qty: 1 }) }),
});
```

Each lazy field gets its own closure — they don't see each other's results. If `headers` and `body`
share a base value, compute it in a closure variable both can read (or in a prior step's `after`).

### Reusable sub-journey (shared setup / common endpoints)

When the same call sequence is needed across many journey **files** — an auth bootstrap, seeding a
fixture before a flow, a teardown that hits a common cleanup endpoint — make it a **reusable
journey** and invoke it as a pipeline node. This is the recommended idiom for shared setup: it
replaces both the copy-pasted step and the older helper-injected-step trick. The example below is
auth (the most common case); the same shape covers any common-endpoint sequence — see the
common-endpoint note after it.

Define it once with `reusable: true` and a typed `inputs` / `outputs` schema (`z` is re-exported
from `@journey/core` — a Journey project carries no deps, so `import { z } from "zod"` would not
resolve). The body takes the validated `input`; it returns a value with `output(value)`.

```ts
// journeys/helpers/auth.ts
import { env, expect, journey, output, step, z } from "@journey/core";

export const acquireToken = journey(
  "auth.acquire-token",
  {
    reusable: true,
    inputs: z.object({ username: z.string().min(1), password: z.string().min(1) }),
    outputs: z.object({ token: z.string().min(1), expiresIn: z.number() }),
  },
  (input) => {
    step("login via IDP", {
      endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
      body: { username: input.username, password: input.password },
      assert: (res) => expect(res.status).toBe(200),
      after(res) {
        const body = res.body as { token: string; expiresIn: number };
        output({ token: body.token, expiresIn: body.expiresIn });
      },
    });
  },
);
```

`import` the handle and `invokeJourney(handle, opts)` it — a peer of `step()`, callable at the
start, middle, or end of the pipeline. `inputs` is typed against the schema; `after(out)` receives
the typed `output`.

```ts
import { env, invokeJourney, journey, step } from "@journey/core";
import { acquireToken } from "./helpers/auth.js";

journey("flow A", () => {
  let token = "";

  invokeJourney(acquireToken, {
    name: "authenticate", // timeline label; defaults to handle.name
    inputs: { username: env("USERNAME"), password: env("PASSWORD") },
    after: (out) => {
      token = out.token;
    },
  });

  step("do thing", {
    endpoint: endpoints.thing,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
});
```

**Common-endpoint sub-journeys — not just auth.** The same shape factors any shared call sequence.
A fixture a dozen journeys need (create a pet, capture its id) becomes a reusable journey invoked at
the **start**; a teardown that hits a common cleanup endpoint becomes one invoked at the **end**.
`invokeJourney` is a pipeline node — placeable anywhere a `step()` goes.

```ts
// journeys/helpers/fixtures.ts
export const seedPet = journey(
  "fixtures.seed-pet",
  {
    reusable: true,
    inputs: z.object({ name: z.string().min(1) }),
    outputs: z.object({ petId: z.number() }),
  },
  (input) => {
    step("create pet", {
      endpoint: endpoints.createPet,
      body: { name: input.name, status: "available" },
      assert: (res) => expect(res.status).toBe(201),
      after: (res) => output({ petId: res.body.id }),
    });
  },
);

// in a parent journey
let petId = 0;
invokeJourney(seedPet, {
  inputs: { name: "Biscuit" },
  after: (out) => {
    petId = out.petId;
  },
});
```

**Output cache.** A call is cached only when it supplies a `cacheKey`; the key + child journey name
identify the slot. Lifetime is set by the `--cache=off|run|process|disk` flag on `journey run` /
`journey serve` (default `process`). The catch is **staleness**: a cached token is replayed
verbatim and does not refresh — if it can outlive its own expiry, cap it with `cacheTtlMs` (below
the token TTL) or use `--cache=run`.

```ts
invokeJourney(acquireToken, {
  inputs: { username: env("USERNAME"), password: env("PASSWORD") },
  cacheKey: (i) => i.username,
  cacheTtlMs: 4 * 60_000, // refresh before a 5-minute token expires
  after: (out) => {
    token = out.token;
  },
});
```

A reusable journey may `invokeJourney(...)` another — nesting is capped at 8 levels. A failure
inside the child fails the sub-journey node (and the parent run) with a message naming the child
journey and the offending child step.

> **Migrating from helper-injected steps.** An older idiom factored a shared step into a function
> that called `step()` from inside the `journey()` body (the runtime collects every `step()` that
> fires during one body evaluation, regardless of call site). That still works, but a reusable
> sub-journey is typed, named, individually cacheable, and renames cleanly through the LSP — prefer
> it for anything shared across files.

### Observable HTTP from inside hooks

A hook sometimes makes ad-hoc HTTP calls that aren't worth a `step()` each — e.g. a chain of
upstream hops to mint a token. Plain `globalThis.fetch` works but bypasses Journey's logger — the
calls are invisible in the Debug Console, run history, and the GUI's per-step request panel. Import
`fetch` from `@journey/core` instead: same signature, same return value, but routes through the
active run's logger so each call shows up under the surrounding step.

```ts
import { fetch, journey, step, env } from "@journey/core";

journey("flow", () => {
  let token = "";

  step("bootstrap", {
    endpoint: { method: "GET", path: "/health" },
    async after() {
      // Three upstream hops, all observable in the Debug Console and run history.
      const opaque = await fetch(env("PASSPORT_URL")).then((r) => r.text());
      const jwt = await fetch(env("TOKENINFO_URL"), {
        method: "POST",
        headers: { Authorization: `Bearer ${opaque}` },
      }).then((r) => r.json());
      token = jwt.access_token;
    },
  });

  step("do thing", {
    endpoint: endpoints.thing,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
});
```

Called outside a run context (top-level scripts, module load), the wrapper short-circuits to
`globalThis.fetch` with no behaviour change — the same helper module is safe to reuse from ad-hoc
code. When each hop is meaningful enough to assert on, model it as a step in a reusable sub-journey
instead (see above) — those steps are observable natively.

### Two journeys in one file

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

Registered in order, run sequentially, independent results — a failure in one doesn't affect the other.

### Inline debug logging

Anything `console.log`-ed from inside a hook is captured by the runner — stderr in the CLI, the
Logs tab in the GUI. Useful for inspecting an unexpected payload; delete before shipping.

```ts
assert(res) {
  console.log(res.body);
  expect(res.status).toBe(201);
}
```

---

## 4. Extended error catalogue

| Message                                                                                                | Cause                                                                                         | Fix                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `step("foo") called outside a journey(...) body`                                                       | `step()` at module scope                                                                      | Move it inside `journey(name, () => { ... })`.                                                                                                                |
| `Missing path param "id" for GET /pet/{id}`                                                            | `params` missing the key / typo / value still `0`/`undefined` at execution                    | `params: () => ({ id: petId })` — lazy if it comes from a prior `after`; the key must match `{id}` exactly.                                                   |
| `env("X") called with no active environment. Pass --env <name> or set one via setActiveEnvironment().` | No `--env` and no `defaultEnvironment`                                                        | Pass `--env <name>` or set `defaultEnvironment`.                                                                                                              |
| `env: key "X" not found in environment "dev"`                                                          | Key absent from `environments/dev.json`                                                       | Add it. Remember env values are always strings — `Number(env("LIMIT"))` if you need a number.                                                                 |
| `Property 'getOldPet' does not exist on type '{ ... }'` (tsc)                                          | Spec drift — journey references a removed/renamed operation                                   | Re-copy the spec, `journey generate`, update the step. The key in `generated/endpoints.ts` is the `operationId`.                                              |
| `journey.config.json failed validation: - X: Unrecognized key(s) in object: "X"`                       | Unknown key — strict schema                                                                   | Remove it; only the fields in §1 are allowed.                                                                                                                 |
| `journey.config.json failed validation` (other)                                                        | `baseUrl` not a URL, `runHistoryKeepCount` negative/non-integer, empty string field           | Fix the offending value.                                                                                                                                      |
| `No journey files to run.`                                                                             | `journey run` with neither file args nor `--all`                                              | Pass paths or `--all`.                                                                                                                                        |
| `journey: ENOENT ... journey.config.json` (or "config not found")                                      | CLI run outside the project root                                                              | `cd` to the directory containing `journey.config.json`.                                                                                                       |
| `The operation was aborted.` after a `timeoutMs`                                                       | Step exceeded its timeout                                                                     | Raise `timeoutMs` or fix the slow endpoint. No retry knob — stage a retry as a separate step with a conditional assertion, or move load-style retrying to k6. |
| `expected <a> to be <b>` / `to equal <b>` / `to contain <x>`                                           | Response didn't match the assertion                                                           | Inspect with `--debug` or `console.log(res.body)`; fix the expectation or the API.                                                                            |
| `toContain is only supported on strings and arrays` / `toMatch is only supported on strings`           | Wrong matcher for the value type                                                              | Use `toBe`/`toEqual` for non-string/array values.                                                                                                             |
| `Authorization: "Bearer "` sent on every request                                                       | Forgot the arrow function — value captured at registration when `token` was `""`              | `headers: () => ({ Authorization: \`Bearer ${token}\` })`.                                                                                                    |
| Import error: `Cannot find module '../generated/endpoints'`                                            | Wrong relative path, or codegen never ran                                                     | Path is relative to the `.journey.ts` file; import with the `.js` extension (`../generated/endpoints.js`); run `journey generate` if `generated/` is empty.   |
| A non-string `body` was sent JSON-encoded when you wanted raw bytes                                    | Objects are auto-`JSON.stringify`-ed with `Content-Type: application/json`                    | Pass a `string` and set `Content-Type` yourself; for binary, use a descriptor endpoint and pass the raw value.                                                |
| Helper's upstream `fetch()` calls don't appear in the Debug Console / run history                      | Raw `globalThis.fetch` bypasses Journey's logger pipeline                                     | `import { fetch } from "@journey/core"` in the helper — drop-in replacement that routes through the active run's logger. See _Observable HTTP_ in §3.         |
| GUI step timeline rewrites itself mid-run when a helper injects an auth step                           | Stale GUI build pre-dates the `step:planned` SSE event                                        | Update to the GUI build that consumes `step:planned` (replaces the parsed idle list with the runner's resolved plan at run start).                            |
| `invokeJourney(...) called outside a journey(...) body`                                                | `invokeJourney()` at module scope                                                             | Move it inside `journey(name, () => { ... })` — it is a pipeline node, registered like `step()`.                                                              |
| `journey "X" declares an inputs/outputs schema but is registered as an entry`                          | A reusable journey is missing `reusable: true`, so it auto-runs instead of returning a handle | Add `reusable: true` to the options and invoke it via `invokeJourney(handle, ...)`, or drop the `inputs`/`outputs` schema.                                    |
| `sub-journey recursion depth exceeded (max 8); check for cycles`                                       | A reusable journey invokes itself, directly or through a cycle                                | Break the cycle; nesting is capped at 8 levels.                                                                                                               |
| `sub-journey "X" did not call output() before completing`                                              | The child has a non-optional `outputs` schema but no step called `output(value)`              | Call `output({...})` in a child step's `after`, or make the `outputs` schema optional / drop it.                                                              |

**Halting:** a failed step (assert throws / after throws / request errors / timeout) skips the rest
of _that_ journey; `JourneyResult.ok` becomes `false`. Other journeys in the same `run --all` are
independent and continue.

**Per-step execution order:** resolve lazy `headers`/`query`/`body`/`params` → build request (path
substitution, header merge, auto `Content-Type`) → `fetch` (with abort timer if `timeoutMs`) →
`assert(res)` → `after(res)`. Logger hooks fire around the fetch and at step end.

---

## 5. `export k6`, `export postman`, `serve`

- **`journey export k6 [file] [--tag <tag>] [--out <file>] [--out-dir <dir>]`** — transpiles a
  `.journey.ts` into a k6 load script. `assert()` becomes a k6 `check()`. A journey's `options.k6`
  block (`{ vus, duration, ... }`) is baked into the script's `export const options`; `--tag` filters
  which journeys are emitted. A sub-journey (`invokeJourney`) is inlined under a k6 `group()` named
  after the child; a `cacheKey`'d call is honored **in memory, per-VU** — a hit skips the child's
  requests, and `JOURNEY_CACHE=off` forces every iteration cold. Provided by `@journey/k6-adapter`.
- **`journey export postman [--out <file>] [--out-dir <dir>] [--bundle] [--thread-state]`** — serializes
  loaded journeys into a Postman Collection v2.1.0 JSON plus environment files. A sub-journey becomes a
  nested folder, with the call's inputs as folder-scoped variables; a `cacheKey`'d call skips its request
  via a collection-variable expiry (the window opens on the child's terminal request, so a multi-request
  child skips as a whole). `--bundle` aggregates every matching journey across all files into one
  collection (one folder per journey); the experimental `--thread-state` re-runs each closure inside
  Postman scripts against a `__journey_state` collection variable so sub-journey outputs and step-to-step
  state reach later requests. Provided by `@journey/postman-adapter`.
- **`journey serve [--project <dir>] [--port <n>]`** — runs the local HTTP backend (SSE-based) that
  the Journey desktop/web GUI talks to. The GUI adds things the CLI doesn't: a Spec diff page (spec
  drift without `tsc`), Run history browser, and "Run up to step N" on the Journeys page.
