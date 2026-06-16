import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const parent = await mkdtemp(join(tmpdir(), "journey-e2e-"));
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
        `import { journey, step, expect, env } from "@usejourney/core";
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

  it("--insecure builds an undici Agent and installs it as global dispatcher", async () => {
    const { enableInsecureTls } = await import("../src/commands/run.js");
    const { getGlobalDispatcher } = await import("undici");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const agent = await enableInsecureTls();
      const again = await enableInsecureTls();
      // Idempotent — same instance on a second call, no second warning.
      expect(again).toBe(agent);
      expect(getGlobalDispatcher()).toBe(agent);
      const warnings = errSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes("TLS verification disabled"));
      // Module-level latch — at most one warning per process, possibly zero
      // if a sibling test in the same Vitest worker already tripped it.
      expect(warnings.length).toBeLessThanOrEqual(1);
    } finally {
      errSpy.mockRestore();
    }
  });
});
