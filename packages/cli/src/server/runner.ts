import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearActiveEnvironment,
  clearRegistry,
  loadEnvironment,
  runAllRegistered,
  setActiveEnvironment,
  type HttpContext,
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
  return runAllRegistered(ctx);
}
