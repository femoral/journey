---
title: History
description: writeRun, readRun, listRuns, pruneRuns — run-record persistence.
sources:
  - packages/core/src/history.ts
---

# History

Reads and writes run records under `.journey/cache/runs/`. The CLI uses these helpers after every `journey run`; the GUI's History page reads via `listRuns` / `readRun`.

## `RunRecord`

```ts
interface RunRecord {
  id: string;
  timestamp: string;
  results: JourneyResult[];
}
```

- `id` — the current ISO timestamp with `:` replaced by `-` (e.g. `2026-04-24T14-30-45.123Z`). File-safe; sortable.
- `timestamp` — same moment as an ISO string with colons intact.
- `results` — the array returned by `runAllRegistered`.

## `RunSummary`

```ts
interface RunSummary {
  id: string;
  timestamp: string;
  journeyNames: string[];
  ok: boolean; // every journey ok?
  durationMs: number; // sum across journeys
  stepCount: number; // total steps across journeys
}
```

Produced by `listRuns` — lightweight enough to render a history list without loading every record.

## `writeRun(cacheDir, results)`

```ts
function writeRun(cacheDir: string, results: JourneyResult[]): Promise<RunRecord>;
```

Writes `<cacheDir>/runs/<id>.run.json`. Creates the `runs/` subdirectory if missing. Returns the written record (so the caller can log the id).

## `listRuns(cacheDir)`

```ts
function listRuns(cacheDir: string): Promise<RunSummary[]>;
```

Scans `<cacheDir>/runs/` for `*.run.json` files. Returns newest-first (descending by timestamp). Corrupt files are silently skipped — a partial write from a killed process won't break the list.

Returns `[]` if the `runs/` directory doesn't exist.

## `readRun(cacheDir, id)`

```ts
function readRun(cacheDir: string, id: string): Promise<RunRecord | undefined>;
```

Fetches a single record by id. Returns `undefined` on ENOENT, throws for other errors.

## `pruneRuns(cacheDir, keep)`

```ts
function pruneRuns(cacheDir: string, keep: number): Promise<number>;
```

Deletes oldest records until at most `keep` remain. Returns the number deleted. `keep <= 0` is a no-op.

The CLI calls this after every run with `keep = config.runHistoryKeepCount`. Failed deletions (concurrent process, permissions) are swallowed — best-effort.

## Example — archive runs older than a week

```ts
import { listRuns, readRun, pruneRuns } from "@usejourney/core";
import { writeFile } from "node:fs/promises";

const cacheDir = ".journey/cache";
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

for (const summary of await listRuns(cacheDir)) {
  if (Date.parse(summary.timestamp) < cutoff && !summary.ok) {
    const record = await readRun(cacheDir, summary.id);
    await writeFile(`archive/${summary.id}.json`, JSON.stringify(record, null, 2));
  }
}

await pruneRuns(cacheDir, 20);
```
