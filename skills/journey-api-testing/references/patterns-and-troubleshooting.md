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

`journey()` accepts an optional middle argument: `journey(name, options, body)` where
`options = { tags?: string[]; k6?: K6JourneyOptions }`.

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

### Shared helper step across journeys

Factor a repeated step into a function; closures still work because the variable is in scope where
the helper is called. The helper invokes `step()` from inside the `journey()` body — the runtime
collects every `step()` call that fires during a single body evaluation, regardless of call site, so
a helper invocation is indistinguishable from a literal `step()` at the runtime level. The GUI's
step timeline pre-renders the resolved list via the runner's `step:planned` SSE event, so
helper-injected steps appear from the first frame instead of growing in place as `step:start`
events arrive.

```ts
function registerAuthStep(setToken: (t: string) => void) {
  step("auth", {
    endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
    body: { username: env("USERNAME"), password: env("PASSWORD") },
    after(res) {
      setToken((res.body as { token: string }).token);
    },
  });
}

journey("flow A", () => {
  let token = "";
  registerAuthStep((t) => (token = t));
  step("do thing", {
    endpoint: endpoints.thing,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
});
```

### Observable HTTP from inside hooks (auth-bootstrap pattern)

An auth helper often calls several upstream services from inside its step's `after` hook to mint a
token. Plain `globalThis.fetch` works but bypasses Journey's logger — the calls are invisible in the
Debug Console, run history, and the GUI's per-step request panel. Import `fetch` from
`@journey/core` instead: same signature, same return value, but routes through the active run's
logger so each call shows up under the surrounding step.

```ts
import { fetch, journey, step, env } from "@journey/core";

function registerAuthStep(setToken: (t: string) => void) {
  step("auth", {
    endpoint: { method: "GET", path: "/health" },
    async after() {
      // Three upstream hops, all observable in the Debug Console and run history.
      const opaque = await fetch(env("PASSPORT_URL")).then((r) => r.text());
      const jwt = await fetch(env("TOKENINFO_URL"), {
        method: "POST",
        headers: { Authorization: `Bearer ${opaque}` },
      }).then((r) => r.json());
      const customer = await fetch(env("CUSTOMER_KEY_URL"), {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt.access_token}` },
      }).then((r) => r.json());
      setToken(jwt.access_token);
    },
  });
}
```

Called outside a run context (top-level scripts, module load), the wrapper short-circuits to
`globalThis.fetch` with no behaviour change — same helper module is safe to reuse from ad-hoc code.

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

| Message                                                                                                | Cause                                                                               | Fix                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `step("foo") called outside a journey(...) body`                                                       | `step()` at module scope                                                            | Move it inside `journey(name, () => { ... })`.                                                                                                                 |
| `Missing path param "id" for GET /pet/{id}`                                                            | `params` missing the key / typo / value still `0`/`undefined` at execution          | `params: () => ({ id: petId })` — lazy if it comes from a prior `after`; the key must match `{id}` exactly.                                                    |
| `env("X") called with no active environment. Pass --env <name> or set one via setActiveEnvironment().` | No `--env` and no `defaultEnvironment`                                              | Pass `--env <name>` or set `defaultEnvironment`.                                                                                                               |
| `env: key "X" not found in environment "dev"`                                                          | Key absent from `environments/dev.json`                                             | Add it. Remember env values are always strings — `Number(env("LIMIT"))` if you need a number.                                                                  |
| `Property 'getOldPet' does not exist on type '{ ... }'` (tsc)                                          | Spec drift — journey references a removed/renamed operation                         | Re-copy the spec, `journey generate`, update the step. The key in `generated/endpoints.ts` is the `operationId`.                                               |
| `journey.config.json failed validation: - X: Unrecognized key(s) in object: "X"`                       | Unknown key — strict schema                                                         | Remove it; only the fields in §1 are allowed.                                                                                                                  |
| `journey.config.json failed validation` (other)                                                        | `baseUrl` not a URL, `runHistoryKeepCount` negative/non-integer, empty string field | Fix the offending value.                                                                                                                                       |
| `No journey files to run.`                                                                             | `journey run` with neither file args nor `--all`                                    | Pass paths or `--all`.                                                                                                                                         |
| `journey: ENOENT ... journey.config.json` (or "config not found")                                      | CLI run outside the project root                                                    | `cd` to the directory containing `journey.config.json`.                                                                                                        |
| `The operation was aborted.` after a `timeoutMs`                                                       | Step exceeded its timeout                                                           | Raise `timeoutMs` or fix the slow endpoint. No retry knob — stage a retry as a separate step with a conditional assertion, or move load-style retrying to k6.  |
| `expected <a> to be <b>` / `to equal <b>` / `to contain <x>`                                           | Response didn't match the assertion                                                 | Inspect with `--debug` or `console.log(res.body)`; fix the expectation or the API.                                                                             |
| `toContain is only supported on strings and arrays` / `toMatch is only supported on strings`           | Wrong matcher for the value type                                                    | Use `toBe`/`toEqual` for non-string/array values.                                                                                                              |
| `Authorization: "Bearer "` sent on every request                                                       | Forgot the arrow function — value captured at registration when `token` was `""`    | `headers: () => ({ Authorization: \`Bearer ${token}\` })`.                                                                                                     |
| Import error: `Cannot find module '../generated/endpoints'`                                            | Wrong relative path, or codegen never ran                                           | Path is relative to the `.journey.ts` file; import with the `.js` extension (`../generated/endpoints.js`); run `journey generate` if `generated/` is empty.    |
| A non-string `body` was sent JSON-encoded when you wanted raw bytes                                    | Objects are auto-`JSON.stringify`-ed with `Content-Type: application/json`          | Pass a `string` and set `Content-Type` yourself; for binary, use a descriptor endpoint and pass the raw value.                                                 |
| Helper's upstream `fetch()` calls don't appear in the Debug Console / run history                      | Raw `globalThis.fetch` bypasses Journey's logger pipeline                           | `import { fetch } from "@journey/core"` in the helper — drop-in replacement that routes through the active run's logger. See the auth-bootstrap pattern in §3. |
| GUI step timeline rewrites itself mid-run when a helper injects an auth step                           | Stale GUI build pre-dates the `step:planned` SSE event                              | Update to the GUI build that consumes `step:planned` (replaces the parsed idle list with the runner's resolved plan at run start).                             |

**Halting:** a failed step (assert throws / after throws / request errors / timeout) skips the rest
of _that_ journey; `JourneyResult.ok` becomes `false`. Other journeys in the same `run --all` are
independent and continue.

**Per-step execution order:** resolve lazy `headers`/`query`/`body`/`params` → build request (path
substitution, header merge, auto `Content-Type`) → `fetch` (with abort timer if `timeoutMs`) →
`assert(res)` → `after(res)`. Logger hooks fire around the fetch and at step end.

---

## 5. `export k6`, `export postman`, `serve`

- **`journey export k6 [file] [--tag <tag>] [-o <out>]`** — transpiles a `.journey.ts` into a k6
  load script. `assert()` becomes a k6 `check()`. A journey's `options.k6` block (`{ vus, duration, ... }`)
  is baked into the script's `export const options`; `--tag` filters which journeys are emitted.
  Provided by `@journey/k6-adapter`.
- **`journey export postman [-o <dir>]`** — serializes loaded journeys into a Postman Collection
  v2.1.0 JSON plus environment files. Provided by `@journey/postman-adapter`.
- **`journey serve [--project <dir>] [--port <n>]`** — runs the local HTTP backend (SSE-based) that
  the Journey desktop/web GUI talks to. The GUI adds things the CLI doesn't: a Spec diff page (spec
  drift without `tsc`), Run history browser, and "Run up to step N" on the Journeys page.
