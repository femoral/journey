import { listEnvironments, loadConfig, resolveConfigPaths } from "@journey/core";

export async function runEnvList(projectDir: string): Promise<void> {
  const loaded = await loadConfig(projectDir);
  const { environmentsDir } = resolveConfigPaths(loaded);
  const envs = await listEnvironments(environmentsDir);
  if (envs.length === 0) {
    console.log(`No environments found in ${environmentsDir}`);
    return;
  }
  const def = loaded.config.defaultEnvironment;
  for (const name of envs) {
    console.log(name === def ? `* ${name}` : `  ${name}`);
  }
}
