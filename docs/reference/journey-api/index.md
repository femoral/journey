---
title: Journey API
description: Overview of exports from @journey/core — grouped by module.
sources:
  - packages/core/src/index.ts
---

# Journey API

Public API exported from `@journey/core`. All types come from the same package.

```ts
import { journey, step, env, expect /*, … */ } from "@journey/core";
```

## Module map

| Page                          | Exports                                                                                                                                                | Purpose                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| [Runtime](./runtime)          | `journey`, `step`, `runAllRegistered`, `runJourney`, `clearRegistry`, `getRegisteredJourneys`, `StepOptions`, `StepResult`, `JourneyResult`, `RunMeta` | Registration and execution of journeys.      |
| [Sub-journeys](./sub-journey) | `invokeJourney`, `output`, reusable `journey`, `JourneyHandle`, `InvokeJourneyOptions`, `SubJourneyCache`, `createSubJourneyCache`, `CacheMode`        | Reusable journeys invoked as pipeline nodes. |
| [HTTP](./http)                | `HttpContext`, `HttpResponse`, `RequestSpec`, `BuildRequestOptions`, `buildRequest`, `execute`, `resolveUrl`                                           | Low-level request building and execution.    |
| [Fetch](./fetch)              | `fetch`                                                                                                                                                | Instrumented `globalThis.fetch` wrapper.     |
| [Endpoints](./endpoints)      | `Endpoint`, `EndpointRef`, `EndpointDescriptor`, `HttpMethod`, `ResponseOf`, `isEndpointRef`                                                           | Endpoint types and the runtime guard.        |
| [Environment](./environment)  | `env`, `setActiveEnvironment`, `clearActiveEnvironment`, `loadEnvironment`, `listEnvironments`, `EnvValues`                                            | Environment loading and lookup.              |
| [Assertions](./assertions)    | `expect`, `Expectation`, `AssertionError`                                                                                                              | Built-in matcher helper.                     |
| [Config](./config-api)        | `loadConfig`, `resolveConfigPaths`, `JourneyConfig`, `JourneyConfigSchema`, `LoadedConfig`                                                             | Read and validate `journey.config.json`.     |
| [Logging](./logging)          | `JourneyLogger`, `createConsoleLogger`, `loggerFromEnv`, `maskHeaders`, `SECRET_HEADERS`, event type exports                                           | Lifecycle hooks and built-in loggers.        |
| [History](./history)          | `writeRun`, `readRun`, `listRuns`, `pruneRuns`, `RunRecord`, `RunSummary`                                                                              | Run-record persistence.                      |

## Entry points

Most journey authors only touch the [runtime](./runtime) + [assertions](./assertions) + [environment](./environment) exports. The rest exist for:

- Custom runners (integrate Journey into a test harness).
- Dashboards or CI tooling that read run history.
- Wrappers that inject headers / base URLs globally.

## Stability

The exports listed above are the supported API. Internal helpers re-exported but not documented here (e.g. `SharedState` symbols) may change without notice.
