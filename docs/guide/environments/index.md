---
title: Environments
description: Per-environment variables — file format, selection, and secret handling.
sources:
  - packages/core/src/env.ts
---

# Environments

Environments are the mechanism for swapping values between `dev`, `staging`, `prod`, CI, and local hacks without editing journey source. Each environment is a single JSON file; journeys read from it with [`env(key)`](../writing-journeys/env).

## File format

One JSON file per environment, in `environments/` (or whatever `environmentsDir` is set to in `journey.config.json`). The root must be a plain object — no arrays, no top-level primitives.

```json
// environments/dev.json
{
  "USERNAME": "alice",
  "PASSWORD": "wonderland",
  "REQUEST_ID_PREFIX": "journey-dev",
  "SEED_API_URL": "http://127.0.0.1:7000"
}
```

**Values are always strings.** Non-string values (numbers, booleans, nested objects) are `JSON.stringify`'d when the file loads, so `env("PORT")` returns `"8080"` — not `8080`. Convert in the journey if you need a number:

```ts
const port = Number(env("PORT"));
```

## Validation

If the file isn't valid JSON or isn't a plain object, `loadEnvironment` throws:

```
Environment file /abs/path/dev.json must contain a JSON object
Environment file /abs/path/dev.json is not valid JSON: …
```

`journey run` prints these as `journey: <message>` and exits 1 before any step executes.

## Read more

- [Selecting an environment](./selection) — `--env`, `defaultEnvironment`.
- [Secret handling](./secrets) — gitignore strategies, CI injection, log redaction.
- [Programmatic setup](./programmatic) — `loadEnvironment`, `setActiveEnvironment`.
- [Using `env()` inside a journey](../writing-journeys/env) — read side in step options.
