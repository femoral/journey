---
title: env() inside a journey
description: Reading environment variables from step options. For file format and selection, see the Environments guide.
sources:
  - packages/core/src/env.ts
---

# `env()` inside a journey

```ts
function env(key: string): string;
```

Reads from the **active environment** — the environment file loaded by `--env <name>` or by `defaultEnvironment` in `journey.config.json`. Always returns a `string`; non-string JSON values are stringified when the environment is loaded.

```ts
step("login", {
  endpoint: endpoints.login,
  body: {
    username: env("USERNAME"),
    password: env("PASSWORD"),
  },
});
```

## Error cases

`env()` throws at **step-execution time** (not at registration), so a missing key fails the step cleanly rather than crashing the whole runner.

| Trigger                      | Message                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| No active environment set    | `env("USERNAME") called with no active environment. Pass --env <name> or set one via setActiveEnvironment().` |
| Key missing from environment | `env: key "USERNAME" not found in environment "dev"`                                                          |

## Using it inside lazy callbacks

`env()` is a regular function call — it can appear anywhere:

```ts
step("create", {
  endpoint: endpoints.createOrder,
  headers: () => ({
    Authorization: `Bearer ${token}`,
    "X-Request-Id": `${env("REQUEST_ID_PREFIX")}-create`,
  }),
});
```

## Computing derived values

Sometimes you want a computed constant that combines environment values:

```ts
const baseUrl = env("API_BASE");
const runId = `${env("ENVIRONMENT")}-${Date.now()}`;

step("create", {
  endpoint: endpoints.createOrder,
  headers: () => ({ "X-Request-Id": `${runId}-order` }),
});
```

Declare them at the top of the `journey(...)` body — that way they're computed once per run, not once per step execution.

## All-the-details

File format, `--env` selection, secret handling, and programmatic setup live in the [Environments](../environments/) guide.
