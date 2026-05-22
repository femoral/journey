import type { StepDef } from "@journey/core";

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

/** Folder-scoped variable — sub-journey inputs are serialized as these. */
export interface PostmanVariable {
  key: string;
  value: string;
}

/**
 * A Postman folder. `item` holds requests and/or nested folders, so a
 * sub-journey invocation nests as a child folder among the parent's requests.
 */
export interface PostmanFolder {
  name: string;
  item: Array<PostmanItem | PostmanFolder>;
  description?: string;
  variable?: PostmanVariable[];
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
// Export pipeline tree
// ---------------------------------------------------------------------------

/**
 * The shape `buildFolder` walks. The CLI resolves a journey's `PipelineNode[]`
 * into this tree — recursing into each sub-journey via `collectSubPipeline` —
 * so the adapter stays free of a runtime dependency on `@journey/core`.
 */
export type ExportNode =
  | { kind: "step"; def: StepDef }
  | {
      kind: "sub";
      /** Timeline display label — the call's `name` override or the child journey's name. */
      name: string;
      /** Resolved call inputs, written as folder-scoped Postman variables. */
      inputs?: Record<string, unknown>;
      /** The child journey's own pipeline, already resolved. */
      nodes: ExportNode[];
    };

/** Note attached to every sub-journey folder's `description`. */
const SUB_JOURNEY_NOTE =
  "Sub-journey invocation. Postman's sidebar lists folders above sibling " +
  "requests, so a sub-journey invoked mid-pipeline looks reordered there — " +
  "execution order (Collection Runner / Newman) still follows the journey " +
  "pipeline. The Journey output cache (cacheKey / cacheTtlMs) is not " +
  "translated to Postman — this folder re-runs on every collection run.";

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
// Item builders
// ---------------------------------------------------------------------------

async function buildRequestItem(s: StepDef): Promise<PostmanItem> {
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

  return {
    name: s.name,
    request: {
      method: s.options.endpoint.method.toUpperCase(),
      header: headerItems,
      url,
      ...(postmanBody ? { body: postmanBody } : {}),
    },
  };
}

/** Serialize resolved sub-journey inputs as folder-scoped Postman variables. */
function inputsToVariables(inputs: Record<string, unknown> | undefined): PostmanVariable[] {
  if (!inputs || typeof inputs !== "object") return [];
  return Object.entries(inputs).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

async function buildItems(
  nodes: ReadonlyArray<ExportNode>,
): Promise<Array<PostmanItem | PostmanFolder>> {
  const items: Array<PostmanItem | PostmanFolder> = [];
  for (const node of nodes) {
    if (node.kind === "step") {
      items.push(await buildRequestItem(node.def));
      continue;
    }
    const folder: PostmanFolder = {
      name: node.name,
      item: await buildItems(node.nodes),
      description: SUB_JOURNEY_NOTE,
    };
    const variables = inputsToVariables(node.inputs);
    if (variables.length > 0) folder.variable = variables;
    items.push(folder);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build the top-level Postman folder for a journey from its resolved tree. */
export async function buildFolder(
  name: string,
  nodes: ReadonlyArray<ExportNode>,
): Promise<PostmanFolder> {
  return { name, item: await buildItems(nodes) };
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
