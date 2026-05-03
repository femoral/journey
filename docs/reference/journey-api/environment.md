---
title: Environment
description: env, setActiveEnvironment, clearActiveEnvironment, loadEnvironment, listEnvironments.
sources:
  - packages/core/src/env.ts
---

# Environment

Environment lookup and loading. Narrative: [Environments guide](../../guide/environments/).

## `env(key)`

```ts
function env(key: string): string;
```

Reads the active environment. Throws on missing env or missing key. Values are always strings.

## `EnvValues`

```ts
type EnvValues = Record<string, string>;
```

All values are strings — non-string JSON values are coerced via `JSON.stringify` when the file loads.

## `setActiveEnvironment(name, values)`

```ts
function setActiveEnvironment(name: string, values: EnvValues): void;
```

Installs `values` as the active environment. Subsequent `env(key)` calls read from it.

## `clearActiveEnvironment()`

```ts
function clearActiveEnvironment(): void;
```

Drops the active environment. Next `env()` call throws `env(…) called with no active environment`.

## `loadEnvironment(dir, name)`

```ts
function loadEnvironment(environmentsDir: string, name: string): Promise<EnvValues>;
```

Loads `<dir>/<name>.json` and coerces non-string values. Throws on missing file, bad JSON, or non-object root.

## `listEnvironments(dir)`

```ts
function listEnvironments(environmentsDir: string): Promise<string[]>;
```

Sorted list of environment names (no `.json` suffix). Returns `[]` if the directory doesn't exist — never throws on ENOENT.

## State model

There is exactly one active environment at a time, kept in a module-level singleton (keyed with `Symbol.for("@journey/core::env-state")` so multiple copies of `@journey/core` share it). Tests that embed the runtime should `clearActiveEnvironment()` between cases to avoid leakage.
