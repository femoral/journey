# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo. Keep this file lean and pointer-heavy — link to canonical sources rather than duplicating them.

## Project: Journey

Local-first, offline, open-source tool for scaffolding and running API tests / multi-step API flows from an OpenAPI spec. Replaces the Postman + acceptance suite + k6 triplication with one source of truth on disk.

Status: alpha (`0.0.0`). All five packages build and run; a Tauri 2 desktop GUI on Solid + Kobalte + Tailwind sits on top of a single shared runtime core. Active surface is the GUI redesign (commits tagged `M0`–`M6g`).

Product overview, runnable example, and architecture diagram live in [`README.md`](README.md). Workflow conventions live in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Repo map

| Path                 | What's there                                                                           |
| -------------------- | -------------------------------------------------------------------------------------- |
| `packages/`          | Five workspace packages (see below)                                                    |
| `examples/petstore/` | Working Journey project — OpenAPI, journeys, mock server, generated types              |
| `docs/`              | VitePress site (`guide/`, `reference/`, auto-generated `SOURCES.md`)                   |
| `design/`            | Design tokens (`system/README.md`) and prototype (`iterations/01-prototype/`)          |
| `scripts/`           | `gen-doc-sources.ts` — regenerates `docs/SOURCES.md` from package source               |
| `.github/workflows/` | `ci.yml` (typecheck/test/build), `docs.yml` (VitePress + sources check + Pages deploy) |
| `.claude/`           | Agent scaffolding: `commands/`, `agents/`, `settings.local.json`                       |
| `shell.nix`          | Reproducible dev shell — Node 22, pnpm 9.12, Rust, k6, webkit2gtk for Tauri            |

## Packages

| Package               | Role                                                                                                                | Sibling deps              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `@journey/core`       | Runtime — exports `journey()`, `step()`, `env()`, `expect()`, logger, history, http, runtime; depends only on `zod` | —                         |
| `@journey/codegen`    | OpenAPI → `generated/{models,endpoints}.ts` (wraps `openapi-typescript`)                                            | —                         |
| `@journey/cli`        | `commander`-based CLI: `init`, `generate`, `run`, `serve` (SSE), `export k6`, `env list`. Bin: `journey`            | core, codegen, k6-adapter |
| `@journey/gui`        | Tauri 2 + Solid + Kobalte + Tailwind. Ships as desktop app and as a Vite web build                                  | core                      |
| `@journey/k6-adapter` | Transpiles `.journey.ts` → k6 script; `assert()` → k6 `check()`                                                     | —                         |

`@journey/docs` is the VitePress site (workspace member, not a library).

## Common commands

```sh
pnpm -r typecheck                      # all packages
pnpm -r test                           # vitest in all packages (gui has --passWithNoTests)
pnpm -r build                          # tsup / vite build
pnpm format[:check]                    # prettier across the repo
pnpm dev:web                           # mock (5180) + cli serve (5181) + gui vite (5173)
pnpm dev:tauri                         # same as dev:web + cargo tauri dev
pnpm --filter @journey/gui test:e2e    # Playwright (needs a running petstore stack)
pnpm --filter @journey/docs sources:check  # CI gate — fails if SOURCES.md is stale
pnpm --filter @journey/docs sources:gen    # refresh SOURCES.md
```

Slash commands: `/dev` (start dev stack), `/regen` (run codegen on a project), `/verify` (typecheck + test + build + format + sources check). See `.claude/commands/`.

## Conventions

- **Commits**: `<type>(<scope>): <subject>` — `feat|fix|chore|docs|refactor`, scopes `core|cli|codegen|gui|k6|dev|docs`. Prefix milestone tag (`M5b`, `M6g`, …) when relevant; tags appear in commit subjects, not as gh milestones.
- **Workflow**: one gh issue per task → implement on `main` → typecheck/test/build the touched packages → one commit with `Closes #N` in the body → push `main` → close issue. Default branch on the remote is `master` but active development lives on `main`. Full details in [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Co-author footer** on Claude-authored commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Issue labels in use**: `area:core|cli|codegen|gui|k6`, `type:feat|chore`, `bug`.

## Invariants — do not violate

- **Journey files are plain TypeScript.** No `{{step.field}}` templating. State flows between steps via closure variables.
- **`headers` and `body` accept functions** so they evaluate after prior steps run. Static values are also fine.
- **`endpoint`** is either a generated reference (typed response) or a `{ method, path, baseUrl? }` descriptor (response is `unknown` unless annotated).
- **`assert(res)`** is the assertion hook — typed when `endpoint` is a reference. **`after(res)`** is the extraction/side-effect hook.
- **Codegen is one-way.** `pnpm journey generate` writes only under `generated/`; never touches `journeys/`. Don't hand-edit `generated/*.ts`.
- **One runtime core, multiple surfaces.** CLI, GUI, and k6 adapter all consume `@journey/core`. Don't fork run-loop logic per surface.
- **Local-first / zero lock-in.** No cloud, no login. Project files are diffable JSON / YAML / TS.

## Where to find what

- **Run loop and APIs** → `packages/core/src/{runtime,http,expect,env,logger,history}.ts`
- **CLI commands** → `packages/cli/src/commands/{init,generate,run,serve,exportK6,envList}.ts`
- **CLI dev server (SSE backend)** → `packages/cli/src/server/{server,runner,runBroadcaster,specDrift,consolePatch}.ts`
- **GUI pages** → `packages/gui/src/pages/{ProjectPage,EndpointsPage,JourneysPage,EnvironmentsPage,FilesPage,JourneyEditorPage,HistoryPage,DiffPage}.tsx`
- **GUI shell** → `packages/gui/src/shell/{Shell,TopBar,Sidebar,ConsoleDock,CommandPalette,ProjectSwitcher,ImportDialog}.tsx`
- **GUI run-event abstraction** → `packages/gui/src/api/runEvents.ts` (consumes the CLI SSE endpoint)
- **Codegen** → `packages/codegen/src/{parse,emit-endpoints,names,types}.ts`
- **k6 transpiler** → `packages/k6-adapter/src/`
- **Working example** → `examples/petstore/` (primary mock at `server.mjs` on 5180, IDP mock at `auth-server.mjs` on 5182, three envs `local|ci|staging` under `environments/`)
- **Docs (user-facing)** → `docs/guide/{getting-started,writing-journeys/*,cli/*,environments/*,gui/*}.md`, `docs/reference/{config,step-options,openapi-codegen,journey-api/*}.md`
- **Design tokens** → `design/system/README.md`

## Subagents

- **`journey-explorer`** — read-only architecture map. Delegate "where does X live?" / "how does Y flow?" questions instead of re-discovering on every chat. See `.claude/agents/journey-explorer.md`.
- **`docs-sync`** — audits `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, and `docs/SOURCES.md` against the current repo. Run after a change that matches a "When to update CLAUDE.md" trigger. See `.claude/agents/docs-sync.md`.

## When to update this file

Treat `CLAUDE.md` as part of the diff when you:

- Add or remove a package, top-level directory, or workspace member.
- Change a build / test / dev command surface (`pnpm` scripts, slash commands).
- Change an architectural invariant or the surface contract of `@journey/core`.
- Change commit conventions, branch model, or labels.
- Move a load-bearing file path that's cited above.

Drift on `CLAUDE.md` makes every fresh Claude session slower. The `docs-sync` agent helps catch it after the fact, but the cheap path is to update this file in the same commit as the change.

## Out of scope

Auth management beyond env vars, GraphQL, non-HTTP protocols. Don't add these without explicit direction.
