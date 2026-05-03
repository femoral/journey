---
title: journey env list
description: List environment files configured in the project.
sources:
  - packages/cli/src/commands/envList.ts
  - packages/core/src/env.ts
---

# `journey env list`

List environment files in the project.

```sh
journey env list
```

No arguments, no flags.

## Behaviour

1. Loads `journey.config.json`.
2. Reads the `environmentsDir` (default `environments/`).
3. Lists every `.json` file, stripping the extension.
4. Prints them alphabetically; marks the `defaultEnvironment` with `*`.

## Output

```
* dev
  staging
  prod
```

When the directory exists but is empty, or doesn't exist at all:

```
No environments found in /abs/path/environments
```

## Exit codes

| Code | When |
|------|------|
| `0`  | Success (even when no environments exist). |
| `1`  | Config not loadable, unexpected filesystem error. |

## Notes

- This command does **not** load or validate the files — it only lists them. Invalid JSON in an env file only surfaces when `journey run --env <name>` tries to use it.
- The `*` marker tracks `defaultEnvironment` literally. If `defaultEnvironment` is set to a name that doesn't correspond to a file, the list just won't mark anything with `*`.
- For programmatic listing, import `listEnvironments` from `@journey/core` — same behaviour, returns the string array directly.
