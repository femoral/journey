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
    out.push({ kind: "sub", name, ...(inputs ? { inputs } : {}), nodes: childNodes });
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
  /** Override cwd for locating journey.config.json (used by tests). */
  projectDir?: string;
}

function matches(def: JourneyDef, tags: string[]): boolean {
  if (tags.length === 0) return true;
  return tags.every((t) => def.options?.tags?.includes(t) === true);
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
  if (isDir && opts.out) {
    throw new Error(
      "--out is only valid with a single journey file. Use --out-dir for directories.",
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

  try {
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
