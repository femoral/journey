---
title: Programmatic environment setup
description: Loading and setting environments from code — for tests that embed the runtime, or custom runners.
sources:
  - packages/core/src/env.ts
---

# Programmatic environment setup

For programmatic use — embedding Journey in an integration test suite, writing a custom runner — the helpers behind `--env` are exported from `@journey/core`:

```ts
import {
  setActiveEnvironment,
  clearActiveEnvironment,
  loadEnvironment,
  listEnvironments,
  env,
} from "@journey/core";
```

## `loadEnvironment(dir, name)`

```ts
function loadEnvironment(environmentsDir: string, name: string): Promise<EnvValues>;
type EnvValues = Record<string, string>;
```

Reads `<dir>/<name>.json`, parses it, and coerces non-string values to strings (via `JSON.stringify`). Throws on missing file, bad JSON, or non-object root.

```ts
const values = await loadEnvironment("./environments", "dev");
// { USERNAME: "alice", PASSWORD: "wonderland", … }
```

## `setActiveEnvironment(name, values)`

```ts
function setActiveEnvironment(name: string, values: EnvValues): void;
```

Installs `values` into a module-level singleton. Subsequent `env(key)` calls read from it. The `name` is stored alongside so error messages can say which environment was active.

```ts
setActiveEnvironment("dev", values);
// env("USERNAME") now returns values.USERNAME
```

## `clearActiveEnvironment()`

```ts
function clearActiveEnvironment(): void;
```

Drops the active environment. Next `env()` call throws `env(…) called with no active environment`.

Useful in test suites that run journeys against multiple environments in sequence:

```ts
clearActiveEnvironment();
setActiveEnvironment("staging", stagingValues);
await runAllRegistered(ctx);

clearActiveEnvironment();
setActiveEnvironment("prod", prodValues);
await runAllRegistered(ctx);
```

## `listEnvironments(dir)`

```ts
function listEnvironments(environmentsDir: string): Promise<string[]>;
```

Sorted list of environment names (no `.json` suffix). Returns `[]` when the directory doesn't exist — never throws on ENOENT.

## Example — embed Journey in vitest

```ts
import { describe, it, expect as vitestExpect } from "vitest";
import {
  clearRegistry,
  loadEnvironment,
  runAllRegistered,
  setActiveEnvironment,
} from "@journey/core";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

describe("smoke tests", () => {
  it("runs the checkout journey against staging", async () => {
    const values = await loadEnvironment("./environments", "staging");
    setActiveEnvironment("staging", values);

    clearRegistry();
    await tsImport(
      pathToFileURL("./journeys/checkout.journey.ts").href,
      import.meta.url,
    );

    const results = await runAllRegistered({ baseUrl: "https://staging.api.example.com" });

    for (const r of results) {
      vitestExpect(r.ok, `${r.name} failed`).toBe(true);
    }
  });
});
```

The runner pattern — `loadEnvironment` → `setActiveEnvironment` → `clearRegistry` → `tsImport` each journey file → `runAllRegistered` — is exactly what the CLI does internally (see `packages/cli/src/commands/run.ts`).
