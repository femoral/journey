import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, listEnvironments, resolveConfigPaths, type LoadedConfig } from "@journey/core";

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
