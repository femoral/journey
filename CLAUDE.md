# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repo. Keep this file lean and pointer-heavy — link to canonical sources rather than duplicating them.

## Project: Journey

Local-first, offline, open-source tool for scaffolding and running API tests / multi-step API flows from an OpenAPI spec. Replaces the Postman + acceptance suite + k6 triplication with one source of truth on disk.

Status: alpha (`0.0.0`). All six packages build and run; a Tauri 2 desktop GUI on Solid + Kobalte + Tailwind sits on top of a single shared runtime core. Active surface is the GUI redesign (commits tagged `M0`–`M6g`).

Product overview, runnable example, and architecture diagram live in [`README.md`](README.md). Workflow conventions live in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Repo map

| Path                 | What's there                                                                           |
| -------------------- | -------------------------------------------------------------------------------------- |
| `packages/`          | Six workspace packages (see below)                                                     |
| `examples/petstore/` | Working Journey project — OpenAPI, journeys, mock server, generated types              |
| `docs/`              | VitePress site (`guide/`, `reference/`, auto-generated `SOURCES.md`)                   |
| `design/`            | Design tokens (`system/README.md`) and prototype (`iterations/01-prototype/`)          |
| `scripts/`           | `gen-doc-sources.ts` — regenerates `docs/SOURCES.md` from package source               |
| `.github/workflows/` | `ci.yml` (typecheck/test/build), `docs.yml` (VitePress + sources check + Pages deploy) |
| `.claude/`           | Agent scaffolding: `commands/`, `agents/`, `settings.local.json`                       |
| `skills/`            | Vendored Claude skills (`journey-api-testing`) — installable into `~/.claude/skills/`  |
| `shell.nix`          | Reproducible dev shell — Node 22, pnpm 9.12, Rust, k6, webkit2gtk for Tauri            |

## Packages

| Package                       | Role                                                                                                                       | Sibling deps                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `@usejourney/core`            | Runtime — exports `journey()`, `step()`, `env()`, `expect()`, logger, history, http, runtime; depends only on `zod`        | —                                          |
| `@usejourney/codegen`         | OpenAPI → `generated/{models,endpoints}.ts` (wraps `openapi-typescript`)                                                   | —                                          |
| `@usejourney/cli`             | `commander`-based CLI: `init`, `generate`, `run`, `serve` (SSE), `export k6`, `export postman`, `env list`. Bin: `journey` | core, codegen, k6-adapter, postman-adapter |
| `@usejourney/gui`             | Tauri 2 + Solid + Kobalte + Tailwind. Ships as desktop app and as a Vite web build                                         | core                                       |
| `@usejourney/k6-adapter`      | Transpiles `.journey.ts` → k6 script; `assert()` → k6 `check()`                                                            | core (test only, devDep)                   |
| `@usejourney/postman-adapter` | Serializes loaded `JourneyDef`/`StepDef` → Postman Collection v2.1.0 JSON + environment files                              | core (types only, devDep)                  |

`@usejourney/docs` is the VitePress site (workspace member, not a library).

## Common commands

```sh
pnpm -r typecheck                      # all packages
pnpm -r test                           # vitest in all packages (gui has --passWithNoTests)
pnpm -r build                          # tsup / vite build
pnpm format[:check]                    # prettier across the repo
pnpm dev:web                           # mock (5180) + cli serve (5181) + gui vite (5173)
pnpm dev:tauri                         # same as dev:web + cargo tauri dev
pnpm dev:reset                         # rebuild examples/petstore.dev/ scratch from canonical petstore
pnpm --filter @usejourney/gui test:e2e    # Playwright (needs a running petstore stack)
pnpm --filter @usejourney/docs sources:check  # CI gate — fails if SOURCES.md is stale
pnpm --filter @usejourney/docs sources:gen    # refresh SOURCES.md
```

Slash commands: `/dev` (start dev stack), `/regen` (run codegen on a project), `/verify` (typecheck + test + build + format + sources check). See `.claude/commands/`.

## Conventions

- **Commits**: `<type>(<scope>): <subject>` — `feat|fix|chore|docs|refactor`, scopes `core|cli|codegen|gui|k6|postman|dev|docs`. Prefix milestone tag (`M5b`, `M6g`, …) when relevant; tags appear in commit subjects, not as gh milestones.
- **Workflow**: one gh issue per task → implement on `main` → typecheck/test/build the touched packages → `pnpm format` (prettier) → one commit with `Closes #N` in the body → push `main` → close issue. Default branch on the remote is `master` but active development lives on `main`. Full details in [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Run `pnpm format` before committing.** CI doesn't enforce formatting on its own, but uncommitted prettier drift accumulates across files and bloats unrelated diffs. Either format-then-stage your own changes, or stage explicitly so drift in untouched files doesn't ride along.
- **Co-author footer** on Claude-authored commits: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Issue labels in use**: `area:core|cli|codegen|gui|k6`, `type:feat|chore`, `bug`.

## Invariants — do not violate

- **Journey files are plain TypeScript.** No `{{step.field}}` templating. State flows between steps via closure variables.
- **`headers` and `body` accept functions** so they evaluate after prior steps run. Static values are also fine.
- **`endpoint`** is either a generated reference (typed response) or a `{ method, path, baseUrl? }` descriptor (response is `unknown` unless annotated).
- **`assert(res)`** is the assertion hook — typed when `endpoint` is a reference. **`after(res)`** is the extraction/side-effect hook.
- **`journey()` has two modes via the optional middle `options` arg.** Entry (default): `{ tags?, k6? }` — `tags` drives `journey export k6 --tag` filtering, `k6` is baked into the emitted script's `export const options` (module-scoped, so at most one journey per file may declare a `k6` block). Reusable (`{ reusable: true, inputs?, outputs? }`): returns a typed `JourneyHandle` instead of registering for auto-run. The two option sets are disjoint; a reusable journey pushed into the entry registry fails fast in `runAllRegistered`.
- **Sub-journeys are pipeline nodes.** `invokeJourney(handle, opts)` registers a call to a reusable journey as a peer of `step()` in the parent body. The child terminates with `output(value)`; the parent's `invokeJourney({ after, assert })` receives it. Nesting is capped at 8 levels. The output cache is opt-in **per call** via `cacheKey`; lifetime is process-wide policy set by the `--cache=off|run|process|disk` flag on `run`/`serve` (default `process`). Exporters translate the cache: k6 inlines child steps under `group()` and honors the cache in-memory per-VU (skips the child's requests on a hit; `JOURNEY_CACHE=off` disables); postman emits a nested folder and, for a `cacheKey`'d call, a folder pre-request that skips the request via a collection-variable expiry — the window opens on the sub's terminal request, so multi-request children skip as a whole. Postman `output(value)`/step state is carried only under the experimental `journey export postman --thread-state` flag, which re-runs each closure inside Postman scripts against a `__journey_state` collection variable (headers, path params, query and body reads; `after`/`output` writes; a cache hit restores the stored output so a skipped sub still delivers it). Under `--thread-state` assertions are **enforced by default**: each `expect()` in an `assert(res)`/`assert(out)` becomes its own `pm.test` (so a genuine failure reds the run and is counted), while a threading artifact — an unresolved closure free-variable that throws outside the matcher — is still swallowed (only `expect()` matchers enforce; a bare `throw` does not). `--lenient` restores the legacy non-enforcing skeleton (bare `pm.expect`, failures swallowed). A `--thread-state` collection also prepends a `Journey: reset state (auto)` folder (one skipped request) that clears the carrier + every cache slot at run start (Postman persists collection vars across Runner executions; Newman starts clean) so app re-runs match Newman; it's folder-wrapped because the Postman app won't render a root that mixes a bare request with folders. Neither exporter translates the `--cache` lifetime flag (k6 = per-VU, postman = per collection run).
- **Codegen is one-way.** `pnpm journey generate` writes only under `generated/`; never touches `journeys/`. Don't hand-edit `generated/*.ts`.
- **One runtime core, multiple surfaces.** CLI, GUI, and k6 adapter all consume `@usejourney/core`. Don't fork run-loop logic per surface.
- **Local-first / zero lock-in.** No cloud, no login. Project files are diffable JSON / YAML / TS.
- **A Journey project carries no dependencies.** Init writes only a minimal `package.json` (`type: "module"`) — no `@usejourney/core` dep, no install step. The runner plants a `node_modules/@usejourney/core` symlink to the CLI-bundled core on first run via `ensureProjectCoreLink` (`packages/cli/src/util/projectCoreLink.ts`). Don't re-introduce per-project deps or `pnpm install` prompts.
- **Helpers may inject `step()` from inside a `journey()` body.** The runtime collects every `step()` call that fires during a single body evaluation, and `runJourney` broadcasts the resolved list via `onPlanned` (`step:planned` over SSE) before iterating — surfaces (GUI, exporters, custom subscribers) see helper-injected steps from the first frame. Helpers performing HTTP from inside step hooks should `import { fetch } from "@usejourney/core"` instead of `globalThis.fetch` so their calls land on the active run's logger.

## Where to find what

- **Run loop and APIs** → `packages/core/src/{runtime,http,expect,env,logger,history,cache}.ts`
- **CLI commands** → `packages/cli/src/commands/{init,generate,run,serve,exportK6,exportPostman,envList}.ts`
- **CLI dev server (SSE backend)** → `packages/cli/src/server/{server,runner,runBroadcaster,specDrift,consolePatch}.ts`
- **GUI pages** → `packages/gui/src/pages/{ProjectPage,EndpointsPage,JourneysPage,EnvironmentsPage,FilesPage,JourneyEditorPage,HistoryPage,DiffPage}.tsx`
- **GUI shell** → `packages/gui/src/shell/{Shell,TopBar,Sidebar,ConsoleDock,CommandPalette,ProjectSwitcher,ImportDialog}.tsx`
- **GUI run-event abstraction** → `packages/gui/src/api/runEvents.ts` (consumes the CLI SSE endpoint)
- **Codegen** → `packages/codegen/src/{parse,emit-endpoints,names,types}.ts`
- **k6 transpiler** → `packages/k6-adapter/src/`
- **Postman serializer** → `packages/postman-adapter/src/`
- **Working example** → `examples/petstore/` (primary mock at `server.mjs` on 5180, IDP mock at `auth-server.mjs` on 5182, three envs `local|ci|staging` under `environments/`). `pnpm dev:web` / `dev:tauri` run from a gitignored scratch copy at `examples/petstore.dev/` (auto-created on first run, rebuild with `pnpm dev:reset`); edits to canonical `examples/petstore/` only take effect after a reset.
- **Docs (user-facing)** → `docs/guide/{getting-started,writing-journeys/*,cli/*,environments/*,gui/*}.md`, `docs/reference/{config,step-options,openapi-codegen,journey-api/*}.md`
- **Design tokens** → `design/system/README.md`

## Subagents

- **`journey-explorer`** — read-only architecture map. Delegate "where does X live?" / "how does Y flow?" questions instead of re-discovering on every chat. See `.claude/agents/journey-explorer.md`.
- **`docs-sync`** — audits `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, and `docs/SOURCES.md` against the current repo. Run after a change that matches a "When to update CLAUDE.md" trigger. See `.claude/agents/docs-sync.md`.

## When to update this file

Treat `CLAUDE.md` as part of the diff when you:

- Add or remove a package, top-level directory, or workspace member.
- Change a build / test / dev command surface (`pnpm` scripts, slash commands).
- Change an architectural invariant or the surface contract of `@usejourney/core`.
- Change commit conventions, branch model, or labels.
- Move a load-bearing file path that's cited above.
- Add or remove a vendored skill under `skills/`, or change the contract of one (e.g. CLI flags it documents, matchers it lists, error-catalogue entries).

Drift on `CLAUDE.md` makes every fresh Claude session slower. The `docs-sync` agent helps catch it after the fact, but the cheap path is to update this file in the same commit as the change.

## Out of scope

Auth management beyond env vars, GraphQL, non-HTTP protocols. Don't add these without explicit direction.
