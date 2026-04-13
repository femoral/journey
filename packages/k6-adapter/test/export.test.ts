import { spawn, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportToK6 } from "../src/index.js";

function hasK6(): boolean {
  try {
    const res = spawnSync("k6", ["version"], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

const describeIfK6 = hasK6() ? describe : describe.skip;

describe("exportToK6 — static output", () => {
  it("emits a k6 script with shim, inlined endpoints, and journey body", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "journey-k6-"));
    try {
      await mkdir(join(tmp, "generated"));
      await writeFile(
        join(tmp, "generated", "endpoints.ts"),
        `import type { EndpointRef } from "@journey/core";
export const endpoints = {
  listPets: { method: "GET", path: "/pets", operationId: "listPets" } as unknown as EndpointRef<unknown>,
} as const;
`,
      );
      const journey = join(tmp, "list-pets.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, expect } from "@journey/core";
import { endpoints } from "./generated/endpoints.js";

journey("list pets", () => {
  step("fetch", {
    endpoint: endpoints.listPets,
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
`,
      );

      const result = await exportToK6({ journeyFile: journey });
      expect(result.outFile).toMatch(/list-pets\.k6\.js$/);
      const src = await readFile(result.outFile, "utf8");
      expect(src).toContain('import http from "k6/http"');
      expect(src).toContain('import { check } from "k6"');
      expect(src).not.toContain("@journey/core");
      expect(src).toContain('const endpoints = {');
      expect(src).toContain('listPets:');
      expect(src).toContain('journey("list pets"');
      expect(src).toContain("export default function");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describeIfK6("exportToK6 — live k6 run", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/pets" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ id: "1" }]));
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

  it("k6 run executes the exported script successfully", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const base = join(testDir, "..", ".test-tmp");
    await mkdir(base, { recursive: true });
    const tmp = await mkdtemp(join(base, "k6-run-"));
    try {
      const journey = join(tmp, "list-pets.journey.ts");
      await writeFile(
        journey,
        `import { journey, step, expect } from "@journey/core";

journey("list pets", () => {
  step("fetch", {
    endpoint: { method: "GET", path: "/pets" },
    assert(res) {
      expect(res.status).toBe(200);
    },
  });
});
`,
      );
      const { outFile } = await exportToK6({ journeyFile: journey });
      const child = spawn(
        "k6",
        ["run", "--vus=1", "--iterations=1", outFile],
        { env: { ...process.env, JOURNEY_BASE_URL: baseUrl } },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      const code: number = await new Promise((res, rej) => {
        child.once("error", rej);
        child.once("close", (c) => res(c ?? 0));
      });
      expect(code, `k6 failed:\n${stdout}\n${stderr}`).toBe(0);
      const combined = stdout + stderr;
      expect(combined).toMatch(/list pets.*fetch/);
      expect(combined).toMatch(/checks.*100\.00%/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 60000);
});
