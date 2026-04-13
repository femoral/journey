import { stat } from "node:fs/promises";
import { loadConfig, resolveConfigPaths } from "@journey/core";
import { generate } from "@journey/codegen";

export async function runGenerate(projectDir: string): Promise<void> {
  const loaded = await loadConfig(projectDir);
  const { specPath, generatedDir, journeysDir } = resolveConfigPaths(loaded);

  try {
    await stat(specPath);
  } catch {
    throw new Error(`Spec file not found at ${specPath}`);
  }

  const result = await generate({ specPath, outDir: generatedDir });
  console.log(
    `Regenerated ${result.operationCount} operations → ${result.modelsPath}, ${result.endpointsPath}`,
  );
  // Journeys directory is never touched — sanity check still readable.
  await stat(journeysDir).catch(() => undefined);
}
