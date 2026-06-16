---
description: Regenerate generated/ types for a journey project from its OpenAPI spec
argument-hint: "[project-path]"
---

Regenerate the OpenAPI-derived TypeScript artefacts for a Journey project. The user passed: `$ARGUMENTS` (default: `examples/petstore`).

## Steps

1. **Resolve the project path.** Use `$ARGUMENTS` if provided; otherwise default to `examples/petstore`. Confirm it contains `journey.config.json` and `openapi.yaml` — if not, stop and tell the user.
2. **Build the CLI** so the regen uses the current source:
   ```sh
   pnpm --filter @usejourney/cli build
   ```
3. **Run codegen**:
   ```sh
   node packages/cli/dist/index.js generate --project <project-path>
   ```
4. **Diff the output**:
   ```sh
   git diff -- <project-path>/generated/
   ```
5. **Report**:
   - If the diff is empty, say "generated/ is up-to-date — no changes" and stop.
   - If non-empty, summarise what changed (added/removed endpoints, model field changes) and ask whether to keep the diff or revert.

## Invariants — enforce these

- Codegen writes **only** under `<project>/generated/`. If `git diff` shows changes outside that path, that's a bug — stop and report it.
- Don't hand-edit `generated/endpoints.ts` or `generated/models.ts`. If the user wants different output, fix the spec or the codegen package.
- Don't delete or move `journey.config.json`, `journeys/`, or `environments/`.
