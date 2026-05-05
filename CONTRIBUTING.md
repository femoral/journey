# Contributing

This file captures the operational tribal knowledge that isn't obvious from the code. For project structure, packages, and architectural invariants, see [`CLAUDE.md`](CLAUDE.md). For the product overview and a runnable example, see [`README.md`](README.md).

## Workflow

This is a small project with no separate reviewer. Ceremony is kept minimal:

- **One GitHub issue per task.** Open the issue first, with a clear scope. Group multi-issue initiatives under a milestone (`M0`…`M4` are project-phase milestones in `gh`; in-flight redesign tags like `M5x` / `M6x` live in commit subjects only).
- **Implement on `main`** (or a short-lived branch) and run local checks for the packages you touched: `pnpm -r typecheck && pnpm -r test`, then `pnpm -r build` if you changed package outputs.
- **One commit per closed issue.** Commit subject follows the conventional-commits style below; the body explains the _why_ and ends with `Closes #N` so the issue auto-closes when `main` is pushed.
- **Push `main`.** Default branch on the remote is `master`, but active development lives on `main` and that's where commits land. Don't rebase or reshuffle `master`.
- **Close the issue** (`gh issue close <n>`) — the `Closes` footer auto-closes it on push, but explicit is fine.
- **PRs only when asked.** Open a PR if a change warrants review (large architectural shift) or if you've been asked to. Otherwise issue-then-commit is the path.

The result: `git log` reads like a ledger of completed tickets, and `gh issue view N` shows the linked commit.

## Commit style

```
<type>(<scope>): <subject>

<body — what changed and why>

Closes #<n>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- **Types**: `feat`, `fix`, `chore`, `docs`, `refactor`.
- **Scopes**: `core`, `cli`, `codegen`, `gui`, `k6`, `dev`, `docs`.
- **Milestone prefix** (e.g. `M5b`, `M6g`) goes inside the subject when the commit is part of a tracked feature batch: `feat(gui): M6g import from cURL`.
- **Co-author footer** on Claude-authored commits — see the system prompt for the canonical line.
- **Labels in use**: `area:core`, `area:cli`, `area:codegen`, `area:gui`, `area:k6`, `type:feat`, `type:chore`, `bug`.

## Codegen — one-way

`@journey/codegen` writes only into `<project>/generated/`. It never touches `journeys/`, `environments/`, or `journey.config.json`. Don't hand-edit `generated/endpoints.ts` or `generated/models.ts`.

To regenerate the petstore example:

```sh
pnpm --filter @journey/cli build
node packages/cli/dist/index.js generate --project examples/petstore
```

Or use the `/regen` slash command. After a regen on an unchanged spec, `git diff examples/petstore/generated/` should be empty — that's the staleness check.

## Dev environment

Use `nix-shell` (preferred — see [`shell.nix`](shell.nix) for the full pin) or provide equivalents:

- Node 22 (`>=20` per `engines`)
- pnpm 9.12.0 (`packageManager` field is authoritative)
- Rust toolchain (Tauri 2)
- webkit2gtk 4.1 + GTK3 (Linux/WSLg)
- k6 (for `@journey/k6-adapter` integration testing)
- Playwright browsers (auto-pinned via `PLAYWRIGHT_BROWSERS_PATH` in the Nix shell)

**WSLg / HiDPI tuning** — Tauri's WebView doesn't read Windows DPI from WSLg. `shell.nix` sets `GDK_BACKEND=x11`, `GDK_SCALE=2`, `GDK_DPI_SCALE=1` by default (good for HiDPI). For 1080p, run `GDK_SCALE=1 pnpm dev:tauri` or override the env in your shell. Without the X11 backend, GTK ignores `GDK_SCALE` on Wayland and you get blurry text.

## Test prerequisites

- **Vitest** runs in every package via `pnpm -r test`. No external services needed.
- **Playwright e2e** (`pnpm --filter @journey/gui test:e2e`) needs a live stack: petstore mock + cli serve + gui vite. Easiest path is `pnpm dev:web` in another shell, then run the Playwright suite against it.
- **k6** is available in the dev shell; the adapter doesn't auto-run k6 in CI, so verify exports manually with `k6 run --vus=1 --iterations=1 <generated.k6.js>`.

## Docs maintenance

`docs/SOURCES.md` is auto-generated from doc-comments in `packages/*/src/` by `scripts/gen-doc-sources.ts`. CI gates it via `pnpm --filter @journey/docs sources:check`.

After changing public exports in any package, run:

```sh
pnpm --filter @journey/docs sources:gen
```

…and stage the resulting `docs/SOURCES.md` in the same commit. The `/verify` slash command includes `sources:check` so you'll catch drift locally before pushing.

For prose docs under `docs/guide/` and `docs/reference/`, update them when you change user-visible behavior (CLI flags, step options, config schema, GUI page features).

## When to update `CLAUDE.md`

`CLAUDE.md` is the first file a fresh Claude session reads. It went stale once (claimed "pre-implementation" long after we shipped five packages); the cheap fix is to treat it as part of the diff whenever:

- A package is added, removed, or renamed.
- A workspace member is added/removed (`pnpm-workspace.yaml`).
- A `pnpm` script you'd cite in CLAUDE.md changes (`build`, `test`, `dev:web`, etc.).
- A new top-level directory appears, or a load-bearing file path moves.
- An architectural invariant changes (e.g. how state flows between steps, codegen contract, runtime core surface).
- Commit conventions, labels, or the branch model change.

After a change that hits one of those triggers, run the `docs-sync` subagent (see `.claude/agents/docs-sync.md`) — it cross-checks CLAUDE.md against the live repo and reports drift with file:line references.
