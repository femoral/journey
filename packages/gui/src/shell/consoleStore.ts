import { createSignal, type Accessor } from "solid-js";
import type { RunEvent } from "../api/runEvents";

/**
 * A single row in the console's Network tab. Both SSE events and synthetic
 * one-off requests funnel into this shape.
 */
export type ConsoleEntry = {
  id: string; // `${runId}:${stepIdx}`
  runId: string;
  stepIdx: number;
  journeyName?: string;
  stepName: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  size?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  error?: string;
  state: "running" | "pass" | "fail";
  timestamp: number;
};

export type ConsoleLog = {
  id: string;
  runId: string;
  stepIdx: number;
  stepName: string;
  level: "info" | "warn" | "error";
  text: string;
  timestamp: number;
};

/**
 * Plain-object store wrapped in signals. Every mutation returns a new array so
 * Solid's identity-based reactivity sees the change.
 */
export type ConsoleStore = {
  entries: Accessor<ConsoleEntry[]>;
  logs: Accessor<ConsoleLog[]>;
  activeRunId: Accessor<string | undefined>;
  ingest: (event: RunEvent) => void;
  ingestSynthetic: (patch: Omit<ConsoleEntry, "id" | "timestamp">) => string;
  clear: () => void;
};

function byteSize(body: unknown): number | undefined {
  if (body === undefined || body === null) return undefined;
  try {
    const s = typeof body === "string" ? body : JSON.stringify(body);
    return new TextEncoder().encode(s).byteLength;
  } catch {
    return undefined;
  }
}

export function createConsoleStore(): ConsoleStore {
  const [entries, setEntries] = createSignal<ConsoleEntry[]>([]);
  const [logs, setLogs] = createSignal<ConsoleLog[]>([]);
  const [activeRunId, setActiveRunId] = createSignal<string | undefined>(undefined);

  // Map from `${runId}:${stepIdx}` -> array index for O(1) updates.
  const index = new Map<string, number>();

  const upsert = (id: string, patch: Partial<ConsoleEntry>, init: () => ConsoleEntry) => {
    const i = index.get(id);
    if (i === undefined) {
      const entry = { ...init(), ...patch };
      index.set(id, entries().length);
      setEntries([...entries(), entry]);
      return;
    }
    const copy = entries().slice();
    copy[i] = { ...copy[i]!, ...patch };
    setEntries(copy);
  };

  const ingest = (event: RunEvent) => {
    switch (event.kind) {
      case "run:start":
        setActiveRunId(event.runId);
        break;
      case "step:planned":
        // The console dock renders per-step entries lazily on `step:start`; the
        // planned list itself is consumed by the JourneysPage timeline.
        break;
      case "step:start": {
        const id = `${event.runId}:${event.stepIdx}`;
        upsert(
          id,
          {
            journeyName: event.journeyName,
            stepName: event.name,
            state: "running",
          },
          () => ({
            id,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: event.name,
            journeyName: event.journeyName,
            state: "running",
            timestamp: Date.now(),
          }),
        );
        break;
      }
      case "request": {
        const id = `${event.runId}:${event.stepIdx}`;
        upsert(
          id,
          {
            method: event.method,
            url: event.url,
            requestHeaders: event.headers,
            requestBody: event.body,
          },
          () => ({
            id,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: `step ${event.stepIdx + 1}`,
            method: event.method,
            url: event.url,
            requestHeaders: event.headers,
            requestBody: event.body,
            state: "running",
            timestamp: Date.now(),
          }),
        );
        break;
      }
      case "response": {
        const id = `${event.runId}:${event.stepIdx}`;
        const size = byteSize(event.body);
        upsert(
          id,
          {
            status: event.status,
            responseHeaders: event.headers,
            responseBody: event.body,
            durationMs: event.durationMs,
            ...(size !== undefined ? { size } : {}),
          },
          () => ({
            id,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: `step ${event.stepIdx + 1}`,
            status: event.status,
            responseHeaders: event.headers,
            responseBody: event.body,
            durationMs: event.durationMs,
            state: "running",
            timestamp: Date.now(),
          }),
        );
        break;
      }
      case "error": {
        const id = `${event.runId}:${event.stepIdx}`;
        upsert(id, { error: event.message, state: "fail" }, () => ({
          id,
          runId: event.runId,
          stepIdx: event.stepIdx,
          stepName: `step ${event.stepIdx + 1}`,
          error: event.message,
          state: "fail",
          timestamp: Date.now(),
        }));
        setLogs([
          ...logs(),
          {
            id: `${event.runId}:${event.stepIdx}:err:${Date.now()}`,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: entries()[index.get(id) ?? -1]?.stepName ?? "",
            level: "error",
            text: event.message,
            timestamp: Date.now(),
          },
        ]);
        break;
      }
      case "log": {
        const idx = index.get(`${event.runId}:${event.stepIdx}`);
        const stepName =
          idx !== undefined
            ? (entries()[idx]?.stepName ?? `step ${event.stepIdx + 1}`)
            : event.stepIdx < 0
              ? "(run)"
              : `step ${event.stepIdx + 1}`;
        setLogs([
          ...logs(),
          {
            id: `${event.runId}:${event.stepIdx}:log:${logs().length}`,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName,
            level: event.level,
            text: event.text,
            timestamp: Date.now(),
          },
        ]);
        break;
      }
      case "step:end": {
        const id = `${event.runId}:${event.stepIdx}`;
        upsert(
          id,
          {
            state: event.ok ? "pass" : "fail",
            ...(event.error !== undefined ? { error: event.error } : {}),
            durationMs: event.durationMs,
          },
          () => ({
            id,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: `step ${event.stepIdx + 1}`,
            state: event.ok ? "pass" : "fail",
            durationMs: event.durationMs,
            timestamp: Date.now(),
            ...(event.error !== undefined ? { error: event.error } : {}),
          }),
        );
        break;
      }
      case "run:end":
        // Nothing to do — steps already transitioned to their terminal state.
        break;
    }
  };

  const ingestSynthetic = (patch: Omit<ConsoleEntry, "id" | "timestamp">) => {
    const id = `${patch.runId}:${patch.stepIdx}`;
    setActiveRunId(patch.runId);
    upsert(id, patch, () => ({
      id,
      ...patch,
      timestamp: Date.now(),
    }));
    return id;
  };

  const clear = () => {
    index.clear();
    setEntries([]);
    setLogs([]);
    setActiveRunId(undefined);
  };

  return { entries, logs, activeRunId, ingest, ingestSynthetic, clear };
}

/**
 * Renders a cURL command from an entry's recorded request. Used by the
 * "copy curl" button on each console row.
 */
export function toCurl(entry: ConsoleEntry): string {
  if (!entry.method || !entry.url) return "";
  const parts: string[] = [`curl -X ${entry.method}`];
  for (const [k, v] of Object.entries(entry.requestHeaders ?? {})) {
    parts.push(`-H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  }
  if (entry.requestBody !== undefined && entry.requestBody !== null) {
    const body =
      typeof entry.requestBody === "string" ? entry.requestBody : JSON.stringify(entry.requestBody);
    parts.push(`--data '${body.replace(/'/g, "'\\''")}'`);
  }
  parts.push(`'${entry.url}'`);
  return parts.join(" \\\n  ");
}
