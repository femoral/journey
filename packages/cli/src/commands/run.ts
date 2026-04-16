import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearActiveEnvironment,
  clearRegistry,
  createConsoleLogger,
  loadConfig,
  loadEnvironment,
  loggerFromEnv,
  resolveConfigPaths,
  runAllRegistered,
  setActiveEnvironment,
  type HttpContext,
  type JourneyResult,
} from "@journey/core";
import { tsImport } from "tsx/esm/api";
import { overallOk, printResults } from "../report.js";

export interface RunOptions {
  projectDir: string;
  files?: string[];
  all?: boolean;
  env?: string;
  debug?: boolean;
}

async function discoverJourneyFiles(journeysDir: string): Promise<string[]> {
  try {
    const entries = await readdir(journeysDir);
    return entries
      .filter((e) => e.endsWith(".journey.ts"))
      .sort()
      .map((e) => join(journeysDir, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
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
  if (loaded.config.baseUrl) ctx.baseUrl = loaded.config.baseUrl;
  const logger = opts.debug ? createConsoleLogger() : loggerFromEnv();
  if (logger) ctx.logger = logger;
  const results: JourneyResult[] = await runAllRegistered(ctx);
  printResults(results);
  return overallOk(results) ? 0 : 1;
}
