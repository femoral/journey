# Journey — API Testing & Orchestration Tool

## Overview

Journey is a local-first, offline, open-source tool for scaffolding, organizing, and running API tests and multi-step journey flows. It eliminates duplication across Postman collections, acceptance test suites, and k6 load testing scripts by providing a single source of truth: a structured directory per API project, generated from an OpenAPI spec and version-controlled alongside your code.

No cloud. No login. No subscriptions. Your projects live on disk and in your VCS.

---

## Problem Statement

Teams maintain the same API flows in multiple places:
- Postman collections for dev/exploratory testing
- Orchestrated journey folders for acceptance testing
- k6 scripts for NFT/load testing

Each representation is different, duplicated, and drifts out of sync. When an endpoint changes, all three need to be updated manually.

---

## Core Concepts

### Project Directory
Each API has its own self-contained directory (a **Journey Project**). This directory is scaffolded from an OpenAPI spec and contains everything needed to run tests — no external state required.

```
my-api/
├── journey.config.json        # Project metadata, base URLs, environments
├── openapi.yaml               # Source OpenAPI spec (or a reference to it)
├── generated/
│   ├── endpoints.ts           # Auto-generated typed endpoint definitions
│   └── models.ts              # Auto-generated request/response models
├── journeys/
│   ├── create-payment.journey.ts   # Scriptable multi-step journey
│   └── auth-flow.journey.ts
├── environments/
│   ├── dev.json
│   └── staging.json
└── .journey/
    └── cache/                 # Local run history/cache (gitignored)
```

### Endpoint Definition
A generated, typed representation of a single API endpoint. Used as a building block inside journeys. Auto-regenerated when the OpenAPI spec changes.

### Journey
A `.journey.ts` file that defines a sequence of steps using a scriptable API. Journeys are plain TypeScript — no custom expression language, no JSON templating. Step inputs, assertions, and pre/post hooks are all native JS/TS, so you get full language expressiveness, IDE autocomplete, and type safety from your generated models.

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
- **Closure variables** for sharing state between steps — no custom `{{step.field}}` templating
- **`endpoint` accepts a reference or a descriptor.** References come from `generated/endpoints` and carry the response type, so `res` is fully inferred in `assert`/`after`. Descriptors (`{ method, path, baseUrl? }`) are an escape hatch for calling APIs outside the project's spec — e.g. seeding fixtures from another service. Descriptor responses are typed `unknown` unless the user annotates the callback parameter or passes a type argument to `step`.
- **Identity vs. transport.** `endpoint` answers *which operation*. Per-call transport overrides (`headers`, `timeout`, etc.) live at the step level, not inside the endpoint, so a ref's identity and response type can't be silently rewritten.
- **`headers` and `body` accept functions** so they're lazily evaluated at runtime (after prior steps have run)
- **`assert` callback** takes the typed response — use any assertion style or throw directly
- **`after` hook** for extraction/side effects after a step succeeds
- **`env(key)`** helper reads from the active environment file
- **Generated model types** from the OpenAPI spec flow into step callbacks for full autocomplete

### Environment
A JSON file defining variables (base URL, credentials, IDs) for a specific target environment. Environments are local and can be gitignored when they contain secrets.

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

### 1. CLI (`journey`)
The primary interface for CI/CD, terminal users, and scripting.

**Commands:**
```
journey init <dir> --spec openapi.yaml     # Scaffold a new project from an OpenAPI spec
journey generate                            # Regenerate endpoint/model files from spec
journey run <journey-file> [--env <name>]  # Run a specific journey
journey run --all [--env <name>]           # Run all journeys in the project
journey export k6 <journey-file>           # Export a journey as a k6 script
journey env list                           # List available environments
```

### 2. GUI App
A desktop application (Electron or Tauri) or local web app that provides:
- **Project browser** — open any Journey project directory
- **Endpoint explorer** — browse generated endpoints, send single requests (like Postman)
- **Journey editor** — build and edit journey flows visually
- **Journey runner** — execute journeys, see step-by-step results and extracted values
- **Environment manager** — create and switch environments locally
- **Response viewer** — diff responses, inspect headers, view raw/parsed bodies

The GUI reads and writes the same files the CLI uses. No proprietary format.

### 3. Generator (Codegen)
- Reads the OpenAPI spec (local file or URL)
- Outputs typed TypeScript definitions for endpoints and models into `generated/`
- Regeneration is non-destructive: only touches `generated/`, never `journeys/`
- Based on `openapi-typescript` or a lightweight custom generator

### 4. Journey Runtime (Core Library)
- Framework-agnostic TypeScript library
- Executes `.journey.ts` files by importing and running them (via `tsx` or `jiti` — no compile step needed)
- Provides the `journey()`, `step()`, and `env()` API that journey files import from
- Manages step sequencing, error handling, and result collection
- Executes HTTP requests using native `fetch` (Node.js 18+)
- Exposes a minimal `expect()` assertion helper (or delegates to any assertion library the user imports)
- Importable by both CLI and GUI, and adaptable for k6

### 5. k6 Adapter
- Takes a `.journey.ts` file and emits a valid k6 script
- Since journeys are already TypeScript, the adapter either transpiles them with k6-compatible shims or uses a static analysis pass to emit equivalent k6 `http.*` calls
- Maps `assert()` callbacks to k6 `check()`
- Allows load testing without rewriting flows from scratch

---

## MVP Scope

**Phase 1 — Core CLI & Runtime**
- [ ] `journey init` — scaffold from OpenAPI spec
- [ ] `journey generate` — regenerate types/endpoints
- [ ] Journey JSON schema definition (with Zod validation)
- [ ] Runtime: variable interpolation, HTTP execution, JSONPath extraction, assertions
- [ ] `journey run` — execute a single journey from CLI
- [ ] Basic environment file support

**Phase 2 — k6 Export**
- [ ] `journey export k6` — convert a journey to a runnable k6 script
- [ ] Map assertions to k6 `check()`

**Phase 3 — GUI App**
- [ ] Local project directory browser
- [ ] Single endpoint tester (like Postman request view)
- [ ] Journey runner with step-by-step output
- [ ] Basic journey editor (JSON or form-based)
- [ ] Environment manager

**Phase 4 — Polish**
- [ ] Journey editor with drag-and-drop step ordering
- [ ] Response diffing between runs
- [ ] Run history (local, gitignored)
- [ ] Watch mode for journeys on file change

---

## Design Principles

1. **Local-first** — everything on disk, works offline, no account required
2. **VCS-friendly** — all project files are plain JSON/YAML, diffable and committable
3. **Non-destructive codegen** — regeneration never touches hand-written files
4. **Single runtime, multiple surfaces** — CLI, GUI, and k6 adapter all share the same core
5. **Zero lock-in** — journeys are plain JSON, not tied to any vendor format

---

## Tech Stack (Proposed)

| Layer | Technology |
|---|---|
| CLI | Node.js + TypeScript, `commander` |
| Journey files | TypeScript (`.journey.ts`), executed via `tsx` |
| Runtime core | TypeScript, native `fetch`, `zod` |
| Codegen | `openapi-typescript` |
| GUI shell | Tauri (Rust + system webview) |
| GUI frontend | Solid.js + Tailwind |
| GUI components | Kobalte (accessible primitives) |
| k6 adapter | Constrained subset → transpiled `.js` output |
| Assertions | Built-in `expect()` in `@journey/core` |
| Monorepo | pnpm workspaces |
| Packaging | npm (CLI), Tauri platform installers (GUI) |

---

## Out of Scope (for now)

- Authentication management beyond environment variables
- GraphQL support
- Non-HTTP protocols