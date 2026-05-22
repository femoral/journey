import { pathToFileURL } from "node:url";
import { clearRegistry, getRegisteredJourneys, type JourneyDef } from "@journey/core";
import { tsImport } from "tsx/esm/api";

/**
 * Load one `.journey.ts` file in isolation and return the `JourneyDef`s it
 * registers. Clears the shared registry before and after so the snapshot
 * reflects exactly this file. Used by exporters and the plan endpoint, which
 * each process files one at a time.
 */
export async function loadJourneyDefs(file: string): Promise<ReadonlyArray<JourneyDef>> {
  clearRegistry();
  await tsImport(pathToFileURL(file).href, import.meta.url);
  const defs = getRegisteredJourneys().slice();
  clearRegistry();
  return defs;
}

/**
 * Import one or more `.journey.ts` files and leave their registered journeys
 * in the shared registry for the caller to run. Clears the registry once up
 * front; the caller is responsible for consuming it (e.g. `runAllRegistered`).
 */
export async function importJourneyFiles(files: ReadonlyArray<string>): Promise<void> {
  clearRegistry();
  for (const file of files) {
    await tsImport(pathToFileURL(file).href, import.meta.url);
  }
}
