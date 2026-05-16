export interface ProjectSummary {
  projectDir: string;
  config: {
    name?: string;
    spec: string;
    baseUrl?: string;
    defaultEnvironment?: string;
    tlsRejectUnauthorized: boolean;
  };
  counts: {
    journeys: number;
    environments: number;
    endpoints: number;
  };
}

export interface ProjectConfigPatch {
  tlsRejectUnauthorized?: boolean;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} → ${res.status}${text ? `: ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export interface TreeNode {
  name: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

export interface ProjectTree {
  projectDir: string;
  sections: Array<{ label: string; dir: string; children: TreeNode[] }>;
}

export interface ParameterInfo {
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  description?: string;
}

export interface EndpointSummary {
  name: string;
  method: string;
  path: string;
  operationId?: string;
  parameters: ParameterInfo[];
}

export interface EndpointListResponse {
  baseUrl?: string;
  endpoints: EndpointSummary[];
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}

export interface ProxyRequestBody {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface JourneyListResponse {
  journeysDir: string;
  files: string[];
}

export interface StepResult {
  name: string;
  ok: boolean;
  request?: { method: string; url: string };
  response?: { status: number; headers: Record<string, string>; body: unknown };
  error?: string;
  durationMs: number;
}

export interface JourneyResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
  durationMs: number;
}

export interface RunJourneyResponse {
  runId: string;
  results: JourneyResult[];
}

/** Streaming start — server returns immediately with the allocated runId. */
export interface StartJourneyRunResponse {
  runId: string;
}

export interface Environment {
  name: string;
  values: Record<string, string>;
}

export interface EnvironmentsResponse {
  defaultEnvironment?: string;
  environments: Environment[];
}

export interface RunSummary {
  id: string;
  timestamp: string;
  journeyNames: string[];
  ok: boolean;
  durationMs: number;
  stepCount: number;
}

export interface RunDetail {
  id: string;
  timestamp: string;
  results: JourneyResult[];
}

export const api = {
  getProject: () => req<ProjectSummary>("/api/project"),
  openProject: (path: string) =>
    req<ProjectSummary>("/api/project/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  patchProjectConfig: (patch: ProjectConfigPatch) =>
    req<ProjectSummary>("/api/project/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  getTree: () => req<ProjectTree>("/api/tree"),
  getEndpoints: () => req<EndpointListResponse>("/api/endpoints"),
  sendRequest: (body: ProxyRequestBody) =>
    req<ProxyResponse>("/api/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  getJourneys: () => req<JourneyListResponse>("/api/journeys"),
  runJourney: (file: string, env?: string) =>
    req<RunJourneyResponse>(`/api/journeys/${encodeURIComponent(file)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(env ? { env } : {}),
    }),
  /**
   * Non-blocking run kickoff. Server returns 202 with the allocated runId
   * immediately; subscribe to /api/runs/:runId/events (via runEvents.ts) to
   * receive live step events. Use with the console store for streaming UX.
   *
   * Pass `upToStepIdx` to stop after the Nth absolute step — used by the
   * "Run only this step" affordance in the Journeys timeline.
   */
  startJourneyRun: (file: string, opts: { env?: string; upToStepIdx?: number } = {}) =>
    req<StartJourneyRunResponse>(`/api/journeys/${encodeURIComponent(file)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stream: true,
        ...(opts.env !== undefined ? { env: opts.env } : {}),
        ...(opts.upToStepIdx !== undefined ? { upToStepIdx: opts.upToStepIdx } : {}),
      }),
    }),
  getEnvironments: () => req<EnvironmentsResponse>("/api/environments"),
  saveEnvironment: (name: string, values: Record<string, string>) =>
    req<Environment>(`/api/environments/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    }),
  deleteEnvironment: (name: string) =>
    req<{ name: string; deleted: true }>(`/api/environments/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  getJourneySource: (file: string) =>
    req<{ file: string; source: string }>(`/api/journeys/${encodeURIComponent(file)}`),
  saveJourneySource: (file: string, source: string) =>
    req<{ file: string; bytes: number }>(`/api/journeys/${encodeURIComponent(file)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    }),
  deleteJourney: (file: string) =>
    req<{ file: string; deleted: true }>(`/api/journeys/${encodeURIComponent(file)}`, {
      method: "DELETE",
    }),
  listRuns: () => req<RunSummary[]>("/api/runs"),
  getRun: (id: string) => req<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  getSpecDrift: () => req<SpecDrift>("/api/spec/drift"),
  regenerate: () =>
    req<{ operationCount: number; modelsPath: string; endpointsPath: string }>("/api/generate", {
      method: "POST",
    }),
};

export interface DriftEndpoint {
  method: string;
  path: string;
  operationId: string;
}

export interface SpecDrift {
  added: DriftEndpoint[];
  removed: DriftEndpoint[];
  hasGenerated: boolean;
  hasSpec: boolean;
  count: number;
}
