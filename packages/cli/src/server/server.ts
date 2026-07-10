import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  JourneyConfigSchema,
  createSubJourneyCache,
  listRuns,
  loadConfig,
  listEnvironments,
  readRun,
  resolveConfigPaths,
  type CacheMode,
  type LoadedConfig,
  type SubJourneyCache,
} from "@usejourney/core";
import { collectOperations, generate, loadSpec, operationName } from "@usejourney/codegen";
import { runJourneyFile } from "./runner.js";
import { planJourneyFile } from "./planner.js";
import { computeSpecDrift } from "./specDrift.js";
import {
  abortRun,
  clearAbortController,
  getBroadcaster,
  newRunId,
  registerAbortController,
  registerBroadcaster,
  type RunBroadcaster,
} from "./runBroadcaster.js";

export interface StartServerOptions {
  projectDir: string;
  host?: string;
  port?: number;
  /** When true, journey runs triggered through the API log every request. */
  debug?: boolean;
  /** Sub-journey output cache lifetime; defaults to `process`. */
  cache?: CacheMode;
  /** Default TTL (ms) for sub-journey cache entries. */
  cacheTtlMs?: number;
  /** Default request timeout (ms) for journey runs triggered via the API; 0 disables. */
  timeoutMs?: number;
}

/**
 * Builds a per-run cache resolver for the given mode. `process` returns one
 * shared in-memory cache for the server's lifetime (auth tokens stay hot
 * across runs); `run` returns a fresh cache per run; `disk` is rooted at the
 * current project's `.journey/cache/sub-journey/`; `off` returns none.
 */
function makeCacheResolver(mode: CacheMode): (projectDir: string) => SubJourneyCache | undefined {
  let processCache: SubJourneyCache | undefined;
  let processInit = false;
  return (projectDir: string) => {
    const diskDir = join(projectDir, ".journey", "cache", "sub-journey");
    if (mode === "process") {
      if (!processInit) {
        processCache = createSubJourneyCache("process", { diskDir });
        processInit = true;
      }
      return processCache;
    }
    return createSubJourneyCache(mode, { diskDir });
  };
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

async function countEndpoints(generatedDir: string): Promise<number> {
  try {
    await stat(generatedDir);
  } catch {
    return 0;
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = await readFile(join(generatedDir, "endpoints.ts"), "utf8");
    const matches = content.match(/^\s{2}[a-zA-Z_$][a-zA-Z0-9_$]*:\s*\{/gm);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

async function countJourneys(journeysDir: string): Promise<number> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(journeysDir);
    return entries.filter((e) => e.endsWith(".journey.ts")).length;
  } catch {
    return 0;
  }
}

export async function buildProjectSummary(loaded: LoadedConfig): Promise<unknown> {
  const paths = resolveConfigPaths(loaded);
  const [endpoints, journeys, envs] = await Promise.all([
    countEndpoints(paths.generatedDir),
    countJourneys(paths.journeysDir),
    listEnvironments(paths.environmentsDir),
  ]);
  return {
    projectDir: loaded.projectDir,
    config: {
      ...(loaded.config.name !== undefined ? { name: loaded.config.name } : {}),
      spec: loaded.config.spec,
      ...(loaded.config.baseUrl !== undefined ? { baseUrl: loaded.config.baseUrl } : {}),
      ...(loaded.config.defaultEnvironment !== undefined
        ? { defaultEnvironment: loaded.config.defaultEnvironment }
        : {}),
      tlsRejectUnauthorized: loaded.config.tlsRejectUnauthorized,
    },
    counts: {
      endpoints,
      journeys,
      environments: envs.length,
    },
  };
}

const PATCHABLE_CONFIG_KEYS = ["tlsRejectUnauthorized"] as const;
type PatchableKey = (typeof PATCHABLE_CONFIG_KEYS)[number];

/**
 * Merge a partial config patch into the raw journey.config.json on disk.
 * Only whitelisted keys (currently `tlsRejectUnauthorized`) may be patched
 * from the API so a misbehaving client can't rewrite paths or the spec
 * filename. The full merged document is validated against
 * JourneyConfigSchema before being written.
 */
async function patchProjectConfig(
  projectDir: string,
  patch: Record<string, unknown>,
): Promise<unknown> {
  const configPath = join(projectDir, "journey.config.json");
  const raw = await readFile(configPath, "utf8");
  const current = JSON.parse(raw) as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (!(PATCHABLE_CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new Error(`config key "${key}" is not patchable via the API`);
    }
  }
  const merged: Record<string, unknown> = { ...current };
  for (const key of PATCHABLE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      merged[key as PatchableKey] = patch[key];
    }
  }
  const result = JourneyConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`config patch failed validation: ${issues}`);
  }
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return await buildProjectSummary(await loadConfig(projectDir));
}

interface TreeNode {
  name: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

async function buildTree(root: string): Promise<TreeNode[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const out: TreeNode[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        out.push({
          name: entry.name,
          type: "dir",
          children: await buildTree(join(root, entry.name)),
        });
      } else {
        out.push({ name: entry.name, type: "file" });
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function buildProjectTree(loaded: LoadedConfig): Promise<unknown> {
  const paths = resolveConfigPaths(loaded);
  const [journeys, environments, generated] = await Promise.all([
    buildTree(paths.journeysDir),
    buildTree(paths.environmentsDir),
    buildTree(paths.generatedDir),
  ]);
  return {
    projectDir: loaded.projectDir,
    sections: [
      { label: "journeys", dir: paths.journeysDir, children: journeys },
      { label: "environments", dir: paths.environmentsDir, children: environments },
      { label: "generated", dir: paths.generatedDir, children: generated },
    ],
  };
}

interface ParameterInfo {
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  description?: string;
}

interface EndpointSummary {
  name: string;
  method: string;
  path: string;
  operationId?: string;
  parameters: ParameterInfo[];
}

type RawParam = {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  description?: unknown;
};

function normalizeParameters(params: unknown): ParameterInfo[] {
  if (!Array.isArray(params)) return [];
  const out: ParameterInfo[] = [];
  for (const p of params as RawParam[]) {
    if (!p || typeof p !== "object") continue;
    const loc = p.in;
    if (loc !== "query" && loc !== "path" && loc !== "header") continue;
    if (typeof p.name !== "string") continue;
    const entry: ParameterInfo = {
      name: p.name,
      in: loc,
      required: p.required === true || loc === "path",
    };
    if (typeof p.description === "string") entry.description = p.description;
    out.push(entry);
  }
  return out;
}

async function readEndpoints(specPath: string): Promise<EndpointSummary[]> {
  try {
    const doc = await loadSpec(specPath);
    const ops = collectOperations(doc);
    const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const out: EndpointSummary[] = [];
    for (const op of ops) {
      const pathItem = paths[op.path];
      const pathLevel = normalizeParameters((pathItem as { parameters?: unknown })?.parameters);
      const opLevel = normalizeParameters(
        (pathItem?.[op.method] as { parameters?: unknown } | undefined)?.parameters,
      );
      // Op-level params override path-level params with the same name+in.
      const merged = new Map<string, ParameterInfo>();
      for (const p of pathLevel) merged.set(`${p.in}:${p.name}`, p);
      for (const p of opLevel) merged.set(`${p.in}:${p.name}`, p);

      const rawOp = pathItem?.[op.method] as { operationId?: unknown } | undefined;
      const rawOperationId = typeof rawOp?.operationId === "string" ? rawOp.operationId : undefined;
      const entry: EndpointSummary = {
        name: operationName(op.method, op.path, rawOperationId),
        method: op.method.toUpperCase(),
        path: op.path,
        parameters: [...merged.values()],
      };
      if (rawOperationId) entry.operationId = rawOperationId;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

interface ProxyRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

async function proxyRequest(body: ProxyRequest): Promise<unknown> {
  if (!body.method || !body.url) throw new Error("method and url are required");
  const init: RequestInit = {
    method: body.method,
    ...(body.headers ? { headers: body.headers } : {}),
  };
  if (body.body !== undefined) {
    init.body = typeof body.body === "string" ? body.body : JSON.stringify(body.body);
  }
  const started = Date.now();
  const res = await fetch(body.url, init);
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  const ct = res.headers.get("content-type") ?? "";
  const parsed: unknown = ct.includes("json")
    ? await res.json().catch(() => null)
    : await res.text();
  return {
    status: res.status,
    headers: respHeaders,
    body: parsed,
    durationMs: Date.now() - started,
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  projectDir: string,
  debug: boolean,
  setProjectDir: (next: string) => void,
  cacheFor: (projectDir: string) => SubJourneyCache | undefined,
  cacheTtlMs: number | undefined,
  timeoutMs: number | undefined,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }
  try {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/api/project" && req.method === "GET") {
      const loaded = await loadConfig(projectDir);
      send(res, 200, await buildProjectSummary(loaded));
      return;
    }
    if (url.pathname === "/api/project/open" && req.method === "POST") {
      const body = (await readRequestBody(req)) as { path?: unknown } | undefined;
      const path = body?.path;
      if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
        send(res, 400, { error: "body.path must be an absolute filesystem path" });
        return;
      }
      let loaded: LoadedConfig;
      try {
        loaded = await loadConfig(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send(res, 400, { error: `Not a Journey project: ${message}` });
        return;
      }
      setProjectDir(loaded.projectDir);
      send(res, 200, await buildProjectSummary(loaded));
      return;
    }
    if (url.pathname === "/api/project/config" && req.method === "PATCH") {
      const body = (await readRequestBody(req)) as Record<string, unknown> | undefined;
      if (!body || typeof body !== "object") {
        send(res, 400, { error: "request body must be a JSON object" });
        return;
      }
      send(res, 200, await patchProjectConfig(projectDir, body));
      return;
    }
    if (url.pathname === "/api/tree" && req.method === "GET") {
      const loaded = await loadConfig(projectDir);
      send(res, 200, await buildProjectTree(loaded));
      return;
    }
    if (url.pathname === "/api/endpoints" && req.method === "GET") {
      const loaded = await loadConfig(projectDir);
      const { specPath } = resolveConfigPaths(loaded);
      const endpoints = await readEndpoints(specPath);
      send(res, 200, { baseUrl: loaded.config.baseUrl, endpoints });
      return;
    }
    if (url.pathname === "/api/request" && req.method === "POST") {
      const body = (await readRequestBody(req)) as ProxyRequest;
      send(res, 200, await proxyRequest(body));
      return;
    }
    const journeyFileMatch = url.pathname.match(/^\/api\/journeys\/([^/]+)$/);
    if (journeyFileMatch) {
      const file = decodeURIComponent(journeyFileMatch[1]!);
      if (!/^[a-zA-Z0-9_.-]+\.journey\.ts$/.test(file)) {
        send(res, 400, { error: "invalid journey filename" });
        return;
      }
      const loaded = await loadConfig(projectDir);
      const { journeysDir } = resolveConfigPaths(loaded);
      const filePath = join(journeysDir, file);
      if (req.method === "GET") {
        try {
          const source = await readFile(filePath, "utf8");
          send(res, 200, { file, source });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            send(res, 404, { error: "not found" });
          } else throw err;
        }
        return;
      }
      if (req.method === "PUT") {
        const body = ((await readRequestBody(req)) ?? {}) as { source?: string };
        if (typeof body.source !== "string") {
          send(res, 400, { error: "body.source must be a string" });
          return;
        }
        const { mkdir } = await import("node:fs/promises");
        await mkdir(journeysDir, { recursive: true });
        await writeFile(filePath, body.source, "utf8");
        send(res, 200, { file, bytes: Buffer.byteLength(body.source, "utf8") });
        return;
      }
      if (req.method === "DELETE") {
        try {
          await unlink(filePath);
          send(res, 200, { file, deleted: true });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            send(res, 404, { error: "not found" });
          } else throw err;
        }
        return;
      }
    }
    if (url.pathname === "/api/journeys" && req.method === "GET") {
      const loaded = await loadConfig(projectDir);
      const { journeysDir } = resolveConfigPaths(loaded);
      const { readdir } = await import("node:fs/promises");
      let files: string[] = [];
      try {
        const entries = await readdir(journeysDir);
        files = entries.filter((e) => e.endsWith(".journey.ts")).sort();
      } catch {
        files = [];
      }
      send(res, 200, { journeysDir, files });
      return;
    }
    if (url.pathname === "/api/environments" && req.method === "GET") {
      const loaded = await loadConfig(projectDir);
      const { environmentsDir } = resolveConfigPaths(loaded);
      const names = await listEnvironments(environmentsDir);
      const out: Array<{ name: string; values: Record<string, string> }> = [];
      for (const name of names) {
        try {
          const raw = await readFile(join(environmentsDir, `${name}.json`), "utf8");
          const values = JSON.parse(raw) as Record<string, unknown>;
          const normalized: Record<string, string> = {};
          for (const [k, v] of Object.entries(values))
            normalized[k] = typeof v === "string" ? v : JSON.stringify(v);
          out.push({ name, values: normalized });
        } catch {
          out.push({ name, values: {} });
        }
      }
      send(res, 200, { defaultEnvironment: loaded.config.defaultEnvironment, environments: out });
      return;
    }
    const envMatch = url.pathname.match(/^\/api\/environments\/([^/]+)$/);
    if (envMatch) {
      const name = decodeURIComponent(envMatch[1]!);
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
        send(res, 400, { error: "invalid environment name" });
        return;
      }
      const loaded = await loadConfig(projectDir);
      const { environmentsDir } = resolveConfigPaths(loaded);
      const file = join(environmentsDir, `${name}.json`);
      if (req.method === "PUT") {
        const body = (await readRequestBody(req)) as Record<string, string> | undefined;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          send(res, 400, { error: "body must be a JSON object" });
          return;
        }
        await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
        send(res, 200, { name, values: body });
        return;
      }
      if (req.method === "DELETE") {
        try {
          await unlink(file);
          send(res, 200, { name, deleted: true });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            send(res, 404, { error: "not found" });
          } else {
            throw err;
          }
        }
        return;
      }
    }
    const journeyPlanMatch = url.pathname.match(/^\/api\/journeys\/([^/]+)\/plan$/);
    if (journeyPlanMatch && req.method === "GET") {
      const file = decodeURIComponent(journeyPlanMatch[1]!);
      const env = url.searchParams.get("env") ?? undefined;
      const loaded = await loadConfig(projectDir);
      const { journeysDir, environmentsDir } = resolveConfigPaths(loaded);
      try {
        const journeys = await planJourneyFile({
          loaded,
          journeysDir,
          environmentsDir,
          file,
          ...(env !== undefined ? { env } : {}),
        });
        send(res, 200, { journeys });
      } catch (err) {
        // Plan discovery is best-effort — a load failure (bad env, body throws)
        // is not fatal; the GUI falls back to its source parse.
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    const runMatch = url.pathname.match(/^\/api\/journeys\/([^/]+)\/run$/);
    if (runMatch && req.method === "POST") {
      const file = decodeURIComponent(runMatch[1]!);
      const body = ((await readRequestBody(req)) ?? {}) as {
        env?: string;
        stream?: boolean;
        upToStepIdx?: number;
      };
      const loaded = await loadConfig(projectDir);
      const { journeysDir, environmentsDir } = resolveConfigPaths(loaded);
      const runId = newRunId();
      const broadcaster = registerBroadcaster(runId);
      const abortController = new AbortController();
      registerAbortController(runId, abortController);
      const subJourneyCache = cacheFor(projectDir);
      const runPromise = runJourneyFile({
        loaded,
        journeysDir,
        environmentsDir,
        file,
        runId,
        logger: broadcaster.toLogger(),
        signal: abortController.signal,
        ...(body.env !== undefined ? { env: body.env } : {}),
        ...(typeof body.upToStepIdx === "number" ? { upToStepIdx: body.upToStepIdx } : {}),
        ...(debug ? { debug: true } : {}),
        ...(subJourneyCache !== undefined ? { subJourneyCache } : {}),
        ...(cacheTtlMs !== undefined ? { subJourneyCacheTtlMs: cacheTtlMs } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
      if (body.stream) {
        // Fire-and-forget: the broadcaster owns event delivery from here. We
        // still observe the promise so unhandled rejections are captured.
        runPromise
          .catch((err) => {
            broadcaster.fail(err instanceof Error ? err.message : String(err));
          })
          .finally(() => clearAbortController(runId));
        send(res, 202, { runId });
        return;
      }
      try {
        const results = await runPromise;
        send(res, 200, { runId, results });
      } catch (err) {
        broadcaster.fail(err instanceof Error ? err.message : String(err));
        send(res, 500, { runId, error: err instanceof Error ? err.message : String(err) });
      } finally {
        clearAbortController(runId);
      }
      return;
    }
    const runAbortMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/abort$/);
    if (runAbortMatch && req.method === "POST") {
      const id = decodeURIComponent(runAbortMatch[1]!);
      if (abortRun(id)) {
        send(res, 202, { runId: id, aborted: true });
      } else {
        send(res, 404, { error: "unknown or completed run" });
      }
      return;
    }
    if (url.pathname === "/api/runs" && req.method === "GET") {
      const cacheDir = join(projectDir, ".journey", "cache");
      send(res, 200, await listRuns(cacheDir));
      return;
    }
    const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (runEventsMatch && req.method === "GET") {
      const id = decodeURIComponent(runEventsMatch[1]!);
      const broadcaster: RunBroadcaster | undefined = getBroadcaster(id);
      if (!broadcaster) {
        send(res, 404, { error: "unknown run (already evicted or never started)" });
        return;
      }
      broadcaster.subscribe(res);
      return;
    }
    const runIdMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runIdMatch && req.method === "GET") {
      const id = decodeURIComponent(runIdMatch[1]!);
      const cacheDir = join(projectDir, ".journey", "cache");
      const record = await readRun(cacheDir, id);
      if (!record) {
        send(res, 404, { error: "run not found" });
        return;
      }
      send(res, 200, record);
      return;
    }
    if (url.pathname === "/api/spec/drift" && req.method === "GET") {
      const loaded = await loadConfig(projectDir);
      const { specPath, generatedDir } = resolveConfigPaths(loaded);
      send(res, 200, await computeSpecDrift(specPath, generatedDir));
      return;
    }
    if (url.pathname === "/api/generate" && req.method === "POST") {
      const loaded = await loadConfig(projectDir);
      const { specPath, generatedDir } = resolveConfigPaths(loaded);
      try {
        const result = await generate({ specPath, outDir: generatedDir });
        send(res, 200, {
          operationCount: result.operationCount,
          endpointsPath: result.endpointsPath,
          modelsPath: result.modelsPath,
        });
      } catch (err) {
        send(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (url.pathname === "/api/health") {
      send(res, 200, { ok: true });
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 5181;

  const state = { projectDir: opts.projectDir };
  const setProjectDir = (next: string): void => {
    state.projectDir = next;
  };

  const cacheFor = makeCacheResolver(opts.cache ?? "process");

  const http: Server = createServer((req, res) => {
    void route(
      req,
      res,
      state.projectDir,
      opts.debug ?? false,
      setProjectDir,
      cacheFor,
      opts.cacheTtlMs,
      opts.timeoutMs,
    );
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => resolve());
  });

  const addr = http.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}
