---
title: Logging
description: JourneyLogger, lifecycle events, createConsoleLogger, loggerFromEnv, maskHeaders.
sources:
  - packages/core/src/logger.ts
---

# Logging

Pluggable logger attached to `HttpContext.logger`. The runtime calls methods on it at each lifecycle point; methods are all optional, so you only implement the ones you need.

## `JourneyLogger`

```ts
interface JourneyLogger {
  onRunStart?(event: RunStartEvent): void;
  onRunEnd?(event: RunEndEvent): void;
  onStepStart?(event: StepStartEvent): void;
  onStepEnd?(event: StepEndEvent): void;
  onRequest?(req: RequestLog): void;
  onResponse?(req: RequestLog, res: ResponseLog): void;
  onError?(req: RequestLog, error: unknown, durationMs: number): void;
  onLog?(event: LogEvent): void;
  info?(message: string): void;
}
```

| Method        | Fired                                                              |
|---------------|--------------------------------------------------------------------|
| `onRunStart`  | Before any step executes. Carries the list of journey names.       |
| `onRunEnd`    | After every journey completes or halts.                            |
| `onStepStart` | Before a step's lazy inputs resolve.                               |
| `onStepEnd`   | After a step finishes (including failures).                        |
| `onRequest`   | Before `fetch`. Headers passed raw (no masking).                   |
| `onResponse`  | After a successful `fetch`.                                        |
| `onError`     | When `fetch` rejects (network error, abort).                       |
| `onLog`       | When user code calls `console.log/warn/error` (if installed).      |
| `info`        | Generic text channel used by `createConsoleLogger`.                |

## Event types

```ts
interface RunStartEvent {
  runId: string;
  journeyNames: string[];
}

interface RunEndEvent {
  runId: string;
  ok: boolean;
  durationMs: number;
  results: ReadonlyArray<{ name: string; ok: boolean }>;
}

interface StepStartEvent {
  runId: string;
  journeyIdx: number;
  journeyName: string;
  stepIdx: number; // monotonic across journey boundaries
  name: string;
}

interface StepEndEvent {
  runId: string;
  journeyIdx: number;
  stepIdx: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}

interface RequestLog {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface ResponseLog {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}

interface LogEvent {
  level: "info" | "warn" | "error";
  text: string;
}
```

`stepIdx` being monotonic across journeys means subscribers can key streams by step index without caring which journey the step belongs to.

## `createConsoleLogger(opts?)`

```ts
function createConsoleLogger(opts?: ConsoleLoggerOptions): JourneyLogger;

interface ConsoleLoggerOptions {
  /** Where to write each line. Defaults to `console.error`. */
  write?: (line: string) => void;
  /** Mask secret-looking headers. Default `true`. */
  mask?: boolean;
  /** Truncate logged bodies past this many chars. Default `1024`. */
  maxBodyChars?: number;
}
```

Produces human-readable single-line output on `onRequest` / `onResponse` / `onError` / `info`:

```
→ POST http://127.0.0.1:5180/auth/login
  headers {"content-type":"application/json","authorization":"***"}
  body    {"username":"alice","password":"wonderland"}
← 200 POST http://127.0.0.1:5180/auth/login (35ms)
  body    {"token":"…","expiresIn":3600}
```

## `loggerFromEnv(env?)`

```ts
function loggerFromEnv(env?: NodeJS.ProcessEnv): JourneyLogger | undefined;
```

Returns a console logger when the `DEBUG` env var contains `journey`, `journey:*`, or `*`. Otherwise `undefined`. Used by the CLI's `run` command so `DEBUG=journey journey run …` is equivalent to `journey run … --debug`.

## Header masking

```ts
const SECRET_HEADERS: ReadonlyArray<string>;

function maskHeaders(
  headers: Record<string, string>,
  masks?: ReadonlyArray<string>,
): Record<string, string>;
```

`SECRET_HEADERS` defaults to `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`. `maskHeaders` returns a new object with each listed header's value replaced by `***` (case-insensitive match).

Pass a custom `masks` array to cover tenant-specific headers.
