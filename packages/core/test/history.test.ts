import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRuns, pruneRuns, readRun, writeRun } from "../src/history.js";
import type { JourneyResult } from "../src/runtime.js";

const fakeResult: JourneyResult = {
  name: "test",
  ok: true,
  steps: [{ name: "s1", ok: true, durationMs: 1 }],
  durationMs: 1,
};

describe("run history", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "journey-hist-"));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("writes, lists, reads a run", async () => {
    const record = await writeRun(cacheDir, [fakeResult]);
    expect(record.id).toBeTruthy();
    expect(record.timestamp).toBeTruthy();
    expect(record.results).toHaveLength(1);

    const list = await listRuns(cacheDir);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(record.id);
    expect(list[0]!.ok).toBe(true);
    expect(list[0]!.journeyNames).toEqual(["test"]);

    const read = await readRun(cacheDir, record.id);
    expect(read?.results).toEqual([fakeResult]);
  });

  it("lists newest-first", async () => {
    await writeRun(cacheDir, [{ ...fakeResult, name: "a" }]);
    await new Promise((r) => setTimeout(r, 10)); // ensure unique timestamps
    await writeRun(cacheDir, [{ ...fakeResult, name: "b" }]);
    const list = await listRuns(cacheDir);
    expect(list[0]!.journeyNames[0]).toBe("b");
    expect(list[1]!.journeyNames[0]).toBe("a");
  });

  it("prunes oldest runs past keep count", async () => {
    await writeRun(cacheDir, [{ ...fakeResult, name: "old" }]);
    await new Promise((r) => setTimeout(r, 10));
    await writeRun(cacheDir, [{ ...fakeResult, name: "mid" }]);
    await new Promise((r) => setTimeout(r, 10));
    await writeRun(cacheDir, [{ ...fakeResult, name: "new" }]);

    const deleted = await pruneRuns(cacheDir, 2);
    expect(deleted).toBe(1);

    const remaining = await listRuns(cacheDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.journeyNames[0])).toEqual(["new", "mid"]);
  });

  it("returns undefined for nonexistent run id", async () => {
    expect(await readRun(cacheDir, "nope")).toBeUndefined();
  });

  it("lists empty if runs dir doesn't exist", async () => {
    expect(await listRuns(join(cacheDir, "nonexistent"))).toEqual([]);
  });
});
