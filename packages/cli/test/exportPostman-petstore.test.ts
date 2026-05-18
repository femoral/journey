/**
 * Petstore sample coverage for `journey export postman`.
 *
 * Two layers:
 *   1. Structural — exports each petstore journey and asserts folder names,
 *      step count, HTTP methods, and URL paths. Catches regressions when
 *      sample journey files change.
 *   2. Newman e2e — runs the exported collection for the one fully-static
 *      journey (`list-available-pets`) against the real petstore mock server.
 *      Auth/CRUD journeys share state via closures and cannot produce a
 *      runnable static collection; they are covered structurally only.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import newman from "newman";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExportPostman } from "../src/commands/exportPostman.js";
import { discoverJourneyFiles } from "../src/util/discover.js";

// ── paths ─────────────────────────────────────────────────────────────────────

const thisDir = dirname(fileURLToPath(import.meta.url));
const cliDir = join(thisDir, "..");
const repoRoot = join(cliDir, "..", "..");
const petstoreDir = join(repoRoot, "examples", "petstore");
const petstoreJourneys = join(petstoreDir, "journeys");

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTmp(): Promise<string> {
  const base = join(cliDir, ".test-tmp");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, "postman-petstore-"));
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function spawnMockServer(
  script: string,
  portEnvKey: string,
): Promise<{ url: string; proc: ChildProcess }> {
  const port = await getFreePort();
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [script], {
      env: { ...process.env, [portEnvKey]: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolved = false;
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (!resolved && chunk.toString().includes("listening at")) {
        resolved = true;
        resolve({ url: `http://127.0.0.1:${port}`, proc });
      }
    });
    proc.stderr?.on("data", () => {}); // suppress stderr
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!resolved) reject(new Error(`Server exited prematurely (code ${code})`));
    });
    setTimeout(() => {
      if (!resolved) reject(new Error("Server startup timed out"));
    }, 8_000);
  });
}

function runNewman(
  collectionPath: string,
  environmentPath: string,
): Promise<newman.NewmanRunSummary> {
  return new Promise((resolve, reject) => {
    newman.run(
      { collection: collectionPath, environment: environmentPath, reporters: [] },
      (err, summary) => (err ? reject(err) : resolve(summary!)),
    );
  });
}

// ── structural tests ──────────────────────────────────────────────────────────

describe("petstore — export structure", () => {
  let outDir: string;
  let col: Record<string, unknown>;

  // Export all journeys once; each `it` inspects a different journey folder.
  beforeAll(async () => {
    outDir = await makeTmp();
    await runExportPostman({
      path: petstoreJourneys,
      outDir,
      tags: [],
      projectDir: petstoreDir,
    });
  });

  afterAll(async () => rm(outDir, { recursive: true, force: true }));

  async function load(base: string) {
    return JSON.parse(await readFile(join(outDir, `${base}.postman_collection.json`), "utf8"));
  }

  // ── coverage gate: every discovered journey must export cleanly ────────────

  it("all discovered journeys produced a valid collection", async () => {
    const files = await discoverJourneyFiles(petstoreJourneys);
    expect(files.length, "petstore journeys dir must not be empty").toBeGreaterThan(0);

    for (const file of files) {
      const base = basename(file).replace(/\.journey\.ts$/, "");
      const col = JSON.parse(
        await readFile(join(outDir, `${base}.postman_collection.json`), "utf8"),
      );
      expect(col.info.schema, `${base}: schema URL`).toBe(
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      );
      expect(col.item, `${base}: must have at least one folder`).toBeInstanceOf(Array);
      expect((col.item as unknown[]).length, `${base}: folder count`).toBeGreaterThan(0);
    }
  });

  // ── list-available-pets ────────────────────────────────────────────────────

  it("list-available-pets: 1 folder / 1 step / GET /pet/findByStatus", async () => {
    col = await load("list-available-pets");
    expect(col.item).toHaveLength(1);
    const folder = (col.item as Array<{ name: string; item: unknown[] }>)[0]!;
    expect(folder.name).toBe("list available pets");
    expect(folder.item).toHaveLength(1);

    const step = (
      folder.item as Array<{
        name: string;
        request: { method: string; url: { raw: string; query: Array<{ key: string }> } };
      }>
    )[0]!;
    expect(step.name).toBe("findByStatus");
    expect(step.request.method).toBe("GET");
    expect(step.request.url.raw).toContain("/pet/findByStatus");
    const queryKeys = step.request.url.query.map((q) => q.key);
    expect(queryKeys).toContain("status");
    expect(queryKeys).toContain("limit");
  });

  // ── whoami ─────────────────────────────────────────────────────────────────

  it("whoami: 1 folder / 2 steps / both at {{AUTH_BASE_URL}}", async () => {
    col = await load("whoami");
    expect(col.item).toHaveLength(1);
    const folder = (col.item as Array<{ name: string; item: unknown[] }>)[0]!;
    expect(folder.name).toBe("whoami");
    expect(folder.item).toHaveLength(2);

    type Step = { name: string; request: { method: string; url: { raw: string } } };
    const steps = folder.item as Step[];
    expect(steps[0]!.name).toBe("login via IDP");
    expect(steps[0]!.request.method).toBe("POST");
    expect(steps[0]!.request.url.raw).toContain("{{AUTH_BASE_URL}}");
    expect(steps[0]!.request.url.raw).toContain("/auth/login");

    expect(steps[1]!.name).toBe("whoami");
    expect(steps[1]!.request.method).toBe("GET");
    expect(steps[1]!.request.url.raw).toContain("{{AUTH_BASE_URL}}");
    expect(steps[1]!.request.url.raw).toContain("/auth/whoami");
  });

  // ── pet-crud-flow ──────────────────────────────────────────────────────────

  it("pet-crud-flow: 1 folder / 9 steps with correct names and methods", async () => {
    col = await load("pet-crud-flow");
    expect(col.item).toHaveLength(1);
    const folder = (col.item as Array<{ name: string; item: unknown[] }>)[0]!;
    expect(folder.name).toBe("pet CRUD flow");
    expect(folder.item).toHaveLength(9);

    type Step = { name: string; request: { method: string } };
    const steps = folder.item as Step[];
    const byName = Object.fromEntries(steps.map((s) => [s.name, s.request.method]));

    expect(byName["login"]).toBe("POST");
    expect(byName["create pet"]).toBe("POST");
    expect(byName["fetch pet"]).toBe("GET");
    expect(byName["patch status to pending"]).toBe("PATCH");
    expect(byName["replace pet wholesale"]).toBe("PUT");
    expect(byName["add a note"]).toBe("POST");
    expect(byName["list notes"]).toBe("GET");
    expect(byName["delete pet"]).toBe("DELETE");
    expect(byName["verify pet is gone"]).toBe("GET");
  });

  // ── load-list-pets ─────────────────────────────────────────────────────────

  it("load-list-pets: exported when no --tag filter; same endpoint as list-available-pets", async () => {
    col = await load("load-list-pets");
    expect(col.item).toHaveLength(1);
    const folder = (col.item as Array<{ name: string; item: unknown[] }>)[0]!;
    expect(folder.name).toBe("load: list pets");
    expect(folder.item).toHaveLength(1);

    type Step = { request: { method: string; url: { raw: string } } };
    const step = (folder.item as Step[])[0]!;
    expect(step.request.method).toBe("GET");
    expect(step.request.url.raw).toContain("/pet/findByStatus");
  });

  it("load-list-pets: skipped when --tag filter is smoke (only tagged load)", async () => {
    const filteredDir = await makeTmp();
    try {
      await runExportPostman({
        path: join(petstoreJourneys, "load-list-pets.journey.ts"),
        outDir: filteredDir,
        tags: ["smoke"],
      });
      const { readdir } = await import("node:fs/promises");
      expect(await readdir(filteredDir)).toHaveLength(0);
    } finally {
      await rm(filteredDir, { recursive: true, force: true });
    }
  });
});

// ── Newman e2e against real petstore server ───────────────────────────────────

describe("petstore — Newman e2e (list-available-pets)", () => {
  let apiServer: { url: string; proc: ChildProcess };
  let outDir: string;

  beforeAll(async () => {
    [apiServer, outDir] = await Promise.all([
      spawnMockServer(join(petstoreDir, "server.mjs"), "PORT"),
      makeTmp(),
    ]);

    await runExportPostman({
      path: join(petstoreJourneys, "list-available-pets.journey.ts"),
      outDir,
      tags: [],
      env: "local",
      projectDir: petstoreDir,
    });

    // Patch BASE_URL in the exported environment file to point at the test server.
    const { readFile, writeFile } = await import("node:fs/promises");
    const envPath = join(outDir, "local.postman_environment.json");
    const env = JSON.parse(await readFile(envPath, "utf8"));
    for (const v of env.values as Array<{ key: string; value: string }>) {
      if (v.key === "BASE_URL") v.value = apiServer.url;
    }
    await writeFile(envPath, JSON.stringify(env, null, 2));
  }, 15_000);

  afterAll(async () => {
    apiServer.proc.kill();
    await rm(outDir, { recursive: true, force: true });
  });

  it("collection runs against the petstore mock with no Newman failures", async () => {
    const collectionPath = join(outDir, "list-available-pets.postman_collection.json");
    const envPath = join(outDir, "local.postman_environment.json");
    const summary = await runNewman(collectionPath, envPath);

    expect(summary.run.failures).toHaveLength(0);
    expect(summary.run.stats.requests.total).toBe(1);
    expect(summary.run.stats.requests.failed).toBe(0);
  }, 30_000);
});
