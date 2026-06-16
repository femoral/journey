import { isAbsolute, join, resolve } from "node:path";
import {
  clearActiveEnvironment,
  loadEnvironment,
  planJourney,
  setActiveEnvironment,
  type LoadedConfig,
  type PlannedNode,
} from "@usejourney/core";
import { loadJourneyDefs } from "../util/loadJourneyFile.js";
import { ensureProjectCoreLink } from "../util/projectCoreLink.js";

export interface PlanJourneyFileOptions {
  loaded: LoadedConfig;
  journeysDir: string;
  environmentsDir: string;
  /** File name relative to journeysDir, or an absolute/cwd-relative path. */
  file: string;
  /** Environment name; defaults to `config.defaultEnvironment`. */
  env?: string;
}

export interface PlannedJourney {
  name: string;
  steps: PlannedNode[];
}

/**
 * Resolves a journey file's plan tree without running it — loads the file,
 * then `planJourney`s every entry journey it registers. No HTTP is performed;
 * `step()` / `invokeJourney()` bodies are evaluated to discover the pipeline,
 * recursing into sub-journeys (best-effort).
 *
 * An environment is loaded first because journey bodies routinely read
 * `env(...)` while building sub-journey inputs — the same setup `runJourneyFile`
 * does before a run.
 */
export async function planJourneyFile(opts: PlanJourneyFileOptions): Promise<PlannedJourney[]> {
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

  await ensureProjectCoreLink(opts.loaded.projectDir);
  const defs = await loadJourneyDefs(abs);
  const journeys: PlannedJourney[] = [];
  for (const def of defs) {
    journeys.push({ name: def.name, steps: await planJourney(def) });
  }
  return journeys;
}
