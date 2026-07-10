import { isAbsolute, join, resolve } from "node:path";
import {
  clearActiveEnvironment,
  createConsoleLogger,
  loadEnvironment,
  loggerFromEnv,
  pruneRuns,
  resolveBaseUrl,
  runAllRegistered,
  setActiveEnvironment,
  writeRun,
  type HttpContext,
  type JourneyLogger,
  type JourneyResult,
  type LoadedConfig,
  type SubJourneyCache,
} from "@usejourney/core";
import { enableInsecureTls } from "../commands/run.js";
import { patchConsole } from "./consolePatch.js";
import { importJourneyFiles } from "../util/loadJourneyFile.js";
import { ensureProjectCoreLink } from "../util/projectCoreLink.js";

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
  /** Stop after the Nth absolute step (across journey boundaries). */
  upToStepIdx?: number;
  /**
   * When fired, in-flight fetches abort and the runtime stops launching new
   * steps. Used by the dev server's `POST /api/runs/:id/abort` route.
   */
  signal?: AbortSignal;
  /** Sub-journey output cache; absent → caching disabled for this run. */
  subJourneyCache?: SubJourneyCache;
  /** Default TTL (ms) for sub-journey cache writes. */
  subJourneyCacheTtlMs?: number;
  /** Default request timeout (ms); 0 disables; unset → core's 60s default. */
  timeoutMs?: number;
}

export async function runJourneyFile(opts: RunJourneyFileOptions): Promise<JourneyResult[]> {
  const abs = isAbsolute(opts.file)
    ? opts.file
    : opts.file.includes("/") || opts.file.includes("\\")
      ? resolve(process.cwd(), opts.file)
      : join(opts.journeysDir, opts.file);

  let dispatcher: unknown;
  if (opts.loaded.config.tlsRejectUnauthorized === false) {
    dispatcher = await enableInsecureTls();
  }

  clearActiveEnvironment();
  const envName = opts.env ?? opts.loaded.config.defaultEnvironment;
  if (envName) {
    const values = await loadEnvironment(opts.environmentsDir, envName);
    setActiveEnvironment(envName, values);
  }

  await ensureProjectCoreLink(opts.loaded.projectDir);
  await importJourneyFiles([abs]);

  const ctx: HttpContext = {};
  const baseUrl = resolveBaseUrl(opts.loaded.config);
  if (baseUrl) ctx.baseUrl = baseUrl;
  const logger = opts.logger ?? (opts.debug ? createConsoleLogger() : loggerFromEnv());
  if (logger) ctx.logger = logger;
  if (dispatcher !== undefined) ctx.dispatcher = dispatcher;
  if (opts.signal !== undefined) ctx.signal = opts.signal;
  if (opts.subJourneyCache !== undefined) ctx.subJourneyCache = opts.subJourneyCache;
  if (opts.subJourneyCacheTtlMs !== undefined) {
    ctx.subJourneyCacheTtlMs = opts.subJourneyCacheTtlMs;
  }
  if (opts.timeoutMs !== undefined) {
    ctx.defaultTimeoutMs = opts.timeoutMs === 0 ? null : opts.timeoutMs;
  }
  const unpatchConsole = logger ? patchConsole(logger) : () => {};
  let results;
  try {
    results = await runAllRegistered(ctx, {
      ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      ...(opts.upToStepIdx !== undefined ? { upToStepIdx: opts.upToStepIdx } : {}),
    });
  } finally {
    unpatchConsole();
  }

  const cacheDir = join(opts.loaded.projectDir, ".journey", "cache");
  await writeRun(cacheDir, results);
  await pruneRuns(cacheDir, opts.loaded.config.runHistoryKeepCount);

  return results;
}
