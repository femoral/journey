import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";

const validSpec = fileURLToPath(
  new URL("../../codegen/test/fixtures/petstore.yaml", import.meta.url),
);

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));

describe("journey init validation", () => {
  let parent: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const base = join(cliDir, ".test-tmp");
    await mkdir(base, { recursive: true });
    parent = await mkdtemp(join(base, "init-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(parent, { recursive: true, force: true });
  });

  it("happy path: scaffolds, generates, no warnings", async () => {
    const projectDir = join(parent, "demo");
    await runInit({ dir: projectDir, spec: validSpec });
    const cfg = JSON.parse(await readFile(join(projectDir, "journey.config.json"), "utf8"));
    expect(cfg.name).toBe("demo");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rejects a spec missing both openapi and swagger fields BEFORE touching the target dir", async () => {
    const badSpec = join(parent, "bad.yaml");
    await writeFile(badSpec, "info:\n  title: nope\n");
    const projectDir = join(parent, "shouldnt-exist");

    await expect(runInit({ dir: projectDir, spec: badSpec })).rejects.toThrow(
      /missing "openapi"\/"swagger" field/,
    );

    await expect(stat(projectDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a missing spec file with a clear error", async () => {
    const projectDir = join(parent, "demo");
    await expect(runInit({ dir: projectDir, spec: join(parent, "no-such.yaml") })).rejects.toThrow(
      /Spec file not found/,
    );
    await expect(stat(projectDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("warns when a valid spec has 0 operations", async () => {
    const emptySpec = join(parent, "empty.yaml");
    await writeFile(
      emptySpec,
      "openapi: 3.0.0\ninfo:\n  title: empty\n  version: 0.0.0\npaths: {}\n",
    );
    const projectDir = join(parent, "demo");
    await runInit({ dir: projectDir, spec: emptySpec });

    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes("0 operations"))).toBe(true);

    const generatedFiles = await readdir(join(projectDir, "generated"));
    expect(generatedFiles).toContain("endpoints.ts");
  });
});
