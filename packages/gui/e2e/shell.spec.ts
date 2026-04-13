import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "@playwright/test";

function waitForLog(proc: ChildProcess, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${needle}"`)), timeoutMs);
    const onData = (buf: Buffer) => {
      if (buf.toString().includes(needle)) {
        clearTimeout(timer);
        proc.stdout?.off("data", onData);
        proc.stderr?.off("data", onData);
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
  });
}

async function makeProject(): Promise<string> {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const base = join(repoRoot, "packages", "gui", ".test-tmp");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "e2e-"));
  const projectDir = join(dir, "demo");
  await mkdir(join(projectDir, "generated"), { recursive: true });
  await mkdir(join(projectDir, "journeys"), { recursive: true });
  await mkdir(join(projectDir, "environments"), { recursive: true });
  await writeFile(
    join(projectDir, "journey.config.json"),
    JSON.stringify({ name: "demo", spec: "openapi.yaml", baseUrl: "https://api.example.com" }, null, 2),
  );
  await writeFile(
    join(projectDir, "generated", "endpoints.ts"),
    `export const endpoints = {
  listPets: { method: "GET", path: "/pets" },
  getPet: { method: "GET", path: "/pets/{id}" },
} as const;
`,
  );
  await writeFile(join(projectDir, "environments", "dev.json"), "{}");
  await writeFile(join(projectDir, "environments", "staging.json"), "{}");
  return projectDir;
}

test("GUI shell loads project overview from the API", async ({ page }) => {
  const projectDir = await makeProject();
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");

  const api = spawn("node", [cliEntry, "serve", "--port", "5182"], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const vite = spawn("pnpm", ["--filter", "@journey/gui", "dev", "--port", "5173"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, JOURNEY_API_URL: "http://127.0.0.1:5182" },
  });

  try {
    await waitForLog(api, "Journey API listening", 10_000);
    await waitForLog(vite, "Local:", 20_000);
    await sleep(500);

    await page.goto("/");
    await expect(page.getByTestId("project-name")).toHaveText("demo");
    await expect(page.getByTestId("endpoint-count")).toHaveText("2");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  } finally {
    vite.kill("SIGINT");
    api.kill("SIGINT");
    await sleep(200);
  }
});
