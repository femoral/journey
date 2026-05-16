import { watch } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearActiveEnvironment,
  clearRegistry,
  createConsoleLogger,
  loadConfig,
  loadEnvironment,
  loggerFromEnv,
  pruneRuns,
  resolveBaseUrl,
  resolveConfigPaths,
  runAllRegistered,
  setActiveEnvironment,
  writeRun,
  type HttpContext,
  type JourneyResult,
} from "@journey/core";
import { tsImport } from "tsx/esm/api";
import { overallOk, printResults } from "../report.js";
import { discoverJourneyFiles } from "../util/discover.js";

export interface RunOptions {
  projectDir: string;
  files?: string[];
  all?: boolean;
  env?: string;
  debug?: boolean;
  watch?: boolean;
  /** When true, disable TLS certificate verification. Survives a recursive watch-mode rerun. */
  insecure?: boolean;
}

/**
 * Disable TLS certificate verification for this process and print one
 * warning to stderr so the choice cannot leak silently into CI. Idempotent
 * — survives a watch-mode rerun without re-warning.
 *
 * Implementation note: we mutate `NODE_TLS_REJECT_UNAUTHORIZED` rather than
 * passing an undici `Dispatcher` because the CLI doesn't bundle `undici`
 * directly today. The CLI is a single process — no child processes inherit
 * the env. A follow-up issue will swap this for `setGlobalDispatcher` once
 * `undici` is on the dependency list.
 */
let warnedAboutInsecure = false;
export function enableInsecureTls(): void {
  if (!warnedAboutInsecure) {
    console.error("journey: WARNING — TLS verification disabled (--insecure)");
    warnedAboutInsecure = true;
  }
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export async function runCommand(opts: RunOptions): Promise<number> {
  const loaded = await loadConfig(opts.projectDir);
  const paths = resolveConfigPaths(loaded);

  clearActiveEnvironment();
  const envName = opts.env ?? loaded.config.defaultEnvironment;
  if (envName) {
    const values = await loadEnvironment(paths.environmentsDir, envName);
    setActiveEnvironment(envName, values);
  }

  const files: string[] = opts.all
    ? await discoverJourneyFiles(paths.journeysDir)
    : (opts.files ?? []).map((f) => (isAbsolute(f) ? f : resolve(process.cwd(), f)));

  if (files.length === 0) {
    throw new Error("No journey files to run.");
  }

  clearRegistry();
  for (const file of files) {
    await tsImport(pathToFileURL(file).href, import.meta.url);
  }

  const ctx: HttpContext = {};
  const baseUrl = resolveBaseUrl(loaded.config);
  if (baseUrl) ctx.baseUrl = baseUrl;
  const logger = opts.debug ? createConsoleLogger() : loggerFromEnv();
  if (logger) ctx.logger = logger;
  if (opts.insecure || loaded.config.tlsRejectUnauthorized === false) {
    enableInsecureTls();
  }
  const results: JourneyResult[] = await runAllRegistered(ctx);
  printResults(results);

  const cacheDir = join(opts.projectDir, ".journey", "cache");
  await writeRun(cacheDir, results);
  await pruneRuns(cacheDir, loaded.config.runHistoryKeepCount);

  if (!opts.watch) return overallOk(results) ? 0 : 1;

  // Watch mode: rerun on TS file changes, debounced.
  const DEBOUNCE_MS = 300;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  const abortCtrl = new AbortController();

  const rerun = async () => {
    if (running) return;
    running = true;
    process.stdout.write("\x1Bc"); // clear terminal
    try {
      await runCommand({ ...opts, watch: false });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rerun(), DEBOUNCE_MS);
  };

  // Collect directories to watch: the project journeys dir + each file's dir.
  const dirs = new Set<string>([paths.journeysDir]);
  for (const f of files) dirs.add(dirname(f));

  const watchers: AsyncIterable<unknown>[] = [];
  for (const dir of dirs) {
    try {
      watchers.push(watch(dir, { recursive: true, signal: abortCtrl.signal }));
    } catch {
      // directory may not support recursive; skip silently
    }
  }

  console.log(`\nWatching for changes in ${[...dirs].join(", ")}…`);
  console.log("Press Ctrl+C to stop.\n");

  const consume = async (watcher: AsyncIterable<unknown>) => {
    try {
      for await (const event of watcher) {
        const e = event as { filename?: string };
        if (e.filename && (e.filename.endsWith(".ts") || e.filename.endsWith(".json"))) {
          schedule();
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      throw err;
    }
  };

  const exitPromise = new Promise<void>((res) => {
    const handler = () => {
      abortCtrl.abort();
      if (timer) clearTimeout(timer);
      res();
    };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  });

  await Promise.race([...watchers.map(consume), exitPromise]);
  return 0;
}
