---
name: journey-api-testing
description: >-
  Scaffold, structure, write, run, and debug API end-to-end test projects built with Journey — the
  local-first `@journey/cli` / `@journey/core` tool that generates typed, multi-step API tests from
  an OpenAPI/Swagger spec. Use this whenever the user wants to: create a Journey project from an
  OpenAPI/Swagger spec (`journey init`), understand a Journey project's directory layout, write or
  edit `.journey.ts` files / multi-step API flows, run journeys with the `journey run` CLI,
  regenerate typed endpoints after a spec change (`journey generate`), or troubleshoot a failing
  journey or a `journey:` CLI error. Trigger even if the user only mentions a `.journey.ts` file,
  the `journey` CLI binary, `@journey/core`, the generated `endpoints.ts` / `models.ts` files, or
  "Journey" API testing — don't wait for them to name the tool explicitly.
---

# Journey: API end-to-end testing from an OpenAPI spec

Journey turns an OpenAPI 3.x spec into typed, runnable, multi-step API tests that live as plain
files in a repo — no cloud, no login, no templating DSL. Steps are TypeScript; state flows between
them through closure variables.

This skill covers the five things you'll do in a Journey project: **scaffold it**, **understand its
layout**, **write journeys**, **run them**, and **debug failures**. For depth on step options,
common patterns, and the full error catalogue, see `references/patterns-and-troubleshooting.md`.

## The mental model — read this first

Three facts explain almost everything:

1. **`journey()` registers; it doesn't execute.** The function body runs once at _import time_ to
   collect `step()` calls. The runner walks the registry afterward and executes each step. So
   top-level code in a journey body is setup that runs once per process, not per HTTP call.
2. **State flows through closures, not templating.** There is no `{{step.field}}` syntax. You
   declare `let token = ""` at the top of the `journey()` body, assign it in a step's `after(res)`
   hook, and read it from a _lazy function_ (`headers: () => ({ Authorization: \`Bearer ${token}\` })`)
   in a later step.
3. **Lazy = wrap in a function.** `params`, `query`, `headers`, `body` each accept either a literal
   or a `() => value` (sync or async). If the value depends on an earlier step, it **must** be a
   function — otherwise it's captured at registration time when the closure variable is still empty.
   The classic bug is `headers: { Authorization: \`Bearer ${token}\` }`producing`"Bearer "` on
   every request because the arrow function was forgotten.

## 1. Scaffold a project from an OpenAPI / Swagger spec

```sh
# install the CLI (binary name: `journey`) — needs Node 20+
pnpm add -D @journey/cli      # or: npm i -D @journey/cli   /   pnpm add -g @journey/cli

# scaffold
journey init my-api --spec ./openapi.yaml          # add --force to init into a non-empty dir
```

`journey init <dir> --spec <path>` does seven things:

1. **Validates the spec first** — exits non-zero with `Spec at <path> is missing "openapi"/"swagger" field` (and **nothing on disk**) if the file isn't a valid OpenAPI 3.x or Swagger 2.x document.
2. Creates `<dir>/` plus `generated/`, `journeys/`, `environments/`, `.journey/cache/`.
3. **Copies** the spec into `<dir>/<basename>` (it is not referenced by path — re-run `init` or
   overwrite the copy if the source spec moves).
4. Writes a minimal `journey.config.json`.
5. Writes `.gitignore` (ignores `.journey/cache/` and `node_modules/`).
6. Writes a minimal `package.json` (`"type": "module"`, `"private": true`) — **no dependencies, no install step**. The CLI bundles `@journey/core` and plants a `node_modules/@journey/core` symlink the first time a journey runs.
7. Runs code generation once → `generated/endpoints.ts` + `generated/models.ts`.

After init you'll see `Initialized Journey project at /abs/path (N operations).` — `journey run` works immediately, there is **no per-project `pnpm install` / `npm install`** (the CLI satisfies the `@journey/core` import via the symlink it plants on first run). If `N` is `0`, an extra warning prints — your `generated/endpoints.ts` is empty and you'll only be able to use descriptor endpoints. A `swagger.json` / `swagger.yaml` works the same way; "Swagger" and "OpenAPI" are the same input here as long as it's OpenAPI 3.x or Swagger 2.x.

### Make it runnable: set `baseUrl`

`init` writes only the essentials. Before `journey run` can hit a server you must add `baseUrl`
(or set `BASE_URL` in an environment file). Edit `journey.config.json`:

```json
{
  "name": "my-api",
  "spec": "openapi.yaml",
  "generatedDir": "generated",
  "journeysDir": "journeys",
  "environmentsDir": "environments",
  "baseUrl": "http://127.0.0.1:5180",
  "defaultEnvironment": "dev"
}
```

The config schema is **strict** — an unknown key fails with
`journey.config.json failed validation: - <key>: Unrecognized key(s) in object`. The full field
table is in `references/patterns-and-troubleshooting.md`.

### After the spec changes: `journey generate`

```sh
journey generate          # run from the project root (where journey.config.json lives)
```

Rewrites **only** `generated/endpoints.ts` and `generated/models.ts`. Never touches `journeys/`,
`environments/`, or `.journey/cache/` — running it on a project with in-progress journey files is
always safe. If a journey now references an operation that no longer exists, `tsc` flags it:
`Property 'getOldPet' does not exist on type '{ ... }'` — update or delete that step.

## 2. Directory structure

```
my-api/
├── journey.config.json      # project config — you edit this (strict schema, see reference)
├── openapi.yaml             # the spec, copied in by `journey init` — re-copy on changes, then `journey generate`
├── generated/
│   ├── endpoints.ts         # typed endpoint refs keyed by operationId — DO NOT hand-edit
│   └── models.ts            # typed request/response models from the spec — DO NOT hand-edit
├── journeys/                # *.journey.ts files — one file = one or more journeys; `run --all` globs this dir
├── environments/            # <name>.json files: per-env vars + secrets, read by --env <name>
├── .journey/
│   └── cache/runs/          # run records (<iso-timestamp>.run.json), gitignored, capped by runHistoryKeepCount
└── .gitignore
```

- **`generated/` is one-way output.** Codegen writes it; nothing else does. Don't edit it; don't
  expect `journey generate` to touch anything outside it.
- **`journeys/` is yours.** Files must end in `.journey.ts`. `journey run --all` globs
  `journeys/*.journey.ts` non-recursively, alphabetically.
- **`environments/<name>.json`** is a flat string→value map. Non-string values are stringified on
  load. `--env staging` loads `environments/staging.json`; `defaultEnvironment` in the config is
  the fallback. `journey env list` shows what's configured.
- Everything is diffable plain TS / JSON / YAML. Commit it. There is no cloud state.

## 3. Write a journey

A journey is a `.journey.ts` file in `journeys/`. Canonical shape:

```ts
import { journey, step, env, expect } from "@journey/core";
import { endpoints } from "../generated/endpoints.js"; // note the .js extension — it's an ESM import

journey("pet CRUD flow", () => {
  // closure variables = state that flows between steps. Declared here, written in `after`, read in lazy fns.
  let token = "";
  let petId = 0;

  step("login", {
    // a service outside the project's spec → descriptor endpoint. Response body is `unknown`.
    endpoint: { method: "POST", path: "/auth/login", baseUrl: env("AUTH_BASE_URL") },
    body: { username: env("USERNAME"), password: env("PASSWORD") }, // object → JSON + auto Content-Type
    assert(res) {
      expect(res.status).toBe(200);
      expect((res.body as { token: string }).token).toBeDefined();
    },
    after(res) {
      token = (res.body as { token: string }).token; // stash for later steps
    },
  });

  step("create pet", {
    endpoint: endpoints.createPet, // typed ref → res.body is typed, no cast
    headers: () => ({ Authorization: `Bearer ${token}` }), // lazy: token is empty until `login` runs
    body: { name: "Mittens", status: "available", tags: ["cat"] },
    assert(res) {
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Mittens");
    },
    after(res) {
      petId = res.body.id;
    },
  });

  step("fetch pet", {
    endpoint: endpoints.getPetById, // path: "/pet/{id}"
    params: () => ({ id: petId }), // lazy: petId set by previous `after`
    assert(res) {
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(petId);
    },
  });

  step("delete pet", {
    endpoint: endpoints.deletePet,
    params: () => ({ id: petId }),
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert: (res) => expect(res.status).toBe(204),
  });

  step("verify pet is gone", {
    endpoint: endpoints.getPetById,
    params: () => ({ id: petId }),
    assert: (res) => expect(res.status).toBe(404),
  });
});
```

### `step(name, options)` — the fields

| Field       | Type                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `endpoint`  | **required**                                                     | Either `endpoints.<operationId>` (typed `res.body`) or a `{ method, path, baseUrl? }` descriptor (`res.body` is `unknown`, cast it). Descriptor `baseUrl` falls back to the config `baseUrl` when omitted. `path: ""` resolves to the `baseUrl` verbatim (no forced trailing slash) — handy when the descriptor's `baseUrl` already names the exact path, e.g. an OAuth token endpoint. Use a descriptor for anything not in your spec — auth exchanges, fixture-seeding APIs, a different host. |
| `params`    | `Lazy<Record<string, string \| number>>`                         | Substituted into `{name}` path templates, URL-encoded. A missing key throws `Missing path param "id" for GET /pet/{id}`.                                                                                                                                                                                                                                                                                                                                                                         |
| `query`     | `Lazy<Record<string, string \| number \| boolean \| undefined>>` | Appended as `?k=v`. `undefined` values are dropped (handy for conditional flags). No array-form handling — build `?tags=a&tags=b` yourself or call twice.                                                                                                                                                                                                                                                                                                                                        |
| `headers`   | `Lazy<Record<string, string>>`                                   | Merged on top of defaults; per-step keys win. If a `body` is present and no `Content-Type` is set, `application/json` is added automatically.                                                                                                                                                                                                                                                                                                                                                    |
| `body`      | `Lazy<unknown>`                                                  | `string` → sent as-is. Anything else → `JSON.stringify` + auto `Content-Type: application/json`. `undefined`/omitted → no body.                                                                                                                                                                                                                                                                                                                                                                  |
| `timeoutMs` | `number`                                                         | Per-step abort timeout. No default (effectively "forever"). No retry knob — stage a retry as its own step, or move flaky load-style stuff to k6.                                                                                                                                                                                                                                                                                                                                                 |
| `assert`    | `(res) => void \| Promise<void>`                                 | Runs first. Throw → step fails, rest of the journey is skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `after`     | `(res) => void \| Promise<void>`                                 | Runs after `assert` succeeds. Stash state, log, fire side effects. Throw also fails the step.                                                                                                                                                                                                                                                                                                                                                                                                    |

`res` is `{ status: number; headers: Record<string,string>; body: T }`. Header keys are lowercased.
Body is `res.json()` when the response `Content-Type` includes `json` (falls back to `null` on
parse failure), otherwise `res.text()`.

### `expect()` — the built-in matcher

`toBe(x)` (identity), `toEqual(x)` (deep equality), `toBeDefined()` (anything `!== undefined`),
`toContain(x)` (string `.includes` or array element deep-equal), `toMatch(re)` (string `RegExp`
test; a string arg is wrapped in `new RegExp`), `toBeGreaterThan(n)` / `toBeGreaterThanOrEqual(n)`
/ `toBeLessThan(n)` / `toBeLessThanOrEqual(n)` (numbers only — non-number values throw a clear
`(got <typeof>)` message), `toHaveLength(n)` (strings, arrays, anything with a numeric `length`).
Failures throw `AssertionError` with messages like `expected "pending" to be "available"`. Anything
that throws fails the step — you can use `node:assert`, `chai`, `vitest`, or `throw new Error(...)`
instead; the only contract is "throw on failure".

### `env(key)` — read the active environment

Returns a `string`, always. Throws **at step-execution time** (not registration) so a bad key
fails one step cleanly: `env("X") called with no active environment` (pass `--env <name>`) or
`env: key "X" not found in environment "dev"` (add it to `environments/dev.json`). Safe to call as
a static value (`body: { username: env("USERNAME") }`) — the env is set before any step runs.

### Designing e2e scenarios

- **One journey = one user-meaningful flow** (sign up → create resource → read it back → delete it).
  Keep ordering meaningful; later steps depend on earlier ones via closures.
- **Auth once, reuse everywhere**: extract the token in the auth step's `after`, read it from
  `headers: () => ({ Authorization: \`Bearer ${token}\` })` in every protected step.
- **Shared setup → reusable sub-journey, not a copied step.** When the same call sequence is needed
  across many journey **files** — an auth bootstrap, seeding a fixture, a teardown that hits a
  common endpoint — make it a reusable **sub-journey**
  (`journey(name, { reusable: true, inputs, outputs }, body)`) and `invokeJourney(handle, …)` it as
  a pipeline node. One typed, named, LSP-renameable unit instead of a step copy-pasted into every
  file (which drifts). **Anti-pattern:** copy-pasting a `login` / `seed` step across files. See the
  patterns reference — _Reusable sub-journey_.
- **Negative paths are journeys too**: a step that asserts `res.status` is `400`/`404`/`409` is
  perfectly normal — assert the failure you expect.
- **Multiple journeys per file** is fine — `journey()` called N times registers N journeys, run in
  order; a failure in one doesn't affect the others.
- **Seed fixtures with a descriptor step** against your fixtures API, capture the id, then continue
  with typed refs. See the patterns reference.
- **Run-once setup** (a nonce, a timestamp, a base computed from env) goes at the top of the
  `journey()` body — plain TS, no special hook. There is no per-step `before` hook: prep that feeds
  the request goes in a lazy `headers`/`body` (can be `async`), prep that depends on a prior
  response goes in that prior step's `after`.

More worked patterns — auth capture, external seeding, conditional assertions, multi-service flows,
reusable sub-journeys (`invokeJourney` + `output`, the output cache), `journey()` `options` with
`tags` / `k6` — are in `references/patterns-and-troubleshooting.md`.

## 4. Run journeys with the CLI

Run from the project root (where `journey.config.json` lives).

```sh
journey run journeys/hello.journey.ts --env dev   # one file
journey run --all --env dev                        # every journeys/*.journey.ts, alphabetical
journey run --all --env dev --watch                # rerun on .ts/.json changes (local iteration only — not CI)
journey run --all --env dev --debug                # log every request/response to stderr (or: DEBUG=journey journey run --all)
journey run --all --env dev --insecure             # disable TLS verification (corporate CA / self-signed)
```

Flags: `[files...]` (explicit paths, must end in `.journey.ts`, resolve against cwd) **or** `--all`
— with neither you get `No journey files to run.`. `--env <name>` loads `environments/<name>.json`;
without it, `defaultEnvironment` from the config is used; with no active env at all, any `env()`
call throws. `--debug` / `DEBUG=journey` enables one-line request/response logging on stderr (secret
headers like `Authorization` are masked). `--watch` clears the terminal and reruns on file changes,
debounced 300 ms, until Ctrl-C. `--insecure` (or `tlsRejectUnauthorized: false` in
`journey.config.json`) disables TLS certificate verification for the current process and prints one
stderr warning — use it for self-signed or corporate-CA HTTPS endpoints; don't ship that toggle to
CI.

**Output:**

```
✓ pet CRUD flow (219ms)
  ✓ login POST http://127.0.0.1:5180/auth/login → 200 (35ms)
  ✓ create pet POST http://127.0.0.1:5180/pet → 201 (28ms)
  ✗ delete pet DELETE http://127.0.0.1:5180/pet/1 → (14ms)
      expected 204 to be 200

0 passed, 1 failed
```

**Exit codes:** `0` if every step in every journey passed, `1` if any step failed or config/env
failed to load. Drop `journey run --all` straight into CI. (`--watch` always exits `0` — don't use
it in CI.)

**Run records:** every invocation writes `.journey/cache/runs/<iso-timestamp>.run.json` (colons →
hyphens) with every step's status, request, response/error, and duration; older records past
`runHistoryKeepCount` (default 20) are pruned. The GUI's Run history page reads these.

Other commands: `journey env list` (list configured environments), `journey serve` (runs the HTTP
backend the desktop/web GUI talks to — SSE-based; pass `--project <dir>`), `journey export k6`
(transpile a journey into a k6 load script), `journey export postman` (serialize journeys into a
Postman collection + environment files). The CLI prints every error as `journey: <message>` on
stderr.

## 5. Verify journeys and troubleshoot

**Workflow when something fails:**

1. **Re-run with `--debug`** (or `DEBUG=journey`) to see the actual request and response on stderr —
   this resolves most "why did this step fail" questions immediately.
2. **Read the failure line** — `✗ <step> <METHOD> <url> → <status>` followed by the thrown message
   (`expected X to be Y` for assertion failures).
3. **`console.log(res.body)` inside the failing `assert`/`after`** to inspect an unexpected payload —
   it's captured by the runner and written to stderr (and the GUI Logs tab).
4. **Check the run record** at `.journey/cache/runs/<latest>.run.json` for the full structured trace
   if the terminal output scrolled away.
5. **For "run only up to step N"** (reproduce up to a failing step), use the GUI's "Run up to step N"
   control — the CLI always runs journeys end-to-end.

**Common errors → cause → fix** (full catalogue with more cases in the reference file):

| Message                                                                     | Cause                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `step("foo") called outside a journey(...) body`                            | `step()` at module scope                                                                                                                                                                                                           | Move it inside the `journey(name, () => { ... })` callback.                                                                                                                                                                                         |
| `Missing path param "id" for GET /pet/{id}`                                 | `params` missing the key, or typo, or `petId` still `0`/`undefined`                                                                                                                                                                | Provide `params: () => ({ id: petId })` (lazy if it comes from a prior `after`); check the key name matches `{id}`.                                                                                                                                 |
| `Authorization: "Bearer "` on every request                                 | Forgot the arrow function — value captured at registration                                                                                                                                                                         | `headers: () => ({ Authorization: \`Bearer ${token}\` })`, not `headers: { ... }`.                                                                                                                                                                  |
| `env("X") called with no active environment`                                | No `--env` and no `defaultEnvironment`                                                                                                                                                                                             | Pass `--env <name>` or set `defaultEnvironment` in `journey.config.json`.                                                                                                                                                                           |
| `env: key "X" not found in environment "dev"`                               | Key absent from `environments/dev.json`                                                                                                                                                                                            | Add it to the env file.                                                                                                                                                                                                                             |
| `Property 'getOldPet' does not exist on type '{ ... }'` (tsc)               | Spec drift — journey references a removed/renamed operation                                                                                                                                                                        | Re-copy the spec, `journey generate`, then update the step (the new `operationId` is the key in `generated/endpoints.ts`).                                                                                                                          |
| `journey.config.json failed validation: - X: Unrecognized key(s) in object` | Unknown key — strict schema                                                                                                                                                                                                        | Remove it (see the field table in the reference).                                                                                                                                                                                                   |
| `No journey files to run.`                                                  | `journey run` with neither files nor `--all`                                                                                                                                                                                       | Pass file paths or `--all`.                                                                                                                                                                                                                         |
| `journey: ... ENOENT ... journey.config.json`                               | Ran the CLI outside the project root                                                                                                                                                                                               | `cd` to the directory containing `journey.config.json`.                                                                                                                                                                                             |
| `The operation was aborted.` after `timeoutMs`                              | Step exceeded its `timeoutMs`                                                                                                                                                                                                      | Raise `timeoutMs`, or fix the slow endpoint; remember there's no retry — stage one as a separate step if needed.                                                                                                                                    |
| Assertion failure: `expected <a> to be <b>` / `to equal` / `to contain`     | The response didn't match                                                                                                                                                                                                          | Inspect with `--debug` / `console.log(res.body)`; fix the expectation or the API.                                                                                                                                                                   |
| A step's body arrives empty / wrong content type                            | Passed a non-string but expected raw, or vice versa                                                                                                                                                                                | Objects are JSON-stringified with `Content-Type: application/json` auto-set; pass a `string` (and set `Content-Type` yourself) for raw bodies.                                                                                                      |
| `fetch failed ← <real reason> (CODE)`                                       | The runner unwraps `err.cause` and joins links with `←` so the actual reason surfaces. Common codes: `ECONNREFUSED` (nothing listening), `ENOTFOUND` (DNS), `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (Node doesn't trust the cert chain). | Fix the underlying issue. For corporate-CA/self-signed HTTPS, pass `--insecure` to `journey run` (or set `tlsRejectUnauthorized: false` in `journey.config.json`) — verification is then off for the current process only, with one stderr warning. |

**Halting behaviour:** when a step fails, the rest of _that_ journey is skipped and its result is
`ok: false`. Other journeys in the same `run --all` are unaffected — each runs independently.

## Where to go deeper

`references/patterns-and-troubleshooting.md` — full `journey.config.json` field table; the
`journey()` `options` arg (`tags`, `k6`, reusable mode); worked patterns (auth capture, external
fixture seeding, conditional assertions, multi-service flows, reusable sub-journeys, two journeys
per file); the extended error catalogue; and notes on `export k6` / `export postman` / `serve`.
