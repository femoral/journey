import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearActiveEnvironment,
  clearRegistry,
  collectSteps,
  getRegisteredJourneys,
  listEnvironments,
  loadConfig,
  loadEnvironment,
  resolveConfigPaths,
  setActiveEnvironment,
  type JourneyDef,
  type StepDef,
} from "@journey/core";
import { tsImport } from "tsx/esm/api";
import { discoverJourneyFiles } from "../util/discover.js";

// ---------------------------------------------------------------------------
// Postman Collection v2.1.0 types
// ---------------------------------------------------------------------------

interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query: Array<{ key: string; value: string }>;
}

interface PostmanHeader {
  key: string;
  value: string;
}

interface PostmanBody {
  mode: "raw";
  raw: string;
  options: { raw: { language: "json" } };
}

interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  body?: PostmanBody;
}

interface PostmanItem {
  name: string;
  request: PostmanRequest;
}

interface PostmanFolder {
  name: string;
  item: PostmanItem[];
}

interface PostmanInfo {
  name: string;
  schema: string;
}

interface PostmanCollection {
  info: PostmanInfo;
  item: PostmanFolder[];
}

interface PostmanEnvValue {
  key: string;
  value: string;
  enabled: boolean;
}

interface PostmanEnvironment {
  name: string;
  values: PostmanEnvValue[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExportPostmanCliOptions {
  path: string;
  out?: string;
  outDir?: string;
  tags?: string[];
  name?: string;
  env?: string;
  allEnvs?: boolean;
  /** Override cwd for locating journey.config.json (used by tests). */
  projectDir?: string;
}

// ---------------------------------------------------------------------------
// Journey loading (same pattern as exportK6.ts)
// ---------------------------------------------------------------------------

async function loadJourneyFile(file: string): Promise<ReadonlyArray<JourneyDef>> {
  clearRegistry();
  await tsImport(pathToFileURL(file).href, import.meta.url);
  const defs = getRegisteredJourneys().slice();
  clearRegistry();
  return defs;
}

function matches(def: JourneyDef, tags: string[]): boolean {
  if (tags.length === 0) return true;
  return tags.every((t) => def.options?.tags?.includes(t) === true);
}

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
// Collection builder
// ---------------------------------------------------------------------------

async function buildFolder(
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

function buildCollection(name: string, folders: PostmanFolder[]): PostmanCollection {
  return {
    info: {
      name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: folders,
  };
}

// ---------------------------------------------------------------------------
// Environment export
// ---------------------------------------------------------------------------

async function exportEnvironment(
  environmentsDir: string,
  envName: string,
  outDir: string,
): Promise<string> {
  const values = await loadEnvironment(environmentsDir, envName);
  const env: PostmanEnvironment = {
    name: envName,
    values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true })),
  };
  const outFile = join(outDir, `${envName}.postman_environment.json`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(env, null, 2), "utf8");
  return outFile;
}

// ---------------------------------------------------------------------------
// Env proxy for step collection — env("KEY") → "{{KEY}}"
// ---------------------------------------------------------------------------

const ENV_PROXY = new Proxy({} as Record<string, string>, {
  get(_target, key: string) {
    return `{{${key}}}`;
  },
  has() {
    return true;
  },
});

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

export async function runExportPostman(opts: ExportPostmanCliOptions): Promise<number> {
  const target = isAbsolute(opts.path) ? opts.path : resolve(process.cwd(), opts.path);
  const tags = opts.tags ?? [];

  let info;
  try {
    info = await stat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Path not found: ${opts.path}`);
    }
    throw err;
  }

  const isDir = info.isDirectory();
  if (isDir && opts.out) {
    throw new Error("--out is only valid with a single journey file. Use --out-dir for directories.");
  }

  const files = isDir ? await discoverJourneyFiles(target) : [target];
  if (files.length === 0) {
    console.log(`No .journey.ts files found in ${opts.path}`);
    return 0;
  }

  // Load config for environmentsDir (best-effort — only needed for env export)
  let environmentsDir: string | undefined;
  if (opts.env || opts.allEnvs) {
    try {
      const loaded = await loadConfig(opts.projectDir ?? process.cwd());
      environmentsDir = resolveConfigPaths(loaded).environmentsDir;
    } catch {
      throw new Error(
        "Could not load journey.config.json. --env/--all-envs require a Journey project.",
      );
    }
  }

  // Install env proxy so env() calls return {{KEY}} during step collection
  setActiveEnvironment("__postman_export__", ENV_PROXY);

  let exported = 0;
  const writtenEnvs = new Set<string>();

  try {
    for (const file of files) {
      const defs = await loadJourneyFile(file);
      const matching = defs.filter((d) => matches(d, tags));

      if (matching.length === 0) {
        if (tags.length > 0) console.log(`Skipped (no matching journey) → ${file}`);
        continue;
      }

      const fileBase = basename(file).replace(/\.journey\.ts$/, "");
      const collectionName = opts.name ?? fileBase;

      const folders: PostmanFolder[] = [];
      for (const def of matching) {
        const steps = await collectSteps(def);
        folders.push(await buildFolder(def, steps));
      }

      const collection = buildCollection(collectionName, folders);
      const json = JSON.stringify(collection, null, 2);

      const outFile = opts.out
        ? resolve(process.cwd(), opts.out)
        : opts.outDir
          ? resolve(process.cwd(), opts.outDir, `${fileBase}.postman_collection.json`)
          : join(dirname(file), `${fileBase}.postman_collection.json`);

      const collectionOutDir = dirname(outFile);
      await mkdir(collectionOutDir, { recursive: true });
      await writeFile(outFile, json, "utf8");
      console.log(`Wrote Postman collection → ${outFile}`);
      exported++;

      // Export environments (deduped across files)
      if (environmentsDir) {
        const envOutDir = opts.outDir ? resolve(process.cwd(), opts.outDir) : collectionOutDir;

        if (opts.allEnvs && !writtenEnvs.has("__all__")) {
          writtenEnvs.add("__all__");
          const envNames = await listEnvironments(environmentsDir);
          for (const envName of envNames) {
            const envFile = await exportEnvironment(environmentsDir, envName, envOutDir);
            console.log(`Wrote Postman environment → ${envFile}`);
          }
        } else if (opts.env && !writtenEnvs.has(opts.env)) {
          writtenEnvs.add(opts.env);
          const envFile = await exportEnvironment(environmentsDir, opts.env, envOutDir);
          console.log(`Wrote Postman environment → ${envFile}`);
        }
      }
    }
  } finally {
    clearActiveEnvironment();
  }

  if (exported === 0 && tags.length > 0) {
    console.log(`No journeys matched tags: ${tags.join(", ")}`);
  }
  return 0;
}
