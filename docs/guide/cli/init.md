---
title: journey init
description: Scaffold a new Journey project from an OpenAPI spec.
sources:
  - packages/cli/src/commands/init.ts
  - packages/cli/src/index.ts
  - packages/codegen/src/index.ts
---

# `journey init <dir>`

Scaffold a new project from an OpenAPI spec.

```sh
journey init <dir> --spec <path> [--force]
```

## Arguments and flags

| Argument / flag   | Type      | Default | Required | Purpose |
|-------------------|-----------|---------|----------|---------|
| `<dir>`           | path      | —       | Yes      | Target directory (created if missing). |
| `--spec <path>`   | path      | —       | **Yes**  | OpenAPI spec file to read and copy into the project. |
| `--force`         | boolean   | `false` | No       | Scaffold into a non-empty directory. |

## Behaviour

1. Creates `<dir>/` (if absent), plus `generated/`, `journeys/`, `environments/`, `.journey/cache/`.
2. Copies the spec to `<dir>/<basename of --spec>`.
3. Writes an initial `journey.config.json` referencing the copied spec.
4. Writes `.gitignore` (ignores `.journey/cache/` and `node_modules/`).
5. Runs code generation once, producing `generated/endpoints.ts` and `generated/models.ts`.

## Output

```
Initialized Journey project at /abs/path (N operations).
```

`N` is the number of OpenAPI operations discovered in the spec.

## Exit codes

| Code | When |
|------|------|
| `0`  | Success. |
| `1`  | Directory not empty without `--force`, spec not readable, generation failure. |

## Initial config

The written `journey.config.json` contains only the essentials:

```json
{
  "name": "<dir-basename>",
  "spec": "<spec-basename>",
  "generatedDir": "generated",
  "journeysDir": "journeys",
  "environmentsDir": "environments"
}
```

Add `baseUrl` before `journey run` works against a live server. See the [config reference](../../reference/config) for every supported field.

## Notes

- The spec is **copied** into the project, not referenced by path. Regeneration reads the copy — run `journey init` again (or manually overwrite the copy) if the source spec changes location.
- `init` doesn't create any journeys. Start with an empty `journeys/` directory and add files as you go.
- On `--force`, existing files in the target directory are left alone — only missing files are written. You can safely init into a directory that already has a `journey.config.json` and it will be overwritten, but other files stay.
