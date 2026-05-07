# Journey — API Testing & Orchestration Tool

Journey is a local-first, offline, open-source tool for scaffolding, organizing, and running API tests and multi-step API flows from an OpenAPI spec. A single Journey project replaces Postman collections, acceptance test suites, and k6 load scripts — one source of truth on disk, version-controlled alongside your code.

No cloud. No login. No subscriptions.

---

## Project layout

Each API has its own self-contained **Journey Project** directory:

```
my-api/
├── journey.config.json        # Project metadata, base URLs, environments
├── openapi.yaml               # Source OpenAPI spec (or a reference to it)
├── generated/
│   ├── endpoints.ts           # Auto-generated typed endpoint definitions
│   └── models.ts              # Auto-generated request/response models
├── journeys/
│   ├── create-payment.journey.ts
│   └── auth-flow.journey.ts
├── environments/
│   ├── local.json
│   ├── ci.json
│   └── staging.json
└── .journey/
    └── cache/                 # Local run history (gitignored)
```

---

## Writing journeys

Journeys are plain TypeScript — no custom expression language, no JSON templating. Step inputs, assertions, and hooks are native TS, giving you full IDE autocomplete and type safety from your generated models.

```ts
import { journey, step, env } from "@journey/core";
import { endpoints } from "../generated/endpoints";
import type { SeedRecord } from "../generated/models";

journey("Create Payment Flow", () => {
  // Shared state across steps — plain closure variables
  let token: string;
  let currency: string;
  let seedId: string;

  step("auth", {
    endpoint: endpoints.postAuthToken,
    body: {
      username: env("USER"),
      password: env("PASS"),
    },
    after(res) {
      // res is typed as AuthTokenResponse from the endpoint ref
      token = res.access_token;
    },
  });

  step("seed external data", {
    // Descriptor form — calls an API outside this project's spec.
    // Response is `unknown` unless a type parameter is supplied.
    endpoint: {
      method: "POST",
      path: "/fixtures/accounts",
      baseUrl: env("SEED_API_URL"),
    },
    body: { currency: "GBP" },
    after(res: SeedRecord) {
      seedId = res.id;
    },
  });

  step("fetch account", {
    endpoint: endpoints.getAccountById,
    params: { id: seedId },
    headers: () => ({ Authorization: `Bearer ${token}` }),
    assert(res) {
      expect(res.status).toBe(200);
      expect(res.body.currency).toBeDefined();
    },
    after(res) {
      currency = res.body.currency;
    },
  });

  step("submit payment", {
    endpoint: endpoints.postPayments,
    headers: () => ({ Authorization: `Bearer ${token}` }),
    body: () => ({ currency, amount: 100 }),
    assert(res) {
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING");
    },
  });
});
```

Key design decisions:

- **Closure variables** for sharing state between steps — no `{{step.field}}` templating
- **`endpoint` accepts a reference or a descriptor.** References come from `generated/endpoints` and carry the response type, so `res` is fully inferred in `assert`/`after`. Descriptors (`{ method, path, baseUrl? }`) are an escape hatch for APIs outside the project's spec.
- **`headers` and `body` accept functions** so they're lazily evaluated after prior steps have run
- **`assert(res)`** — typed response, use any assertion style or throw directly
- **`after(res)`** — extraction and side effects after a step succeeds
- **`env(key)`** — reads from the active environment file

---

## Architecture

```
OpenAPI Spec
     │
     ▼
┌─────────────┐
│  Generator  │  CLI/GUI → scaffold, regenerate
│  (codegen)  │  Reads openapi.yaml → writes generated/
└─────────────┘
     │
     ▼
┌─────────────────────────────────┐
│         Journey Runtime         │
│                                 │
│  - Resolves steps & variables   │
│  - Executes HTTP calls          │
│  - Applies extractions          │
│  - Runs assertions              │
└──────────┬──────────────────────┘
           │
    ┌──────┴────────┐
    │               │
    ▼               ▼
  CLI             GUI App        (both use the same runtime core)
    │
    ▼
 k6 Adapter      (exports journeys as k6-compatible scripts)
```

---

## Components

### CLI (`journey`)

```
journey init <dir> --spec openapi.yaml     # Scaffold a new project from an OpenAPI spec
journey generate                            # Regenerate endpoint/model files from spec
journey run <journey-file> [--env <name>]  # Run a specific journey
journey run --all [--env <name>]           # Run all journeys in the project
journey export k6 <journey-file>           # Export a journey as a k6 script
journey env list                           # List available environments
```

### GUI App

Tauri 2 desktop app (also runnable as a local web app via Vite). Reads and writes the same files as the CLI — no proprietary format.

- **Project browser** — open any Journey project directory
- **Endpoint explorer** — browse generated endpoints, send single requests
- **Journey runner** — execute journeys, see step-by-step results
- **Journey editor** — view and edit journey source
- **Environment manager** — create and switch environments locally
- **Run history** — browse past runs, diff responses between runs

### Generator (Codegen)

Reads the OpenAPI spec and outputs typed TypeScript definitions for endpoints and models into `generated/`. Regeneration is non-destructive — only touches `generated/`, never `journeys/`. Built on `openapi-typescript`.

### Journey Runtime (`@journey/core`)

Framework-agnostic TypeScript library shared by CLI, GUI, and k6 adapter. Executes `.journey.ts` files via `tsx`. Provides the `journey()`, `step()`, `env()`, and `expect()` API. HTTP via native `fetch` (Node 18+).

### k6 Adapter

Takes a `.journey.ts` file and emits a valid k6 script. Maps `assert()` callbacks to k6 `check()`. Enables load testing without rewriting flows from scratch.

---

## Design Principles

1. **Local-first** — everything on disk, works offline, no account required
2. **VCS-friendly** — project files are plain JSON/YAML/TS, diffable and committable
3. **Non-destructive codegen** — regeneration never touches hand-written files
4. **Single runtime, multiple surfaces** — CLI, GUI, and k6 adapter share the same core
5. **Zero lock-in** — journeys are plain TypeScript, not tied to any vendor format

---

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| CLI            | Node.js + TypeScript, `commander`              |
| Journey files  | TypeScript (`.journey.ts`), executed via `tsx` |
| Runtime core   | TypeScript, native `fetch`, `zod`              |
| Codegen        | `openapi-typescript`                           |
| GUI shell      | Tauri 2 (Rust + system webview)                |
| GUI frontend   | Solid.js + Tailwind                            |
| GUI components | Kobalte (accessible primitives)                |
| k6 adapter     | Constrained subset → transpiled `.js` output   |
| Assertions     | Built-in `expect()` in `@journey/core`         |
| Monorepo       | pnpm workspaces                                |
| Packaging      | npm (CLI), Tauri platform installers (GUI)     |

---

## Out of Scope

- Authentication management beyond environment variables
- GraphQL support
- Non-HTTP protocols
