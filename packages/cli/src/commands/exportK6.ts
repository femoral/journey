import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { JourneyDef } from "@usejourney/core";
import { exportToK6 } from "@usejourney/k6-adapter";
import { discoverJourneyFiles } from "../util/discover.js";
import { loadJourneyDefs } from "../util/loadJourneyFile.js";

export interface ExportK6CliOptions {
  /** File or directory. */
  path: string;
  out?: string;
  outDir?: string;
  /** AND semantics: a journey must carry every tag in the list to match. */
  tags?: string[];
}

interface FileExport {
  file: string;
  defs: ReadonlyArray<JourneyDef>;
}

function matches(def: JourneyDef, tags: string[]): boolean {
  if (tags.length === 0) return true;
  return tags.every((t) => def.options?.tags?.includes(t) === true);
}

function pickK6Options(
  file: string,
  matching: ReadonlyArray<JourneyDef>,
): Record<string, unknown> | undefined {
  const withK6 = matching.filter((d) => d.options?.k6);
  if (withK6.length === 0) return undefined;
  if (withK6.length > 1) {
    const names = withK6.map((d) => `"${d.name}"`).join(", ");
    throw new Error(
      `${file}: ${withK6.length} journeys declare k6 options (${names}). ` +
        `k6 'export const options' is module-scoped — split into separate files ` +
        `or remove all but one k6 config block.`,
    );
  }
  return withK6[0]!.options!.k6 as Record<string, unknown>;
}

export async function runExportK6(opts: ExportK6CliOptions): Promise<number> {
  const target = isAbsolute(opts.path) ? opts.path : resolve(process.cwd(), opts.path);
  const tags = opts.tags ?? [];

  let info;
  try {
    info = await stat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Path not found: ${opts.path}`);
    }
    throw err;
  }

  const isDir = info.isDirectory();
  if (isDir && opts.out) {
    throw new Error(
      "--out is only valid with a single journey file. Use --out-dir for directories.",
    );
  }

  const files = isDir ? await discoverJourneyFiles(target) : [target];
  if (files.length === 0) {
    console.log(`No .journey.ts files found in ${opts.path}`);
    return 0;
  }

  const work: FileExport[] = [];
  for (const file of files) {
    const defs = await loadJourneyDefs(file);
    work.push({ file, defs });
  }

  let exported = 0;
  for (const { file, defs } of work) {
    const matching = defs.filter((d) => matches(d, tags));
    if (matching.length === 0) {
      if (tags.length > 0) console.log(`Skipped (no matching journey) → ${file}`);
      continue;
    }
    const k6Options = pickK6Options(file, matching);
    const result = await exportToK6({
      journeyFile: file,
      ...(opts.out !== undefined ? { outFile: opts.out } : {}),
      ...(opts.outDir !== undefined ? { outDir: opts.outDir } : {}),
      ...(k6Options !== undefined ? { k6Options } : {}),
    });
    console.log(`Wrote k6 script → ${result.outFile}`);
    exported++;
  }

  if (exported === 0 && tags.length > 0) {
    console.log(`No journeys matched tags: ${tags.join(", ")}`);
  }
  return 0;
}
