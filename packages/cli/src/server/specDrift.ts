import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { collectOperations, loadSpec, type Operation } from "@usejourney/codegen";

export type DriftEndpoint = {
  method: string;
  path: string;
  operationId: string;
};

export type SpecDrift = {
  added: DriftEndpoint[];
  removed: DriftEndpoint[];
  /** True when generated/endpoints.ts exists and we could actually diff. */
  hasGenerated: boolean;
  /** True when the OpenAPI spec could be loaded. */
  hasSpec: boolean;
  /** Total drift count (added + removed). */
  count: number;
};

/**
 * Parse the generated `endpoints.ts` back into its (method, path, operationId)
 * triples. The generator's output is stable enough that a line-scan regex
 * beats reaching for a TS AST parser here.
 */
export function parseGeneratedEndpoints(source: string): DriftEndpoint[] {
  const out: DriftEndpoint[] = [];
  // Match lines like:
  //   createPet: { method: "POST", path: "/pet", operationId: "createPet" } as unknown as ...
  const re =
    /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*\{\s*method:\s*"([A-Z]+)"\s*,\s*path:\s*"([^"]+)"\s*,\s*operationId:\s*"([^"]+)"\s*\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const [, , method, path, operationId] = m;
    out.push({ method: method!, path: path!, operationId: operationId! });
  }
  return out;
}

export async function computeSpecDrift(specPath: string, generatedDir: string): Promise<SpecDrift> {
  const [spec, generated] = await Promise.all([readSpecOps(specPath), readGenerated(generatedDir)]);

  if (!spec || !generated) {
    return {
      added: [],
      removed: [],
      hasGenerated: generated !== undefined,
      hasSpec: spec !== undefined,
      count: 0,
    };
  }

  const specKey = new Map<string, DriftEndpoint>();
  for (const op of spec) {
    specKey.set(`${op.method.toUpperCase()} ${op.path}`, {
      method: op.method.toUpperCase(),
      path: op.path,
      operationId: op.operationId,
    });
  }
  const genKey = new Map<string, DriftEndpoint>();
  for (const op of generated) {
    genKey.set(`${op.method} ${op.path}`, op);
  }

  const added: DriftEndpoint[] = [];
  for (const [k, v] of specKey) {
    if (!genKey.has(k)) added.push(v);
  }
  const removed: DriftEndpoint[] = [];
  for (const [k, v] of genKey) {
    if (!specKey.has(k)) removed.push(v);
  }

  return {
    added,
    removed,
    hasGenerated: true,
    hasSpec: true,
    count: added.length + removed.length,
  };
}

async function readSpecOps(specPath: string): Promise<Operation[] | undefined> {
  try {
    await stat(specPath);
  } catch {
    return undefined;
  }
  try {
    const doc = await loadSpec(specPath);
    return collectOperations(doc);
  } catch {
    return undefined;
  }
}

async function readGenerated(generatedDir: string): Promise<DriftEndpoint[] | undefined> {
  try {
    const source = await readFile(join(generatedDir, "endpoints.ts"), "utf8");
    return parseGeneratedEndpoints(source);
  } catch {
    return undefined;
  }
}
