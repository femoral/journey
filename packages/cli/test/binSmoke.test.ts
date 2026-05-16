import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileP = promisify(execFile);

const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distEntry = join(cliDir, "dist", "index.js");
const fixture = fileURLToPath(
  new URL("../../codegen/test/fixtures/petstore.yaml", import.meta.url),
);

// Regression guard for the field report tracked at #76: in some environments
// the published `journey` bin would exit 0 with no stdout. From-source
// invocation (handled by the rest of the e2e suite) couldn't reproduce it.
// Running the actual built dist/index.js the way a package manager would is
// the next-best signal we can run in CI.
describe("bin smoke", () => {
  beforeAll(async () => {
    // CI runs `pnpm -r test` before `pnpm -r build`, so dist/ may not exist
    // yet on a fresh checkout. Build on demand so this suite is self-sufficient.
    try {
      await stat(distEntry);
    } catch {
      await execFileP("pnpm", ["--filter", "@journey/cli", "build"], { cwd: cliDir });
    }
  }, 120000);

  it("`node dist/index.js --version` prints the package version on stdout", async () => {
    const { stdout, stderr } = await execFileP("node", [distEntry, "--version"]);
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
    expect(stderr).toBe("");
  });

  it("`node dist/index.js init` prints the Initialized line on stdout", async () => {
    const base = join(cliDir, ".test-tmp");
    await mkdir(base, { recursive: true });
    const parent = await mkdtemp(join(base, "bin-init-"));
    const projectDir = join(parent, "demo");
    try {
      const { stdout } = await execFileP("node", [
        distEntry,
        "init",
        projectDir,
        "--spec",
        fixture,
      ]);
      expect(stdout).toContain("Initialized Journey project");
      expect(stdout).toContain("operations).");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 30000);
});
