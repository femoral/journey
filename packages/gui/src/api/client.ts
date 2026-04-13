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

export interface EndpointSummary {
  name: string;
  method: string;
  path: string;
  operationId?: string;
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
};
