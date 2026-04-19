export interface ProjectSummary {
  projectDir: string;
  config: {
    name?: string;
    spec: string;
    baseUrl?: string;
    defaultEnvironment?: string;
  };
  counts: {
    journeys: number;
    environments: number;
    endpoints: number;
  };
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
  results: JourneyResult[];
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
}

export interface RunDetail {
  id: string;
  timestamp: string;
  results: JourneyResult[];
}

export const api = {
  getProject: () => req<ProjectSummary>("/api/project"),
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
};
