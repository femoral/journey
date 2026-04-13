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

export const api = {
  getProject: () => req<ProjectSummary>("/api/project"),
};
