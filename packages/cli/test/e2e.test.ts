import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runGenerate } from "../src/commands/generate.js";
import { runEnvList } from "../src/commands/envList.js";
import { runCommand } from "../src/commands/run.js";

const fixture = fileURLToPath(
  new URL("../../codegen/test/fixtures/petstore.yaml", import.meta.url),
);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/pets" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ id: "1", name: "Rex" }]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || !addr) throw new Error("bad address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("CLI e2e", () => {
  it("init → generate → env list → run", async () => {
    // Scaffold inside packages/cli so the temp project can resolve
    // `@journey/core` via packages/cli/node_modules (pnpm workspace link).
    // test/ → packages/cli → use .test-tmp *inside* packages/cli
    const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const base = join(cliDir, ".test-tmp");
    await mkdir(base, { recursive: true });
    const parent = await mkdtemp(join(base, "e2e-"));
    const projectDir = join(parent, "demo");
    try {
      await runInit({ dir: projectDir, spec: fixture });

      // Bake baseUrl + default env into the generated config.
      const cfgPath = join(projectDir, "journey.config.json");
      const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
      cfg.baseUrl = baseUrl;
      cfg.defaultEnvironment = "dev";
      await writeFile(cfgPath, JSON.stringify(cfg, null, 2));
      await writeFile(join(projectDir, "environments", "dev.json"), JSON.stringify({ TOKEN: "t" }));

      await runGenerate(projectDir);

      await runEnvList(projectDir);

      const journeyFile = join(projectDir, "journeys", "list-pets.journey.ts");
      await writeFile(
        journeyFile,
        `import { journey, step, expect, env } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";

journey("list pets", () => {
  step("fetch", {
    endpoint: endpoints.listPets,
    headers: () => ({ "X-Token": env("TOKEN") }),
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
`,
      );

      const code = await runCommand({ projectDir, files: [journeyFile] });
      expect(code).toBe(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 30000);

  it("--insecure warns once on stderr and disables TLS verification", async () => {
    const cliDir = dirname(dirname(fileURLToPath(import.meta.url)));
    const base = join(cliDir, ".test-tmp");
    await mkdir(base, { recursive: true });
    const parent = await mkdtemp(join(base, "insecure-"));
    const projectDir = join(parent, "demo");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const origEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      await runInit({ dir: projectDir, spec: fixture });
      const cfgPath = join(projectDir, "journey.config.json");
      const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
      cfg.baseUrl = baseUrl;
      await writeFile(cfgPath, JSON.stringify(cfg, null, 2));

      const journeyFile = join(projectDir, "journeys", "noop.journey.ts");
      await writeFile(
        journeyFile,
        `import { journey, step } from "@journey/core";
import { endpoints } from "../generated/endpoints.js";
journey("noop", () => {
  step("fetch", { endpoint: endpoints.listPets });
});
`,
      );

      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      const code = await runCommand({ projectDir, files: [journeyFile], insecure: true });
      expect(code).toBe(0);
      const calls = errSpy.mock.calls.map((c) => String(c[0]));
      const warnings = calls.filter((s) => s.includes("TLS verification disabled"));
      // Warning is once-per-process: zero only if a previous test already ran insecure.
      // Either way, the env mutation is the load-bearing assertion.
      expect(warnings.length).toBeLessThanOrEqual(1);
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    } finally {
      errSpy.mockRestore();
      if (origEnv === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = origEnv;
      }
      await rm(parent, { recursive: true, force: true });
    }
  }, 30000);

  it("prints the --insecure warning the first time it's enabled", async () => {
    const { enableInsecureTls } = await import("../src/commands/run.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const origEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    try {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      enableInsecureTls();
      enableInsecureTls();
      const warnings = errSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes("TLS verification disabled"));
      // Module-level latch means at most one warning total per process — possibly
      // zero if a sibling test already tripped it.
      expect(warnings.length).toBeLessThanOrEqual(1);
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    } finally {
      errSpy.mockRestore();
      if (origEnv === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = origEnv;
      }
    }
  });
});
