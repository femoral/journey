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
    const { configureDispatcher } = await import("../src/util/dispatcher.js");
    const { getGlobalDispatcher } = await import("undici");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const agent = await configureDispatcher({ insecure: true });
      const again = await configureDispatcher({ insecure: true });
      // Idempotent for the same option signature — same instance, no second warning.
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

  it("no dispatcher options leaves the global dispatcher alone", async () => {
    const { configureDispatcher } = await import("../src/util/dispatcher.js");
    const { getGlobalDispatcher } = await import("undici");
    const before = getGlobalDispatcher();
    expect(await configureDispatcher({})).toBeUndefined();
    expect(getGlobalDispatcher()).toBe(before);
  });

  it("--connect-timeout rebuilds the agent and passes the value to undici", async () => {
    const { configureDispatcher } = await import("../src/util/dispatcher.js");
    const { getGlobalDispatcher } = await import("undici");
    const insecureOnly = await configureDispatcher({ insecure: true });
    const withTimeout = await configureDispatcher({ insecure: true, connectTimeoutMs: 45_000 });
    // Different option signature → a fresh agent, installed globally.
    expect(withTimeout).not.toBe(insecureOnly);
    expect(getGlobalDispatcher()).toBe(withTimeout);

    // The value has to survive into the Agent's options — that's the whole
    // point of the flag, since `--timeout` (an AbortController around fetch)
    // cannot fire during the connect phase at all. undici keeps them on a
    // Symbol("options"); reading it fails loudly if that shape ever changes.
    const optionsSym = Object.getOwnPropertySymbols(withTimeout as object).find(
      (sym) => sym.description === "options",
    );
    expect(optionsSym).toBeDefined();
    const agentOptions = (withTimeout as Record<symbol, unknown>)[optionsSym!] as {
      connectTimeout?: number;
      connect?: { timeout?: number; rejectUnauthorized?: boolean };
    };
    expect(agentOptions.connectTimeout).toBe(45_000);
    expect(agentOptions.connect?.timeout).toBe(45_000);
    expect(agentOptions.connect?.rejectUnauthorized).toBe(false);
  });
});
