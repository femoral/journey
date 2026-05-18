import type { JourneyDef, StepDef } from "@journey/core";

// ---------------------------------------------------------------------------
// Postman Collection v2.1.0 types
// ---------------------------------------------------------------------------

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query: Array<{ key: string; value: string }>;
}

export interface PostmanHeader {
  key: string;
  value: string;
}

export interface PostmanBody {
  mode: "raw";
  raw: string;
  options: { raw: { language: "json" } };
}

export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  body?: PostmanBody;
}

export interface PostmanItem {
  name: string;
  request: PostmanRequest;
}

export interface PostmanFolder {
  name: string;
  item: PostmanItem[];
}

export interface PostmanInfo {
  name: string;
  schema: string;
}

export interface PostmanCollection {
  info: PostmanInfo;
  item: PostmanFolder[];
}

export interface PostmanEnvValue {
  key: string;
  value: string;
  enabled: boolean;
}

export interface PostmanEnvironment {
  name: string;
  values: PostmanEnvValue[];
}

// ---------------------------------------------------------------------------
// Env proxy — env("KEY") returns "{{KEY}}" during step collection
// ---------------------------------------------------------------------------

export const ENV_PROXY = new Proxy({} as Record<string, string>, {
  get(_target, key: string) {
    return `{{${key}}}`;
  },
  has() {
    return true;
  },
});

// ---------------------------------------------------------------------------
// Lazy value resolution
// ---------------------------------------------------------------------------

async function tryResolve<T>(v: T | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  if (v === undefined) return undefined;
  if (typeof v !== "function") return v;
  try {
    return await (v as () => T | Promise<T>)();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

function buildPostmanUrl(
  path: string,
  baseUrl: string,
  params: Record<string, string | number> | undefined,
  query: Record<string, string | number | boolean | undefined> | undefined,
): PostmanUrl {
  const substituted = path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const val = params?.[key];
    return val != null ? encodeURIComponent(String(val)) : `{{${key}}}`;
  });

  const raw = baseUrl + substituted;
  const segments = substituted.replace(/^\//, "").split("/").filter(Boolean);

  const queryItems = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => ({ key, value: String(value) }));

  return {
    raw: queryItems.length
      ? `${raw}?${queryItems.map((q) => `${q.key}=${q.value}`).join("&")}`
      : raw,
    host: [baseUrl],
    path: segments,
    query: queryItems,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildFolder(
  def: JourneyDef,
  steps: ReadonlyArray<StepDef>,
): Promise<PostmanFolder> {
  const items: PostmanItem[] = [];

  for (const s of steps) {
    const params = await tryResolve(s.options.params);
    const query = await tryResolve(s.options.query);
    const headers = await tryResolve(s.options.headers);
    const body = await tryResolve(s.options.body);

    const baseUrl = (s.options.endpoint as { baseUrl?: string }).baseUrl ?? "{{BASE_URL}}";
    const url = buildPostmanUrl(s.options.endpoint.path, baseUrl, params, query);

    const headerItems: PostmanHeader[] = Object.entries(headers ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));

    let postmanBody: PostmanBody | undefined;
    if (body !== undefined) {
      postmanBody = {
        mode: "raw",
        raw: typeof body === "string" ? body : JSON.stringify(body, null, 2),
        options: { raw: { language: "json" } },
      };
    }

    items.push({
      name: s.name,
      request: {
        method: s.options.endpoint.method.toUpperCase(),
        header: headerItems,
        url,
        ...(postmanBody ? { body: postmanBody } : {}),
      },
    });
  }

  return { name: def.name, item: items };
}

export function buildCollection(name: string, folders: PostmanFolder[]): PostmanCollection {
  return {
    info: {
      name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: folders,
  };
}

export function buildEnvironment(name: string, values: Record<string, string>): PostmanEnvironment {
  return {
    name,
    values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true })),
  };
}
