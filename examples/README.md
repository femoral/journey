# Examples

Sample Journey projects checked in for local dev-testing. Each one is a
self-contained pnpm workspace member — `@journey/core` resolves through
`examples/<name>/node_modules/`.

## `petstore`

A toy pet-management API exercised offline against a tiny in-memory mock
backend. Covers every HTTP method (GET / POST / PUT / PATCH / DELETE),
path params, query params, request headers (auth + tracing), JSON request
bodies, and multi-step flows that pass state via closure variables.

### Run from the repo root

```bash
pnpm dev:web
```

This starts three processes via concurrently, killed together on Ctrl+C:

- **mock** — `node examples/petstore/server.mjs` on `:5180` (the API the
  journeys hit).
- **api** — `journey serve --project examples/petstore` on `:5181`
  (the GUI's backend).
- **gui** — `vite dev` on `:5173` (open this in a browser).

### What's in the spec

| Method | Path                | Notes                           |
| ------ | ------------------- | ------------------------------- |
| POST   | `/auth/login`       | Returns a bearer token          |
| GET    | `/pet/findByStatus` | `?status=…&limit=…`             |
| POST   | `/pet`              | Auth + body; `X-Request-Id` hdr |
| GET    | `/pet/{id}`         | Path param                      |
| PUT    | `/pet/{id}`         | Auth + full replace             |
| PATCH  | `/pet/{id}`         | Auth + partial update           |
| DELETE | `/pet/{id}`         | Auth                            |
| GET    | `/pet/{id}/notes`   | List notes                      |
| POST   | `/pet/{id}/notes`   | Auth + body                     |

Mock credentials live in `environments/dev.json` (`alice` / `wonderland`).
Override at runtime with `MOCK_USER=… MOCK_PASSWORD=…` when launching the
mock.

### Journeys

Each journey file is named for the Journey feature or edge case it exercises —
the sample project doubles as living coverage for the runtime.

- `multi-step-crud.journey.ts` — full pet lifecycle: authenticate via the
  reusable `acquireToken` sub-journey, then create a pet, fetch it, PATCH
  the status, PUT it whole, attach a note, list notes, delete the pet, and
  verify the GET 404s. Closure variables (`token`, `petId`) chain state
  between nodes.
- `env-assertion.journey.ts` — authenticates via the `acquireToken`
  sub-journey, then asserts the active environment is the one selected;
  calls two APIs in one flow.
- `k6-smoke-tag.journey.ts` — single GET with query params; tagged
  `smoke` and carries a `k6` block.
- `k6-load-stages.journey.ts` — journey-level `k6` load `stages`, tagged
  `load`.
- `sub-journey-at-start.journey.ts` — `invokeJourney` node as the first
  pipeline node (auth via the reusable `acquireToken` sub-journey).
- `sub-journey-mid-pipeline.journey.ts` — `invokeJourney` node between
  two HTTP steps.
- `sub-journey-nested.journey.ts` — two-level nesting: a reusable
  sub-journey that itself invokes another.
- `sub-journey-fixture-cleanup.journey.ts` — non-auth common-endpoint
  sub-journeys: `seedPet` and `removePet` (in `helpers/fixtures.ts`)
  bracket the test steps as setup and teardown nodes — the create/delete
  calls factored out of every file that needs a scratch pet.
- `sub-journey-failure.journey.ts` — a sub-journey that fails (bad
  credentials); failure propagates and halts the parent run. Expected
  to fail.
- `slow-run.journey.ts` — ten sequential GETs under simulated latency;
  long enough to exercise the Stop button mid-run.

### Pointing at your own project

`dev:web` is wired to `examples/petstore`. For your own project, run the
two halves manually:

```bash
pnpm --filter @journey/cli build
node packages/cli/dist/index.js serve --project /path/to/your/project
# in a separate terminal
pnpm --filter @journey/gui dev
```
