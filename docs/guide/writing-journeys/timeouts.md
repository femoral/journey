---
title: Timeouts
description: Per-step timeoutMs and how the runtime aborts slow requests.
sources:
  - packages/core/src/http.ts
---

# Timeouts

## `timeoutMs`

```ts
timeoutMs?: number;
```

Per-step timeout in milliseconds. Wraps the fetch call in an `AbortController` — when the timer fires, the controller aborts and the pending fetch promise rejects. The rejection is caught by the runtime and surfaces as a failed step.

```ts
step("slow processing", {
  endpoint: endpoints.processBatch,
  timeoutMs: 30_000, // 30 seconds
});
```

## Defaults

**No default.** If you don't set `timeoutMs`, the step runs until either the underlying network resolves or errors. In Node, that respects the agent's keep-alive and TCP behaviour — in practice "forever" unless the server ends the connection.

There is also no project-wide timeout knob today. Set `timeoutMs` per step on the few operations that need it, or create a small helper in your project if every step should share the same cap.

## Failure mode

An aborted step looks like any other failed step: its `StepResult` has `ok: false` and the `error` is the abort error message (typically `"The operation was aborted."`). The journey halts at the failed step; other journeys in the same run continue.

## Interaction with the logger

The logger gets `onError(req, err, durationMs)` rather than `onResponse`. The CLI's `--debug` output looks like:

```
→ POST http://127.0.0.1:5180/process
✗ POST http://127.0.0.1:5180/process failed after 30001ms: The operation was aborted.
```

## When you need a retry

`timeoutMs` does not retry. If a step should be retried, wrap the retry logic in the `after` or `assert` callback — or, more cleanly, stage the retry as its own step with a conditional assertion that lets the journey proceed on the next attempt. Journey deliberately does not have a retry knob to keep step semantics simple; a flaky step should either be hardened or moved to k6 (which has its own retry policies).
