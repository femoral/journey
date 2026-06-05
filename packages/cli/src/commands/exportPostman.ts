import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  clearActiveEnvironment,
  collectPipeline,
  collectSubPipeline,
  listEnvironments,
  loadConfig,
  loadEnvironment,
  resolveConfigPaths,
  setActiveEnvironment,
  type JourneyDef,
  type PipelineNode,
  type SubJourneyCallDef,
} from "@journey/core";
import {
  ENV_PROXY,
  buildCollection,
  buildEnvironment,
  buildFolder,
  type ExportNode,
  type PostmanFolder,
} from "@journey/postman-adapter";
import { discoverJourneyFiles } from "../util/discover.js";
import { loadJourneyDefs } from "../util/loadJourneyFile.js";

/** Matches the runtime's `MAX_SUB_JOURNEY_DEPTH` — stops runaway recursion. */
const MAX_SUB_DEPTH = 8;

/** Resolve a sub-journey call's `inputs` to a plain object, best-effort. */
async function resolveSubInputs(
  call: SubJourneyCallDef,
): Promise<Record<string, unknown> | undefined> {
  const raw = call.inputs;
  if (raw === undefined) return undefined;
  try {
    const value = typeof raw === "function" ? await raw() : raw;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a sub-journey call's cache opts into the composite key + TTL the
 * Postman adapter emits. Mirrors the core runtime: caching is active only when
 * a `cacheKey` is supplied and `cache !== "off"`. The key resolves at export
 * time (a function is called with the resolved `inputs`; under `ENV_PROXY`,
 * `env("X")` yields the stable literal `"{{X}}"`). A throwing key degrades to
 * no caching rather than aborting the export.
 */
function resolveSubCache(
  call: SubJourneyCallDef,
  inputs: Record<string, unknown> | undefined,
): { cacheKey?: string; cacheTtlMs?: number } {
  if (call.cacheKey === undefined || call.cache === "off") return {};
  let resolvedKey: string;
  try {
    const rk = typeof call.cacheKey === "function" ? call.cacheKey(inputs) : call.cacheKey;
    if (typeof rk !== "string") return {};
    resolvedKey = rk;
  } catch {
    return {};
  }
  return {
    cacheKey: `${call.handle.name}:${resolvedKey}`,
    ...(call.cacheTtlMs !== undefined ? { cacheTtlMs: call.cacheTtlMs } : {}),
  };
}

/**
 * Resolve a journey's `PipelineNode[]` into the `ExportNode` tree the postman
 * adapter renders, recursing into each sub-journey via `collectSubPipeline`.
 * A discovery failure degrades to an empty folder rather than aborting.
 */
async function toExportNodes(
  nodes: ReadonlyArray<PipelineNode>,
  depth: number,
): Promise<ExportNode[]> {
  const out: ExportNode[] = [];
  for (const node of nodes) {
    if (node.kind === "step") {
      out.push({ kind: "step", def: node.def });
      continue;
    }
    const name = node.def.name ?? node.def.handle.name;
    const inputs = await resolveSubInputs(node.def);
    let childNodes: ExportNode[] = [];
    if (depth < MAX_SUB_DEPTH) {
      try {
        const childPipeline = await collectSubPipeline(node.def);
        childNodes = await toExportNodes(childPipeline, depth + 1);
      } catch {
        // Child body could not be discovered — emit the folder empty.
      }
    }
    const cache = resolveSubCache(node.def, inputs);
    out.push({
      kind: "sub",
      name,
      ...(inputs ? { inputs } : {}),
      ...cache,
      nodes: childNodes,
    });
  }
  return out;
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
  /** Aggregate every matching journey across all files into ONE collection. */
  bundle?: boolean;
  /** Override cwd for locating journey.config.json (used by tests). */
  projectDir?: string;
}

/** Output file name for `--bundle` when no explicit `--out` is given. */
const BUNDLE_BASENAME = "journeys.postman_collection.json";

function matches(def: JourneyDef, tags: string[]): boolean {
  if (tags.length === 0) return true;
  return tags.every((t) => def.options?.tags?.includes(t) === true);
}

/**
 * De-duplicate folder names within a bundle. Two files can each declare a
 * journey of the same name; Postman tolerates duplicate folders but they read
 * ambiguously, so the second and later collisions get a ` (n)` suffix.
 */
function uniqueFolderName(name: string, seen: Map<string, number>): string {
  const n = seen.get(name) ?? 0;
  seen.set(name, n + 1);
  if (n === 0) return name;
  console.warn(`Duplicate journey name "${name}" across files — renamed to "${name} (${n + 1})".`);
  return `${name} (${n + 1})`;
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
  const env = buildEnvironment(envName, values);
  const outFile = join(outDir, `${envName}.postman_environment.json`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(env, null, 2), "utf8");
  return outFile;
}

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
  if (isDir && opts.out && !opts.bundle) {
    throw new Error(
      "--out is only valid with a single journey file, or with --bundle. " +
        "Use --out-dir for per-file directory output.",
    );
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

  // Environment export, deduped: --all-envs writes every environment once,
  // --env writes the named one once, regardless of how many collections share
  // the same output directory.
  async function writeEnvs(envOutDir: string): Promise<void> {
    if (!environmentsDir) return;
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

  try {
    if (opts.bundle) {
      // Bundle: one collection whose top-level folders are every matching
      // journey across every file.
      const mergedFolders: PostmanFolder[] = [];
      const seenNames = new Map<string, number>();

      for (const file of files) {
        const defs = await loadJourneyDefs(file);
        const matching = defs.filter((d) => matches(d, tags));
        if (matching.length === 0) {
          if (tags.length > 0) console.log(`Skipped (no matching journey) → ${file}`);
          continue;
        }
        for (const def of matching) {
          const pipeline = await collectPipeline(def);
          const nodes = await toExportNodes(pipeline, 0);
          const folder = await buildFolder(def.name, nodes);
          folder.name = uniqueFolderName(folder.name, seenNames);
          mergedFolders.push(folder);
        }
      }

      if (mergedFolders.length === 0) {
        if (tags.length > 0) console.log(`No journeys matched tags: ${tags.join(", ")}`);
        return 0;
      }

      const outFile = opts.out
        ? resolve(process.cwd(), opts.out)
        : opts.outDir
          ? resolve(process.cwd(), opts.outDir, BUNDLE_BASENAME)
          : resolve(process.cwd(), BUNDLE_BASENAME);

      const collection = buildCollection(opts.name ?? "journeys", mergedFolders);
      const collectionOutDir = dirname(outFile);
      await mkdir(collectionOutDir, { recursive: true });
      await writeFile(outFile, JSON.stringify(collection, null, 2), "utf8");
      console.log(`Wrote Postman collection → ${outFile}`);
      exported++;

      await writeEnvs(opts.outDir ? resolve(process.cwd(), opts.outDir) : collectionOutDir);
      return 0;
    }

    for (const file of files) {
      const defs = await loadJourneyDefs(file);
      const matching = defs.filter((d) => matches(d, tags));

      if (matching.length === 0) {
        if (tags.length > 0) console.log(`Skipped (no matching journey) → ${file}`);
        continue;
      }

      const fileBase = basename(file).replace(/\.journey\.ts$/, "");
      const collectionName = opts.name ?? fileBase;

      const folders: PostmanFolder[] = [];
      for (const def of matching) {
        const pipeline = await collectPipeline(def);
        const nodes = await toExportNodes(pipeline, 0);
        folders.push(await buildFolder(def.name, nodes));
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
      await writeEnvs(opts.outDir ? resolve(process.cwd(), opts.outDir) : collectionOutDir);
    }
  } finally {
    clearActiveEnvironment();
  }

  if (exported === 0 && tags.length > 0) {
    console.log(`No journeys matched tags: ${tags.join(", ")}`);
  }
  return 0;
}
