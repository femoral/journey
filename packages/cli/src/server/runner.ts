import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearActiveEnvironment,
  clearRegistry,
  createConsoleLogger,
  loadEnvironment,
  loggerFromEnv,
  pruneRuns,
  runAllRegistered,
  setActiveEnvironment,
  writeRun,
  type HttpContext,
  type JourneyLogger,
  type JourneyResult,
  type LoadedConfig,
} from "@journey/core";
import { tsImport } from "tsx/esm/api";

export interface RunJourneyFileOptions {
  loaded: LoadedConfig;
  journeysDir: string;
  environmentsDir: string;
  /** File name relative to journeysDir, or an absolute/cwd-relative path. */
  file: string;
  /** Environment name; defaults to `config.defaultEnvironment`. */
  env?: string;
  /** When true, attach a console logger that prints every request/response. */
  debug?: boolean;
  /** Override the logger entirely (e.g. for tests). */
  logger?: JourneyLogger;
  /** Forwarded to runAllRegistered so lifecycle events carry this runId. */
  runId?: string;
}

export async function runJourneyFile(opts: RunJourneyFileOptions): Promise<JourneyResult[]> {
  const abs = isAbsolute(opts.file)
    ? opts.file
    : opts.file.includes("/") || opts.file.includes("\\")
      ? resolve(process.cwd(), opts.file)
      : join(opts.journeysDir, opts.file);

  clearActiveEnvironment();
  const envName = opts.env ?? opts.loaded.config.defaultEnvironment;
  if (envName) {
    const values = await loadEnvironment(opts.environmentsDir, envName);
    setActiveEnvironment(envName, values);
  }

  clearRegistry();
  await tsImport(pathToFileURL(abs).href, import.meta.url);

  const ctx: HttpContext = {};
  if (opts.loaded.config.baseUrl) ctx.baseUrl = opts.loaded.config.baseUrl;
  const logger = opts.logger ?? (opts.debug ? createConsoleLogger() : loggerFromEnv());
  if (logger) ctx.logger = logger;
  const results = await runAllRegistered(
    ctx,
    opts.runId !== undefined ? { runId: opts.runId } : {},
  );

  const cacheDir = join(opts.loaded.projectDir, ".journey", "cache");
  await writeRun(cacheDir, results);
  await pruneRuns(cacheDir, opts.loaded.config.runHistoryKeepCount);

  return results;
}
