import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "@playwright/test";

function waitForLog(
  label: string,
  proc: ChildProcess,
  needle: string | RegExp,
  timeoutMs: number,
): Promise<void> {
  const match = (s: string) => (typeof needle === "string" ? s.includes(needle) : needle.test(s));
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `[${label}] timeout waiting for ${needle}\n--- recent output ---\n${buffered.slice(-2000)}`,
          ),
        ),
      timeoutMs,
    );
    const onData = (buf: Buffer) => {
      buffered += buf.toString();
      if (match(buffered)) {
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
    JSON.stringify(
      { name: "demo", spec: "openapi.yaml", baseUrl: "https://api.example.com" },
      null,
      2,
    ),
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

  // Pick random free ports to avoid collisions with leftover processes.
  const { createServer } = await import("node:net");
  const pickPort = () =>
    new Promise<number>((r) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as { port: number };
        s.close(() => r(port));
      });
    });
  const apiPort = await pickPort();
  const viteBasePort = await pickPort();

  const api = spawn("node", [cliEntry, "serve", "--port", String(apiPort)], {
    cwd: projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const vite = spawn(
    "pnpm",
    ["--filter", "@usejourney/gui", "dev", "--port", String(viteBasePort), "--strictPort"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, JOURNEY_API_URL: `http://127.0.0.1:${apiPort}` },
    },
  );

  try {
    await waitForLog("api", api, "Journey API listening", 30_000);
    await waitForLog("vite", vite, /ready in/, 60_000);
    await sleep(500);

    await page.goto(`http://127.0.0.1:${viteBasePort}/`);
    await expect(page.getByTestId("project-name")).toHaveText("demo");
    await expect(page.getByTestId("endpoint-count")).toHaveText("2");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  } finally {
    vite.kill("SIGINT");
    api.kill("SIGINT");
    await sleep(200);
  }
});
