import type { StepDef } from "@journey/core";
import { journeyResetEvent, stepPrerequest, stepTest } from "./stateThread.js";

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
  /** Request-scoped pre-request / test scripts (used by state threading). */
  event?: PostmanEvent[];
}

/** Folder-scoped variable — sub-journey inputs are serialized as these. */
export interface PostmanVariable {
  key: string;
  value: string;
}

/** A Postman script — `exec` is the source split into lines. */
export interface PostmanScript {
  type: "text/javascript";
  exec: string[];
}

/** A pre-request or test script bound to an item (request or folder). */
export interface PostmanEvent {
  listen: "prerequest" | "test";
  script: PostmanScript;
}

/**
 * A Postman folder. `item` holds requests and/or nested folders, so a
 * sub-journey invocation nests as a child folder among the parent's requests.
 * `event` carries folder-scoped pre-request / test scripts (used to translate
 * the sub-journey output cache — see `buildItems`).
 */
export interface PostmanFolder {
  name: string;
  item: Array<PostmanItem | PostmanFolder>;
  description?: string;
  variable?: PostmanVariable[];
  event?: PostmanEvent[];
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
      /**
       * Composite cache key `childName:resolvedKey`, resolved at export time.
       * Present only when the call opts into the cache (`cacheKey` set,
       * `cache !== "off"`); its presence emits the folder cache scripts.
       */
      cacheKey?: string;
      /** Per-call TTL in ms; absent → cache for the whole collection run. */
      cacheTtlMs?: number;
      /**
       * The call's `after(out)` / `assert(out)` hooks. Under `--thread-state`
       * they run on the sub-folder's terminal request, consuming the child's
       * `output(...)`.
       */
      after?: (out: unknown) => void | Promise<void>;
      assert?: (out: unknown) => void | Promise<void>;
    };

/** Note attached to every sub-journey folder's `description`. */
const SUB_JOURNEY_NOTE =
  "Sub-journey invocation. Postman's sidebar lists folders above sibling " +
  "requests, so a sub-journey invoked mid-pipeline looks reordered there — " +
  "execution order (Collection Runner / Newman) still follows the journey " +
  "pipeline.";

/** Appended to a cached sub-journey folder's `description`. */
const CACHE_NOTE =
  " Cached: a collection variable holds an expiry timestamp; while it is valid " +
  "this folder's requests are skipped (pm.execution.skipRequest), so a shared " +
  "sub-journey runs once per collection run. Reliable for single-request " +
  "sub-journeys; output values are not carried into Postman variables.";

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

/**
 * A value that did not resolve to something meaningful at export time. `env()`
 * is a `{{KEY}}` placeholder string during export, so a journey that coerces it
 * — e.g. `Number(env("LIMIT"))` — yields `NaN`. We can't recover the original
 * `{{KEY}}` once it has been through `Number()`, so such values are treated as
 * unresolved: dropped from the query string, left as a `{{name}}` placeholder
 * for a path param, rather than emitted as the literal `"NaN"` / `"null"`.
 */
function isUnresolved(v: unknown): boolean {
  return v == null || (typeof v === "number" && Number.isNaN(v));
}

function buildPostmanUrl(
  path: string,
  baseUrl: string,
  params: Record<string, string | number> | undefined,
  query: Record<string, string | number | boolean | undefined> | undefined,
): PostmanUrl {
  const substituted = path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const val = params?.[key];
    return isUnresolved(val) ? `{{${key}}}` : encodeURIComponent(String(val));
  });

  const raw = baseUrl + substituted;
  const segments = substituted.replace(/^\//, "").split("/").filter(Boolean);

  const queryItems = Object.entries(query ?? {})
    .filter(([, v]) => !isUnresolved(v))
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

async function buildRequestItem(s: StepDef, threadState = false): Promise<PostmanItem> {
  // Under state threading a dynamic (function) `params` is resolved at runtime
  // via pm.variables, so leave its path slots as `{{key}}` placeholders here
  // rather than baking the export-time value.
  const params =
    threadState && typeof s.options.params === "function"
      ? undefined
      : await tryResolve(s.options.params);
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

/** Collection-variable name for a composite cache key. */
function cacheVarName(cacheKey: string): string {
  return "__jc_" + cacheKey.replace(/[^A-Za-z0-9]+/g, "_");
}

/**
 * Folder-scoped scripts that translate the sub-journey output cache. The
 * prerequest skips the folder's request while a cache window is valid; the test
 * opens a window on the first (uncached) run. Both run once per request inside
 * the folder, so this is reliable for single-request sub-journeys (the common
 * auth case). The set is idempotent — re-running it for a skipped request never
 * extends the window — so it is correct whether or not Newman runs the folder
 * test for a skipped request.
 *
 * No TTL → a far-future sentinel, i.e. the entry never expires within a run.
 */
function cacheEvents(cacheKey: string, ttlMs: number | undefined): PostmanEvent[] {
  const v = cacheVarName(cacheKey);
  const expExpr = ttlMs !== undefined ? `Date.now() + ${ttlMs}` : "9999999999999";
  const vLit = JSON.stringify(v);
  return [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          `var __exp = pm.collectionVariables.get(${vLit});`,
          `if (__exp && Date.now() < Number(__exp)) {`,
          `  pm.execution.skipRequest();`,
          `}`,
        ],
      },
    },
    {
      listen: "test",
      script: {
        type: "text/javascript",
        exec: [
          `var __exp = pm.collectionVariables.get(${vLit});`,
          `if (!(__exp && Date.now() < Number(__exp))) {`,
          `  pm.collectionVariables.set(${vLit}, String(${expExpr}));`,
          `}`,
        ],
      },
    },
  ];
}

interface BuildOpts {
  threadState: boolean;
}

const SCRIPT = (exec: string[]): PostmanScript => ({ type: "text/javascript", exec });

/**
 * @param parentHooks  Under `--thread-state`, the enclosing sub-journey calls'
 *   `assert`/`after` hooks, attached to the terminal request of the sub-tree so
 *   they run against the child's `output(...)`. Inner-to-outer order.
 */
async function buildItems(
  nodes: ReadonlyArray<ExportNode>,
  opts: BuildOpts,
  parentHooks: ReadonlyArray<(out: unknown) => unknown> = [],
): Promise<Array<PostmanItem | PostmanFolder>> {
  const items: Array<PostmanItem | PostmanFolder> = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const isLast = i === nodes.length - 1;
    // Parent hooks bubble only to the terminal request of the whole sub-tree.
    const hooksHere = isLast ? parentHooks : [];

    if (node.kind === "step") {
      const item = await buildRequestItem(node.def, opts.threadState);
      if (opts.threadState) {
        const events: PostmanEvent[] = [];
        const pre = stepPrerequest(node.def);
        const test = stepTest(node.def, hooksHere);
        if (pre) events.push({ listen: "prerequest", script: SCRIPT(pre) });
        if (test) events.push({ listen: "test", script: SCRIPT(test) });
        if (events.length > 0) item.event = events;
      }
      items.push(item);
      continue;
    }

    // Sub-journey folder. Its own assert/after attach to its terminal child,
    // followed by any hooks bubbling from an enclosing sub when this folder is
    // itself the terminal node.
    const ownHooks = opts.threadState
      ? ([node.assert, node.after].filter(Boolean) as Array<(out: unknown) => unknown>)
      : [];
    const childHooks = [...ownHooks, ...hooksHere];

    const folder: PostmanFolder = {
      name: node.name,
      item: await buildItems(node.nodes, opts, childHooks),
      description: node.cacheKey ? SUB_JOURNEY_NOTE + CACHE_NOTE : SUB_JOURNEY_NOTE,
    };
    const variables = inputsToVariables(node.inputs);
    if (variables.length > 0) folder.variable = variables;
    if (node.cacheKey) folder.event = cacheEvents(node.cacheKey, node.cacheTtlMs);
    items.push(folder);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link buildFolder}. */
export interface BuildFolderOpts {
  /**
   * Experimental: thread journey closure-state through a collection variable so
   * sub-journey outputs and step-to-step state reach later requests. Emits
   * per-request pre-request/test scripts and a folder-level carrier reset.
   */
  threadState?: boolean;
}

/** Build the top-level Postman folder for a journey from its resolved tree. */
export async function buildFolder(
  name: string,
  nodes: ReadonlyArray<ExportNode>,
  opts: BuildFolderOpts = {},
): Promise<PostmanFolder> {
  const threadState = opts.threadState ?? false;
  const folder: PostmanFolder = { name, item: await buildItems(nodes, { threadState }) };
  if (threadState) {
    folder.event = [{ listen: "prerequest", script: SCRIPT(journeyResetEvent(name)) }];
  }
  return folder;
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
