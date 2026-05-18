import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JourneyResult } from "./runtime.js";

export interface RunRecord {
  id: string;
  timestamp: string;
  results: JourneyResult[];
}

export interface RunSummary {
  id: string;
  timestamp: string;
  journeyNames: string[];
  ok: boolean;
  /** Sum of durationMs across all journeys in the run. */
  durationMs: number;
  /** Total step count across all journeys. */
  stepCount: number;
}

function makeId(): { id: string; timestamp: string } {
  const ts = new Date().toISOString();
  const id = ts.replace(/:/g, "-");
  return { id, timestamp: ts };
}

export async function writeRun(cacheDir: string, results: JourneyResult[]): Promise<RunRecord> {
  const runsDir = join(cacheDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const { id, timestamp } = makeId();
  const record: RunRecord = { id, timestamp, results };
  await writeFile(join(runsDir, `${id}.run.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

export async function listRuns(cacheDir: string): Promise<RunSummary[]> {
  const runsDir = join(cacheDir, "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const runs: RunSummary[] = [];
  for (const file of files) {
    if (!file.endsWith(".run.json")) continue;
    try {
      const raw = await readFile(join(runsDir, file), "utf8");
      const record = JSON.parse(raw) as RunRecord;
      runs.push({
        id: record.id,
        timestamp: record.timestamp,
        journeyNames: record.results.map((r) => r.name),
        ok: record.results.every((r) => r.ok),
        durationMs: record.results.reduce((a, r) => a + (r.durationMs ?? 0), 0),
        stepCount: record.results.reduce((a, r) => a + r.steps.length, 0),
      });
    } catch {
      // corrupt file; skip
    }
  }
  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return runs;
}

export async function readRun(cacheDir: string, id: string): Promise<RunRecord | undefined> {
  const file = join(cacheDir, "runs", `${id}.run.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as RunRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export async function pruneRuns(cacheDir: string, keep: number): Promise<number> {
  if (keep <= 0) return 0;
  const runs = await listRuns(cacheDir);
  if (runs.length <= keep) return 0;
  const toDelete = runs.slice(keep);
  const runsDir = join(cacheDir, "runs");
  let deleted = 0;
  for (const run of toDelete) {
    try {
      await unlink(join(runsDir, `${run.id}.run.json`));
      deleted++;
    } catch {
      // best-effort
    }
  }
  return deleted;
}
