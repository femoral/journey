import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type EnvValues = Record<string, string>;

interface ActiveEnvState {
  name: string;
  values: EnvValues;
}

interface Shared {
  active?: ActiveEnvState;
}
const KEY = Symbol.for("@usejourney/core::env-state");
const globals = globalThis as unknown as { [KEY]?: Shared };
const shared: Shared = globals[KEY] ?? (globals[KEY] = {});

export function setActiveEnvironment(name: string, values: EnvValues): void {
  shared.active = { name, values };
}

export function clearActiveEnvironment(): void {
  delete shared.active;
}

export function env(key: string): string {
  if (!shared.active) {
    throw new Error(
      `env(${JSON.stringify(key)}) called with no active environment. Pass --env <name> or set one via setActiveEnvironment().`,
    );
  }
  const value = shared.active.values[key];
  if (value === undefined) {
    throw new Error(`env: key "${key}" not found in environment "${shared.active.name}"`);
  }
  return value;
}

export function tryEnv(key: string): string | undefined {
  return shared.active?.values[key];
}

export async function loadEnvironment(environmentsDir: string, name: string): Promise<EnvValues> {
  const path = join(environmentsDir, `${name}.json`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`Could not read environment file ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Environment file ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Environment file ${path} must contain a JSON object`);
  }
  const out: EnvValues = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

export async function listEnvironments(environmentsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(environmentsDir);
    return entries
      .filter((e) => e.endsWith(".json"))
      .map((e) => e.slice(0, -".json".length))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
