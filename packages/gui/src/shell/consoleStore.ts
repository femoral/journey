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

  // Map from `${runId}:${requestIdx}` -> array index for O(1) updates. Each
  // HTTP request gets its own row, so a step with helper-injected fetches
  // shows up as N rows in the order they fired rather than one row whose
  // method/URL keeps mutating.
  const index = new Map<string, number>();

  // Track the most recent step header so request rows can be labeled with
  // the step name (the SSE request frame itself carries only stepIdx). Synthetic
  // ingest from outside the journey pipeline uses its own stepName.
  let currentStepName = "";
  let currentJourneyName: string | undefined;
  let currentStepIdx = -1;

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

  const labelForStep = (stepIdx: number): string => {
    if (stepIdx === currentStepIdx && currentStepName) return currentStepName;
    if (stepIdx < 0) return "(run)";
    return `step ${stepIdx + 1}`;
  };

  const ingest = (event: RunEvent) => {
    switch (event.kind) {
      case "run:start":
        setActiveRunId(event.runId);
        break;
      case "step:planned":
        // The planned list is consumed by the JourneysPage timeline only; the
        // console dock keeps its row model centered on HTTP requests.
        break;
      case "step:start": {
        // Track the current step so request rows that come next are labeled
        // with the user-facing step name, but don't create a row here — a
        // step without an HTTP request shouldn't appear in the Network tab.
        currentStepIdx = event.stepIdx;
        currentStepName = event.name;
        currentJourneyName = event.journeyName;
        break;
      }
      case "request": {
        const id = `${event.runId}:${event.requestIdx}`;
        const entry: ConsoleEntry = {
          id,
          runId: event.runId,
          stepIdx: event.stepIdx,
          stepName: labelForStep(event.stepIdx),
          method: event.method,
          url: event.url,
          requestHeaders: event.headers,
          state: "running",
          timestamp: Date.now(),
          ...(currentJourneyName !== undefined ? { journeyName: currentJourneyName } : {}),
          ...(event.body !== undefined ? { requestBody: event.body } : {}),
        };
        upsert(id, entry, () => entry);
        break;
      }
      case "response": {
        const id = `${event.runId}:${event.requestIdx}`;
        const size = byteSize(event.body);
        upsert(
          id,
          {
            status: event.status,
            responseHeaders: event.headers,
            responseBody: event.body,
            durationMs: event.durationMs,
            state: event.status >= 400 ? "fail" : "pass",
            ...(size !== undefined ? { size } : {}),
          },
          () => ({
            id,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: labelForStep(event.stepIdx),
            status: event.status,
            responseHeaders: event.headers,
            responseBody: event.body,
            durationMs: event.durationMs,
            state: event.status >= 400 ? "fail" : "pass",
            timestamp: Date.now(),
            ...(currentJourneyName !== undefined ? { journeyName: currentJourneyName } : {}),
          }),
        );
        break;
      }
      case "error": {
        const id = `${event.runId}:${event.requestIdx}`;
        upsert(id, { error: event.message, state: "fail", durationMs: event.durationMs }, () => ({
          id,
          runId: event.runId,
          stepIdx: event.stepIdx,
          stepName: labelForStep(event.stepIdx),
          error: event.message,
          state: "fail",
          durationMs: event.durationMs,
          timestamp: Date.now(),
          ...(currentJourneyName !== undefined ? { journeyName: currentJourneyName } : {}),
        }));
        setLogs([
          ...logs(),
          {
            id: `${event.runId}:err:${event.requestIdx}:${Date.now()}`,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: labelForStep(event.stepIdx),
            level: "error",
            text: event.message,
            timestamp: Date.now(),
          },
        ]);
        break;
      }
      case "log": {
        setLogs([
          ...logs(),
          {
            id: `${event.runId}:${event.stepIdx}:log:${logs().length}`,
            runId: event.runId,
            stepIdx: event.stepIdx,
            stepName: labelForStep(event.stepIdx),
            level: event.level,
            text: event.text,
            timestamp: Date.now(),
          },
        ]);
        break;
      }
      case "step:end":
        // Per-request rows already transitioned via response/error; nothing
        // more to record here. The Step Timeline owns step-level pass/fail.
        break;
      case "run:end":
        // Steps already finalized via response/error frames.
        break;
    }
  };

  const ingestSynthetic = (patch: Omit<ConsoleEntry, "id" | "timestamp">) => {
    // Namespaced separately from request rows so a synthetic id can never
    // collide with a `${runId}:${requestIdx}` key from a real run.
    const id = `synth:${patch.runId}:${patch.stepIdx}`;
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
    currentStepIdx = -1;
    currentStepName = "";
    currentJourneyName = undefined;
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
