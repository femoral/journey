import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

export const JourneyConfigSchema = z
  .object({
    name: z.string().min(1).optional(),
    spec: z.string().min(1).default("openapi.yaml"),
    generatedDir: z.string().min(1).default("generated"),
    journeysDir: z.string().min(1).default("journeys"),
    environmentsDir: z.string().min(1).default("environments"),
    defaultEnvironment: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
  })
  .strict();

export type JourneyConfig = z.infer<typeof JourneyConfigSchema>;

export interface LoadedConfig {
  readonly config: JourneyConfig;
  readonly projectDir: string;
  readonly configPath: string;
}

function resolveRelative(projectDir: string, value: string): string {
  return isAbsolute(value) ? value : join(projectDir, value);
}

export function resolveConfigPaths(loaded: LoadedConfig) {
  const { config, projectDir } = loaded;
  return {
    specPath: resolveRelative(projectDir, config.spec),
    generatedDir: resolveRelative(projectDir, config.generatedDir),
    journeysDir: resolveRelative(projectDir, config.journeysDir),
    environmentsDir: resolveRelative(projectDir, config.environmentsDir),
  };
}

export async function loadConfig(projectDir: string): Promise<LoadedConfig> {
  const configPath = join(projectDir, "journey.config.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read journey.config.json at ${configPath}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`journey.config.json is not valid JSON: ${(err as Error).message}`);
  }
  const result = JourneyConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`journey.config.json failed validation:\n${issues}`);
  }
  return { config: result.data, projectDir, configPath };
}

export function findProjectDir(cwd: string): string {
  // For MVP we require the command to be run from the project root.
  // A future issue can walk up directories.
  return dirname(join(cwd, "."));
}
