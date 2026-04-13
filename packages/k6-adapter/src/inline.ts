import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const IMPORT_RE = /^\s*import\s+[^;]*?from\s+["']([^"']+)["'];?\s*$/gm;

export interface InlinedModule {
  specifier: string;
  sourcePath: string;
  source: string;
}

/**
 * Strip `import ... from "@journey/core"` lines. The shim provides those
 * symbols in the emitted script's global scope.
 */
export function stripCoreImports(source: string): string {
  return source.replace(IMPORT_RE, (match, specifier: string) => {
    if (specifier === "@journey/core") return "";
    return match;
  });
}

/** Strip `import type ... from "..."` — type-only imports are erased by tsc. */
export function stripTypeImports(source: string): string {
  return source.replace(/^\s*import\s+type\s+[^;]*?from\s+["'][^"']+["'];?\s*$/gm, "");
}

/**
 * Find relative imports (./, ../), resolve them against `fromFile`, and return
 * pairs of { specifier, sourcePath } for inlining. Does not recurse.
 */
export function findRelativeImports(
  source: string,
  fromFile: string,
): Array<{ specifier: string; sourcePath: string }> {
  const out: Array<{ specifier: string; sourcePath: string }> = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source))) {
    const spec = m[1]!;
    if (!spec.startsWith(".")) continue;
    const base = dirname(fromFile);
    const abs = isAbsolute(spec) ? spec : resolve(base, spec);
    const withExt = abs.endsWith(".ts") || abs.endsWith(".js") ? abs : null;
    const candidates = withExt ? [withExt] : [`${abs}.ts`, `${abs}.js`, abs.replace(/\.js$/, ".ts")];
    out.push({ specifier: spec, sourcePath: candidates[0]! });
  }
  return out;
}

/**
 * Replace a `import { endpoints } from "../generated/endpoints"` (and .js) in
 * the user's journey source with the inlined endpoint module's body.
 */
export async function inlineRelativeImports(
  journeySource: string,
  journeyPath: string,
): Promise<string> {
  const imports = findRelativeImports(journeySource, journeyPath);
  let out = journeySource;
  for (const imp of imports) {
    // Best-effort file resolution: try the exact path, then .ts, then .js
    const tryPaths = imp.sourcePath.endsWith(".ts") || imp.sourcePath.endsWith(".js")
      ? [imp.sourcePath, imp.sourcePath.replace(/\.js$/, ".ts")]
      : [`${imp.sourcePath}.ts`, `${imp.sourcePath}.js`];
    let resolved: { path: string; content: string } | undefined;
    for (const p of tryPaths) {
      try {
        const content = await readFile(p, "utf8");
        resolved = { path: p, content };
        break;
      } catch {
        // keep trying
      }
    }
    if (!resolved) continue;
    // Strip type imports and @journey/core imports from the inlined module too.
    const cleaned = stripCoreImports(stripTypeImports(resolved.content));
    // Replace the import line with the inlined module body. We turn
    //   import { endpoints } from "./generated/endpoints"
    // into just the module body, which exports `endpoints` as a const.
    // In k6 land we can't re-export, so: rewrite `export const` → `const`.
    const converted = cleaned.replace(/^\s*export\s+(const|function|class)\s+/gm, "$1 ");
    const importLineRe = new RegExp(
      `^\\s*import\\s+[^;]*?from\\s+["']${imp.specifier.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["'];?\\s*$`,
      "m",
    );
    out = out.replace(importLineRe, `\n// ----- inlined from ${imp.specifier} -----\n${converted}\n// ----- end inlined -----\n`);
  }
  return out;
}
