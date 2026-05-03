---
title: journey generate
description: Regenerate typed endpoints/models from the OpenAPI spec.
sources:
  - packages/cli/src/commands/generate.ts
  - packages/codegen/src/index.ts
  - packages/codegen/src/parse.ts
---

# `journey generate`

Regenerate `generated/endpoints.ts` and `generated/models.ts` from the spec referenced in `journey.config.json`.

```sh
journey generate
```

No arguments, no flags. Must run from the project root (where `journey.config.json` lives).

## Behaviour

1. Loads `journey.config.json`.
2. Resolves `spec` to an absolute path; verifies the file exists.
3. Reads the spec (YAML or JSON).
4. Writes `generated/models.ts` (via `openapi-typescript`) and `generated/endpoints.ts` (Journey's own emitter).
5. Does a read on `journeysDir` as a sanity check — but never writes there.

## Output

```
Regenerated N operations → /abs/path/generated/models.ts, /abs/path/generated/endpoints.ts
```

## Exit codes

| Code | When |
|------|------|
| `0`  | Success. |
| `1`  | `journey.config.json` missing or invalid, spec not found, generation failure. |

## Non-destructive guarantee

Only two files are ever rewritten:

- `<generatedDir>/models.ts`
- `<generatedDir>/endpoints.ts`

Nothing in `journeys/`, `environments/`, or `.journey/cache/` is touched. Running `journey generate` on a project with in-progress journey files is always safe.

## Drift detection

After regenerating, check whether any journey files now reference operations that no longer exist. TypeScript will flag them:

```
Property 'getOldPet' does not exist on type '{ login: …; … }'
```

The GUI's **Spec diff** page surfaces the same information without invoking `tsc`. See the [OpenAPI codegen reference](../../reference/openapi-codegen) for details.

## Typical workflow

1. Edit `openapi.yaml` (or replace it with a newer copy).
2. Run `journey generate`.
3. Commit the diff — `generated/endpoints.ts` and `generated/models.ts` will have changed.
4. Update any journeys that referenced removed operations.
