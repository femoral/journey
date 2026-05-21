/**
 * Transport-agnostic live run event stream.
 *
 * The same event shape is emitted by every surface (web browser, Tauri
 * desktop) so the UI code consuming it doesn't branch on environment. Today
 * both transports speak SSE; the Tauri variant exists so the Rust side can
 * later proxy events over Tauri's native channel without the UI needing to
 * change.
 *
 * Wire format matches what `packages/cli/src/server/runBroadcaster.ts`
 * writes — keep the two in sync.
 */

/**
 * One entry in a planned pipeline (mirrors core's `PlannedNode`). A `sub`
 * entry nests its best-effort discovered child pipeline under `children`;
 * `incomplete` marks a sub-journey whose children could not be discovered at
 * plan time (the live group/step events fill it in once the run reaches it).
 */
export interface PlannedNode {
  kind?: "step" | "sub";
  name: string;
  method?: string;
  path?: string;
  children?: PlannedNode[];
  incomplete?: boolean;
}

export type RunEvent =
  | { kind: "run:start"; runId: string; journeyNames: string[] }
  | {
      kind: "step:planned";
      runId: string;
      journeyIdx: number;
      journeyName: string;
      stepIdxOffset: number;
      steps: ReadonlyArray<PlannedNode>;
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

export type RunEventHandler = (event: RunEvent) => void;

export interface RunSubscription {
  /** Cancels the subscription. Safe to call multiple times. */
  close(): void;
}

export interface RunEventSource {
  /**
   * Subscribe to live events for `runId`. The handler fires for every event in
   * the buffer (replay) then for every subsequent event until `run:end` or an
   * `error` frame is received, at which point the underlying transport closes
   * on its own. Callers should still call `close()` on the returned handle in
   * cleanup paths (unmount, route change) to abort mid-run.
   */
  subscribe(runId: string, onEvent: RunEventHandler): RunSubscription;
}

/**
 * SSE over fetch — works identically in browsers and in Tauri's webview.
 *
 * We use fetch + ReadableStream rather than the built-in `EventSource` because
 * EventSource has no way to set custom headers (needed once we add bearer auth
 * to the serve backend) and no way to abort cleanly other than readyState
 * polling.
 */
export class SseRunEventSource implements RunEventSource {
  constructor(private readonly baseUrl: string = "") {}

  subscribe(runId: string, onEvent: RunEventHandler): RunSubscription {
    const controller = new AbortController();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      controller.abort();
    };

    void (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/events`, {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) {
          onEvent({
            kind: "error",
            runId,
            stepIdx: -1,
            requestIdx: -1,
            message: `SSE subscribe failed: ${res.status}`,
            durationMs: 0,
          });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const parsed = JSON.parse(dataLine.slice(5).trim()) as RunEvent;
              onEvent(parsed);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch (err) {
        if (closed) return;
        onEvent({
          kind: "error",
          runId,
          stepIdx: -1,
          requestIdx: -1,
          message: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        });
      }
    })();

    return { close };
  }
}

/**
 * Tauri transport. Today it delegates to the SSE source since the Rust side
 * doesn't re-emit events yet — the indirection exists so we can swap the
 * implementation without touching the UI once that lands.
 *
 * Future wiring: Rust subscribes to `GET /api/runs/:id/events` internally on
 * `listen-to-run` Tauri command, then emits `journey://event/:runId` frames
 * that this class consumes via `@tauri-apps/api/event.listen`.
 */
export class TauriRunEventSource implements RunEventSource {
  constructor(private readonly fallback: RunEventSource) {}

  subscribe(runId: string, onEvent: RunEventHandler): RunSubscription {
    // Fallback path is identical to the SSE source today. When the Rust
    // bridge lands, swap this body for a Tauri event.listen() subscription.
    return this.fallback.subscribe(runId, onEvent);
  }
}

/** True when running inside a Tauri webview. */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2 exposes this internal marker; presence is the documented way
    // of detecting the webview from frontend code.
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

/**
 * Module-level singleton. Consumers should import `runEvents` and call
 * `.subscribe(runId, handler)`; tests can construct their own
 * SseRunEventSource with an injectable baseUrl or fetch if needed.
 */
export const runEvents: RunEventSource = (() => {
  const sse = new SseRunEventSource();
  return isTauri() ? new TauriRunEventSource(sse) : sse;
})();
