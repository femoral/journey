import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/server/server.js";

describe("journey serve — /api/project", () => {
  let srv: RunningServer;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "journey-serve-"));
    await mkdir(join(projectDir, "generated"), { recursive: true });
    await mkdir(join(projectDir, "journeys"), { recursive: true });
    await mkdir(join(projectDir, "environments"), { recursive: true });
    await writeFile(
      join(projectDir, "journey.config.json"),
      JSON.stringify({ name: "demo", spec: "openapi.yaml", baseUrl: "https://api.example.com" }),
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
    srv = await startServer({ projectDir, port: 0 });
  });

  afterAll(async () => {
    await srv.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("reports project config + counts", async () => {
    const res = await fetch(`${srv.url}/api/project`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { name: string; baseUrl: string };
      counts: { endpoints: number; journeys: number; environments: number };
    };
    expect(body.config.name).toBe("demo");
    expect(body.config.baseUrl).toBe("https://api.example.com");
    expect(body.counts).toEqual({ endpoints: 2, journeys: 0, environments: 2 });
  });

  it("health check", async () => {
    const res = await fetch(`${srv.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404 for unknown routes", async () => {
    const res = await fetch(`${srv.url}/api/nope`);
    expect(res.status).toBe(404);
  });
});
