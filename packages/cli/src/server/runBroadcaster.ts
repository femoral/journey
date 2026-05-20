import type { ServerResponse } from "node:http";
import type {
  GroupEndEvent,
  GroupStartEvent,
  JourneyLogger,
  JourneyResult,
  LogEvent,
  RequestLog,
  ResponseLog,
  RunEndEvent,
  RunPlannedEvent,
  RunStartEvent,
  StepEndEvent,
  StepStartEvent,
} from "@journey/core";

/**
 * Wire-format for events streamed over SSE. Each `event:` field is mapped from
 * the core logger callbacks; the runtime's stepIdx flows through so consumers
 * can attach request/response/log frames to the correct step without tracking
 * journey boundaries themselves.
 */
export type RunEvent =
  | { kind: "run:start"; runId: string; journeyNames: string[] }
  | {
      kind: "step:planned";
      runId: string;
      journeyIdx: number;
      journeyName: string;
      stepIdxOffset: number;
      steps: ReadonlyArray<{ name: string; method?: string; path?: string }>;
    }
  | {
      kind: "step:start";
      runId: string;
      journeyIdx: number;
      journeyName: string;
      stepIdx: number;
      name: string;
    }
  | {
      kind: "request";
      runId: string;
      stepIdx: number;
      requestIdx: number;
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: unknown;
    }
  | {
      kind: "response";
      runId: string;
      stepIdx: number;
      requestIdx: number;
      status: number;
      headers: Record<string, string>;
      body: unknown;
      durationMs: number;
    }
  | {
      kind: "error";
      runId: string;
      stepIdx: number;
      requestIdx: number;
      message: string;
      durationMs: number;
    }
  | {
      kind: "log";
      runId: string;
      stepIdx: number;
      level: "info" | "warn" | "error";
      text: string;
    }
  | {
      kind: "step:end";
      runId: string;
      journeyIdx: number;
      stepIdx: number;
      ok: boolean;
      durationMs: number;
      error?: string;
    }
  | {
      // A sub-journey node (`invokeJourney(...)`) began executing. `stepIdx` is
      // the slot the node itself occupies; the child's own steps fire ordinary
      // `step:start` / `step:end` frames carrying stepIdx values from
      // `firstChildStepIdx` upward, so the GUI can fold them under this group.
      kind: "group:start";
      runId: string;
      journeyIdx: number;
      name: string;
      childJourneyName: string;
      stepIdx: number;
      firstChildStepIdx: number;
      cacheStatus: "miss" | "hit";
      resolvedKey?: string;
    }
  | {
      kind: "group:end";
      runId: string;
      journeyIdx: number;
      name: string;
      childJourneyName: string;
      stepIdx: number;
      lastChildStepIdx: number;
      ok: boolean;
      durationMs: number;
      error?: string;
    }
  | {
      kind: "run:end";
      runId: string;
      ok: boolean;
      durationMs: number;
      results: ReadonlyArray<{ name: string; ok: boolean }>;
    };

interface Subscriber {
  res: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

/**
 * In-memory fan-out of run events for a single runId. Events are appended to
 * a buffer as they fire; each subscriber gets the current buffer replayed on
 * attach plus every subsequent event until `run:end` (at which point the
 * subscriber connection is closed). The broadcaster self-cleans from the
 * registry a short grace period after completion so a late SSE connection can
 * still catch the full tail.
 */
export class RunBroadcaster {
  readonly runId: string;
  private readonly events: RunEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private currentStepIdx = -1;
  private nextRequestSeq = 0;
  // Tags each in-flight RequestLog with its monotonic sequence so onResponse /
  // onError emit the matching `requestIdx`. Per-step uniqueness isn't enough —
  // helpers (auth bootstrap, fan-out) make multiple requests inside one step.
  private readonly requestSeqs = new WeakMap<RequestLog, number>();
  private completed = false;
  private completedAt: number | undefined;

  constructor(runId: string) {
    this.runId = runId;
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  /**
   * Core-level logger that feeds everything into the event buffer. `stepIdx`
   * is tracked locally from `onStepStart` and attached to intervening
   * request/response/error events so SSE consumers don't need to correlate
   * by timing.
   */
  toLogger(): JourneyLogger {
    return {
      onRunStart: (e: RunStartEvent) => {
        this.emit({ kind: "run:start", runId: e.runId, journeyNames: e.journeyNames });
      },
      onPlanned: (e: RunPlannedEvent) => {
        this.emit({
          kind: "step:planned",
          runId: e.runId,
          journeyIdx: e.journeyIdx,
          journeyName: e.journeyName,
          stepIdxOffset: e.stepIdxOffset,
          steps: e.steps,
        });
      },
      onStepStart: (e: StepStartEvent) => {
        this.currentStepIdx = e.stepIdx;
        this.emit({
          kind: "step:start",
          runId: e.runId,
          journeyIdx: e.journeyIdx,
          journeyName: e.journeyName,
          stepIdx: e.stepIdx,
          name: e.name,
        });
      },
      onRequest: (req: RequestLog) => {
        const requestIdx = this.nextRequestSeq++;
        this.requestSeqs.set(req, requestIdx);
        this.emit({
          kind: "request",
          runId: this.runId,
          stepIdx: this.currentStepIdx,
          requestIdx,
          method: req.method,
          url: req.url,
          headers: req.headers,
          ...(req.body !== undefined ? { body: req.body } : {}),
        });
      },
      onResponse: (req: RequestLog, res: ResponseLog) => {
        this.emit({
          kind: "response",
          runId: this.runId,
          stepIdx: this.currentStepIdx,
          requestIdx: this.requestSeqs.get(req) ?? -1,
          status: res.status,
          headers: res.headers,
          body: res.body,
          durationMs: res.durationMs,
        });
      },
      onError: (req: RequestLog, err: unknown, durationMs: number) => {
        this.emit({
          kind: "error",
          runId: this.runId,
          stepIdx: this.currentStepIdx,
          requestIdx: this.requestSeqs.get(req) ?? -1,
          message: err instanceof Error ? err.message : String(err),
          durationMs,
        });
      },
      onLog: (e: LogEvent) => {
        this.emit({
          kind: "log",
          runId: this.runId,
          stepIdx: this.currentStepIdx,
          level: e.level,
          text: e.text,
        });
      },
      onStepEnd: (e: StepEndEvent) => {
        this.emit({
          kind: "step:end",
          runId: e.runId,
          journeyIdx: e.journeyIdx,
          stepIdx: e.stepIdx,
          ok: e.ok,
          durationMs: e.durationMs,
          ...(e.error !== undefined ? { error: e.error } : {}),
        });
      },
      onGroupStart: (e: GroupStartEvent) => {
        this.emit({
          kind: "group:start",
          runId: e.runId,
          journeyIdx: e.journeyIdx,
          name: e.name,
          childJourneyName: e.childJourneyName,
          stepIdx: e.stepIdx,
          firstChildStepIdx: e.firstChildStepIdx,
          cacheStatus: e.cacheStatus,
          ...(e.resolvedKey !== undefined ? { resolvedKey: e.resolvedKey } : {}),
        });
      },
      onGroupEnd: (e: GroupEndEvent) => {
        this.emit({
          kind: "group:end",
          runId: e.runId,
          journeyIdx: e.journeyIdx,
          name: e.name,
          childJourneyName: e.childJourneyName,
          stepIdx: e.stepIdx,
          lastChildStepIdx: e.lastChildStepIdx,
          ok: e.ok,
          durationMs: e.durationMs,
          ...(e.error !== undefined ? { error: e.error } : {}),
        });
      },
      onRunEnd: (e: RunEndEvent) => {
        this.emit({
          kind: "run:end",
          runId: e.runId,
          ok: e.ok,
          durationMs: e.durationMs,
          results: e.results,
        });
        this.complete();
      },
    };
  }

  /**
   * Emits a fatal error (e.g. a failure to load the journey file, before any
   * step events fire). Translates to a `run:end` ok=false so clients stop
   * waiting.
   */
  fail(message: string): void {
    this.emit({
      kind: "run:end",
      runId: this.runId,
      ok: false,
      durationMs: 0,
      results: [{ name: "error", ok: false }],
    });
    // Preserve the message so late subscribers see it.
    this.emit({
      kind: "error",
      runId: this.runId,
      stepIdx: -1,
      requestIdx: -1,
      message,
      durationMs: 0,
    });
    this.complete();
  }

  /**
   * Wires a ServerResponse as a long-lived SSE subscriber. Replays the buffered
   * events, then holds the connection open for new ones. If the run is already
   * complete, the connection is closed immediately after replay so the client
   * moves on without blocking.
   */
  subscribe(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    });
    for (const ev of this.events) {
      writeEvent(res, ev);
    }
    if (this.completed) {
      res.end();
      return;
    }
    const heartbeat = setInterval(() => {
      // Comment-only frame keeps proxies/middleboxes from timing out idle SSE
      // connections without generating noise in the consumer's event handler.
      try {
        res.write(": keep-alive\n\n");
      } catch {
        /* socket gone; cleanup runs via the 'close' handler */
      }
    }, 15_000);
    const sub: Subscriber = { res, heartbeat };
    this.subscribers.add(sub);
    res.on("close", () => {
      clearInterval(heartbeat);
      this.subscribers.delete(sub);
    });
  }

  private emit(event: RunEvent): void {
    this.events.push(event);
    for (const sub of this.subscribers) {
      try {
        writeEvent(sub.res, event);
      } catch {
        /* subscriber closed mid-write — cleanup happens via 'close' */
      }
    }
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.completedAt = Date.now();
    // Drop the abort controller as soon as the run is done so a late
    // `POST /api/runs/:id/abort` returns 404 instead of silently no-oping.
    abortControllers.delete(this.runId);
    for (const sub of this.subscribers) {
      try {
        clearInterval(sub.heartbeat);
        sub.res.end();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.clear();
  }

  /** True when this broadcaster is ready to be evicted from the registry. */
  canEvict(graceMs: number): boolean {
    if (!this.completed) return false;
    if (this.completedAt === undefined) return true;
    return Date.now() - this.completedAt > graceMs;
  }
}

function writeEvent(res: ServerResponse, event: RunEvent): void {
  res.write(`event: ${event.kind}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Registry of live broadcasters, keyed by runId. Completed broadcasters hang
 * around for `EVICTION_GRACE_MS` so late subscribers can still replay the run.
 */
const EVICTION_GRACE_MS = 5 * 60 * 1000;
const registry = new Map<string, RunBroadcaster>();
/**
 * Abort controllers for in-flight runs. The route handler registers one with
 * the runId when a streaming run starts; `POST /api/runs/:id/abort` looks it
 * up and triggers the abort. Entries are removed when the run completes (the
 * broadcaster's `complete()` path calls `clearAbortController`).
 */
const abortControllers = new Map<string, AbortController>();

export function newRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function registerBroadcaster(runId: string): RunBroadcaster {
  evictStale();
  const b = new RunBroadcaster(runId);
  registry.set(runId, b);
  return b;
}

export function getBroadcaster(runId: string): RunBroadcaster | undefined {
  evictStale();
  return registry.get(runId);
}

export function evictStale(graceMs: number = EVICTION_GRACE_MS): void {
  for (const [id, b] of registry) {
    if (b.canEvict(graceMs)) {
      registry.delete(id);
      abortControllers.delete(id);
    }
  }
}

export function registerAbortController(runId: string, controller: AbortController): void {
  abortControllers.set(runId, controller);
}

export function clearAbortController(runId: string): void {
  abortControllers.delete(runId);
}

/**
 * Triggers the AbortController associated with `runId`. Returns `true` if a
 * live controller was found, `false` if the run is unknown or already
 * complete. The broadcaster will see `run:end` fire naturally — the runtime
 * propagates the signal into in-flight fetches and stops launching new steps.
 */
export function abortRun(runId: string): boolean {
  const controller = abortControllers.get(runId);
  if (!controller) return false;
  controller.abort(new Error("run aborted by user"));
  return true;
}

/** Result of the awaited run in a form the route handler can serialize. */
export interface AwaitedRun {
  runId: string;
  results?: JourneyResult[];
  error?: string;
}
