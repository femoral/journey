---
title: Config API
description: loadConfig, resolveConfigPaths, JourneyConfig, JourneyConfigSchema, LoadedConfig.
sources:
  - packages/core/src/config.ts
---

# Config API

Programmatic access to `journey.config.json`. For the schema itself, see the [Config reference](../config).

## `JourneyConfig`

```ts
type JourneyConfig = z.infer<typeof JourneyConfigSchema>;
```

The validated config shape. See the [Config reference](../config) for every field and default.

## `JourneyConfigSchema`

```ts
const JourneyConfigSchema: z.ZodObject<…>;
```

Strict Zod schema — unknown fields are rejected. Exported so callers can validate configs themselves (test harnesses, custom loaders).

## `LoadedConfig`

```ts
interface LoadedConfig {
  readonly config: JourneyConfig;
  readonly projectDir: string;
  readonly configPath: string;
}
```

Returned by `loadConfig`. `projectDir` is the directory you passed in; `configPath` is the absolute path to the file that was read.

## `loadConfig(projectDir)`

```ts
function loadConfig(projectDir: string): Promise<LoadedConfig>;
```

Reads `<projectDir>/journey.config.json`, parses it, and validates it against `JourneyConfigSchema`. Throws on any issue with a formatted message:

```
Could not read journey.config.json at /abs/path/journey.config.json: ENOENT: no such file or directory
journey.config.json is not valid JSON: Unexpected token } in JSON at position 42
journey.config.json failed validation:
  - baseUrl: Invalid url
  - runHistoryKeepCount: Number must be greater than or equal to 0
```

## `resolveConfigPaths(loaded)`

```ts
function resolveConfigPaths(loaded: LoadedConfig): {
  specPath: string;
  generatedDir: string;
  journeysDir: string;
  environmentsDir: string;
};
```

Resolves each directory in the config against `projectDir`. Absolute paths pass through unchanged.

## Example

```ts
import { loadConfig, resolveConfigPaths } from "@journey/core";

const loaded = await loadConfig(process.cwd());
const paths = resolveConfigPaths(loaded);

console.log("spec:", paths.specPath);
console.log("journeys:", paths.journeysDir);
```
