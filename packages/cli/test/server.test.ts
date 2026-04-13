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

  it("lists endpoints parsed from generated/endpoints.ts", async () => {
    const res = await fetch(`${srv.url}/api/endpoints`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      baseUrl?: string;
      endpoints: Array<{ name: string; method: string; path: string }>;
    };
    expect(body.baseUrl).toBe("https://api.example.com");
    expect(body.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "listPets", method: "GET", path: "/pets" }),
        expect.objectContaining({ name: "getPet", method: "GET", path: "/pets/{id}" }),
      ]),
    );
  });

  it("lists, saves, and deletes environments", async () => {
    type EnvListBody = { environments: Array<{ name: string; values: Record<string, string> }> };
    const list = (await (await fetch(`${srv.url}/api/environments`)).json()) as EnvListBody;
    expect(list.environments.map((e) => e.name).sort()).toEqual(["dev", "staging"]);

    const put = await fetch(`${srv.url}/api/environments/dev`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ TOKEN: "abc" }),
    });
    expect(put.status).toBe(200);

    const refetched = (await (await fetch(`${srv.url}/api/environments`)).json()) as EnvListBody;
    const dev = refetched.environments.find((e) => e.name === "dev");
    expect(dev?.values).toEqual({ TOKEN: "abc" });

    const del = await fetch(`${srv.url}/api/environments/staging`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const afterDelete = (await (await fetch(`${srv.url}/api/environments`)).json()) as EnvListBody;
    expect(afterDelete.environments.map((e) => e.name)).toEqual(["dev"]);

    // invalid name
    const bad = await fetch(`${srv.url}/api/environments/..%2Fetc%2Fpasswd`, { method: "DELETE" });
    expect(bad.status).toBe(400);
  });

  it("reads, writes, and deletes journey source files", async () => {
    const file = "demo.journey.ts";
    const source = `import { journey } from "@journey/core";\njourney("x", () => {});\n`;

    const put = await fetch(`${srv.url}/api/journeys/${file}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${srv.url}/api/journeys/${file}`);
    expect(get.status).toBe(200);
    const body = (await get.json()) as { source: string };
    expect(body.source).toBe(source);

    const bad = await fetch(`${srv.url}/api/journeys/..%2Fetc%2Fpasswd`);
    expect(bad.status).toBe(400);

    const del = await fetch(`${srv.url}/api/journeys/${file}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("proxies a request and returns status + body", async () => {
    // Stand up a throwaway target server.
    const { createServer } = await import("node:http");
    const target = createServer((req, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ echo: req.method }));
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
    const addr = target.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const res = await fetch(`${srv.url}/api/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "POST", url: `http://127.0.0.1:${port}/x`, body: { a: 1 } }),
      });
      expect(res.status).toBe(200);
      const out = (await res.json()) as { status: number; body: unknown };
      expect(out.status).toBe(201);
      expect(out.body).toEqual({ echo: "POST" });
    } finally {
      await new Promise<void>((r) => target.close(() => r()));
    }
  });
});
