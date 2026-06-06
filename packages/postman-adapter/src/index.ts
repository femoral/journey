import type { StepDef } from "@journey/core";
import {
  cacheExpirySet,
  cacheHitPrerequest,
  cacheSkipPrerequest,
  collectionResetScript,
  journeyResetEvent,
  stepPrerequest,
  stepTest,
  subInputSeed,
  type CacheStore,
} from "./stateThread.js";

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
      /**
       * Under `--thread-state`, a sub-journey call with **dynamic** `inputs`
       * (`() => ({ … })`) carries the closure source plus the child body's
       * parameter name. The folder pre-request re-runs the closure against the
       * carrier and seeds the result under `inputParam` so the child's own
       * closures resolve `input.*`. Absent for static / `env()` inputs.
       */
      inputsSrc?: string;
      inputParam?: string;
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
  "sub-journey runs once per collection run. The window opens on the child's " +
  "terminal request, so a multi-request child runs fully on the cold pass and " +
  "skips as a whole on a hit. Without --thread-state the child's output() is " +
  "not carried into Postman variables; with it, a hit still delivers the output.";

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
  // Under state threading a dynamic (function) option is recomputed at runtime
  // by the pre-request script, so bake a placeholder the script fills rather
  // than the export-time value: path slots stay `{{key}}`, query values become
  // `{{__q_<key>}}` (keys discovered from the export-time run), and a dynamic
  // body becomes the raw placeholder `{{__journey_body}}`.
  const params =
    threadState && typeof s.options.params === "function"
      ? undefined
      : await tryResolve(s.options.params);
  let query = await tryResolve(s.options.query);
  if (threadState && typeof s.options.query === "function" && query && typeof query === "object") {
    query = Object.fromEntries(Object.keys(query).map((k) => [k, `{{__q_${k}}}`]));
  }
  const headers = await tryResolve(s.options.headers);
  const body =
    threadState && typeof s.options.body === "function"
      ? "{{__journey_body}}"
      : await tryResolve(s.options.body);

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

interface BuildOpts {
  threadState: boolean;
  /** Enforce `expect()` failures as red `pm.test`s (default). False = legacy swallow. */
  strict: boolean;
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
  cacheStore?: CacheStore,
): Promise<Array<PostmanItem | PostmanFolder>> {
  const items: Array<PostmanItem | PostmanFolder> = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const isLast = i === nodes.length - 1;
    // Parent hooks and the cache store bubble only to the terminal request.
    const hooksHere = isLast ? parentHooks : [];
    const storeHere = isLast ? cacheStore : undefined;

    if (node.kind === "step") {
      const item = await buildRequestItem(node.def, opts.threadState);
      if (opts.threadState) {
        const events: PostmanEvent[] = [];
        const pre = stepPrerequest(node.def);
        const test = stepTest(node.def, hooksHere, storeHere, opts.strict);
        if (pre) events.push({ listen: "prerequest", script: SCRIPT(pre) });
        if (test) events.push({ listen: "test", script: SCRIPT(test) });
        if (events.length > 0) item.event = events;
      } else if (storeHere) {
        // Non-threaded terminal request of a cached sub — open the cache window
        // here (not in a folder test) so a multi-request child runs fully cold.
        item.event = [{ listen: "test", script: SCRIPT(cacheExpirySet(storeHere)) }];
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

    // A cached sub opens its window on its terminal request's test (Newman runs
    // folder tests before request tests, and a folder test would open it
    // mid-folder — over-skipping a multi-request child and, when threaded,
    // storing the output before the child set it). The folder pre-request only
    // checks the window: threaded restores the output + runs hooks, plain skips.
    let childStore = storeHere;
    // Folder pre-request exec, assembled in run order: seed the child's dynamic
    // inputs first (it saves the carrier), then the cache logic (which re-reads
    // the carrier, so it observes the seeded inputs).
    const folderPre: string[] = [];

    if (opts.threadState && node.inputParam && node.inputsSrc) {
      folderPre.push(...subInputSeed(node.inputParam, node.inputsSrc));
    }

    if (node.cacheKey) {
      const safe = node.cacheKey.replace(/[^A-Za-z0-9]+/g, "_");
      const store: CacheStore = {
        jcVar: `__jc_${safe}`,
        jcvVar: `__jcv_${safe}`,
        expExpr:
          node.cacheTtlMs !== undefined ? `Date.now() + ${node.cacheTtlMs}` : "9999999999999",
      };
      childStore = store;
      folderPre.push(
        ...(opts.threadState
          ? cacheHitPrerequest(store, ownHooks, opts.strict)
          : cacheSkipPrerequest(store)),
      );
    }

    const folder: PostmanFolder = {
      name: node.name,
      item: await buildItems(node.nodes, opts, childHooks, childStore),
      description: node.cacheKey ? SUB_JOURNEY_NOTE + CACHE_NOTE : SUB_JOURNEY_NOTE,
    };
    const variables = inputsToVariables(node.inputs);
    if (variables.length > 0) folder.variable = variables;
    if (folderPre.length > 0) folder.event = [{ listen: "prerequest", script: SCRIPT(folderPre) }];
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
  /**
   * With `threadState`: emit non-enforcing assertions (legacy swallow-all) so a
   * failing `expect()` stays a console line instead of a red `pm.test`. Off by
   * default — threaded assertions enforce. No effect without `threadState`.
   */
  lenient?: boolean;
}

/** Build the top-level Postman folder for a journey from its resolved tree. */
export async function buildFolder(
  name: string,
  nodes: ReadonlyArray<ExportNode>,
  opts: BuildFolderOpts = {},
): Promise<PostmanFolder> {
  const threadState = opts.threadState ?? false;
  const strict = threadState && !opts.lenient;
  const folder: PostmanFolder = { name, item: await buildItems(nodes, { threadState, strict }) };
  if (threadState) {
    folder.event = [{ listen: "prerequest", script: SCRIPT(journeyResetEvent(name)) }];
  }
  return folder;
}

/** Options for {@link buildCollection}. */
export interface BuildCollectionOpts {
  /**
   * Prepend a skipped reset request that clears the threaded carrier + cache
   * slots at the start of a run, so a Postman Runner re-run starts cold (Postman
   * persists collection variables across runs; Newman does not). Set when
   * exporting with `--thread-state`.
   */
  reset?: boolean;
}

/**
 * The reset, as a **folder** at the head of the collection holding one skipped
 * request — see {@link collectionResetScript}. Wrapped in a folder (rather than a
 * bare top-level request) because the Postman app's sidebar fails to render a
 * collection whose root mixes a request item with folders; Newman tolerates it,
 * the desktop app shows the collection as empty. Depth-first execution still runs
 * this folder's request first.
 */
function resetFolder(): PostmanFolder {
  return {
    name: "Journey: reset state (auto)",
    item: [
      {
        name: "reset",
        event: [{ listen: "prerequest", script: SCRIPT(collectionResetScript()) }],
        request: {
          method: "GET",
          header: [],
          url: {
            raw: "https://journey.invalid/reset",
            host: ["journey", "invalid"],
            path: ["reset"],
            query: [],
          },
        },
      },
    ],
  };
}

export function buildCollection(
  name: string,
  folders: PostmanFolder[],
  opts: BuildCollectionOpts = {},
): PostmanCollection {
  return {
    info: {
      name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: opts.reset ? [resetFolder(), ...folders] : [...folders],
  };
}

export function buildEnvironment(name: string, values: Record<string, string>): PostmanEnvironment {
  return {
    name,
    values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true })),
  };
}
