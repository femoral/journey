---
description: Run typecheck + test + build + format check + docs sources check
---

Run the full local verification suite for `journey`. This mirrors what CI runs and is the right thing to do before committing.

## Steps (run in order, stop on first failure)

1. `pnpm -r typecheck`
2. `pnpm -r test`
3. `pnpm -r build`
4. `pnpm format:check`
5. `pnpm --filter @journey/docs sources:check`

## How to report

- **All green**: one short line — "verify: typecheck + test + build + format + sources all clean". Don't dump command output.
- **Failure**: stop at the first failing step. Show the failing package and the relevant error excerpt (last ~30 lines max). Do **not** run subsequent steps. Suggest the targeted fix:
  - typecheck failure → point at the file:line.
  - test failure → name the failing test and file.
  - build failure → name the package and the build tool that broke (tsup / vite).
  - format failure → suggest `pnpm format`.
  - `sources:check` failure → suggest `pnpm --filter @journey/docs sources:gen` and stage the resulting `docs/SOURCES.md`.

## Notes

- This does **not** run Playwright e2e (`pnpm --filter @journey/gui test:e2e`) — that needs a live stack and is too slow for a pre-commit check. Run it explicitly when changing GUI flows.
- This does **not** start any dev servers — that's `/dev`.
- This does **not** regenerate codegen output — that's `/regen`.
