import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, listEnvironments, resolveConfigPaths, type LoadedConfig } from "@journey/core";
import { collectOperations, loadSpec, operationName } from "@journey/codegen";
import { runJourneyFile } from "./runner.js";

export interface StartServerOptions {
  projectDir: string;
  host?: string;
  port?: number;
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
    },
    counts: {
      endpoints,
      journeys,
      environments: envs.length,
    },
  };
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

async function route(req: IncomingMessage, res: ServerResponse, projectDir: string): Promise<void> {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
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
          for (const [k, v] of Object.entries(values)) normalized[k] = typeof v === "string" ? v : JSON.stringify(v);
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
    const runMatch = url.pathname.match(/^\/api\/journeys\/([^/]+)\/run$/);
    if (runMatch && req.method === "POST") {
      const file = decodeURIComponent(runMatch[1]!);
      const body = ((await readRequestBody(req)) ?? {}) as { env?: string };
      const loaded = await loadConfig(projectDir);
      const { journeysDir, environmentsDir } = resolveConfigPaths(loaded);
      const results = await runJourneyFile({
        loaded,
        journeysDir,
        environmentsDir,
        file,
        ...(body.env !== undefined ? { env: body.env } : {}),
      });
      send(res, 200, { results });
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

  const http: Server = createServer((req, res) => {
    void route(req, res, opts.projectDir);
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
