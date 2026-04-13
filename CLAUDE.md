# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

This repo currently contains only a design document (`README.md`). No source code, build tooling, or package manifests exist yet — the project is pre-implementation. Treat `README.md` as the spec.

## Project: Journey

A local-first, offline, open-source tool for scaffolding and running API tests / multi-step API flows from an OpenAPI spec. Replaces the usual Postman + acceptance suite + k6 triplication with one source of truth living on disk in VCS.

## Intended Architecture

A single **runtime core** drives multiple surfaces — do not fork logic per surface.

- **Generator** reads `openapi.yaml` and writes typed definitions into `generated/` only. Regeneration must never touch hand-authored files under `journeys/`.
- **Runtime core** (`@journey/core`) exports the `journey()`, `step()`, `env()`, `expect()` API that `.journey.ts` files import. It executes journeys by importing them directly via `tsx`/`jiti` (no separate compile step), using native `fetch`.
- **CLI** (`journey`) and **GUI** (Tauri + Solid.js) are both thin shells over the runtime core.
- **k6 adapter** transpiles/analyses a `.journey.ts` into an equivalent k6 script; `assert()` maps to k6 `check()`.

A Journey Project on disk looks like: `journey.config.json`, `openapi.yaml`, `generated/`, `journeys/*.journey.ts`, `environments/*.json`, `.journey/cache/` (gitignored).

## Key Design Decisions (do not violate)

- **Journey files are plain TypeScript** — no custom templating language, no `{{step.field}}` syntax. State flows between steps via **closure variables**.
- `headers` and `body` in a step accept **functions** so they can be lazily evaluated after prior steps have run. Static values are also allowed.
- `after(res)` is the extraction/side-effect hook; `assert(res)` is the assertion hook and receives the typed response.
- **Generated model types** from the OpenAPI spec must flow into step callbacks so users get autocomplete.
- **Local-first / zero lock-in**: no cloud, no login, project files are diffable JSON/YAML/TS.
- Proposed stack: pnpm workspaces monorepo, `commander` for CLI, `zod` for validation, `openapi-typescript` for codegen, Tauri + Solid.js + Kobalte + Tailwind for GUI.

## Out of Scope

Auth management beyond env vars, GraphQL, non-HTTP protocols. Don't add these without explicit direction.
